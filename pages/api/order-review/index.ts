import { randomUUID } from "crypto";
import type { NextApiRequest, NextApiResponse } from "next";
import { LDObserve } from "@launchdarkly/observability-node";
import type {
  LDAIAgentConfig,
  LDAIClient,
  LDAIMetrics,
  LDTokenUsage,
  ToolRegistry,
} from "@launchdarkly/server-sdk-ai";
import type { LDContext } from "@launchdarkly/node-server-sdk";
import type { Span } from "@opentelemetry/api";
import {
  buildStructuredTools,
  createLangChainModel,
  getAIUsageFromResponse,
} from "@launchdarkly/server-sdk-ai-langchain";
import {
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type AIMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import { activityGroup } from "@/lib/activity";
import { addUsage, getAiClient, judge, textOf } from "@/lib/aiServer";
import {
  assessOrder,
  isBlockedZip,
  riskScore,
  type FraudAssessment,
  type FraudDecision,
} from "@/lib/fraudAgent";
import { contextFromRequest } from "@/lib/ldServer";
import { startAgentRun, type AgentRun as TracedRun } from "@/lib/llmTrace";
import {
  ORDER_REVIEW_AGENTS,
  ORDER_REVIEW_GRAPH_KEY,
  type AgentStep,
  type OrderReviewAgentKey,
  type OrderReviewEvent,
  type OrderReviewRequest,
  underReview,
} from "@/lib/orderReview";
import { orderReviewTools } from "@/lib/orderReviewTools";
import { servedByFor } from "@/lib/swagAssistant";

// The fraud review at checkout, run by the Order Review agent graph.
//
// The graph's shape is LaunchDarkly's, read from its edges: the root agent
// (Order Intake) reads the order, its children (the three specialists) check
// it at the same time, the agent they all hand to (Order Decision) makes the
// call, and the one after that (Case Note) writes up an order that was not
// approved. Each agent's model, instructions and tools come from its own
// agent config, and each run is recorded on that agent's tracker, which
// carries the graph's key, so the agents' Monitoring tabs and the graph's
// own (path, handoffs, duration, tokens) both fill in.
//
// The specialists are made to call their tool before they answer, since the
// tool is where their facts come from, and the score is added up from what
// the tools found rather than read from a model. The decision itself is the
// model's, with one exception: an order to a blocked ZIP is always declined,
// since that is the decline lever a user pulls on stage and it cannot be left
// to a model's judgement on the day.
//
// With the graph off (in LaunchDarkly, switching off any one of its agents
// switches it off), LaunchDarkly unreachable, or a model failing or slow,
// lib/fraudAgent.ts reviews the order instead.
//
// The response streams as newline-delimited JSON, so the panel can show each
// agent at work rather than a spinner (OrderReviewEvent in lib/orderReview).

// Enough for the tool call and the answer after it; an agent still asking
// for tools after that is looping.
const MAX_TOOL_ROUNDS = 2;

// Longer than a review takes, around six to eight seconds, and short enough
// that a stuck model does not leave a shopper at Place Order.
const REVIEW_TIMEOUT_MS = 30_000;

const DECISIONS: FraudDecision[] = ["approve", "review", "decline"];

const nameOf = (key: string) =>
  ORDER_REVIEW_AGENTS.find((agent) => agent.key === key)?.name ?? key;

type AgentRun = { text: string; metrics: LDAIMetrics };

// The shape the Order Decision agent answers in. Bedrock makes the model
// fill it in as a tool call, so the answer always has these fields rather
// than being JSON the model was asked nicely to write, which it now and then
// broke. Ours rather than LaunchDarkly's because this code reads it.
const DECISION_SCHEMA = {
  type: "object",
  properties: {
    decision: { type: "string", enum: DECISIONS },
    score: { type: "number", description: "The total risk points, at most 100." },
    summary: {
      type: "string",
      description: "One or two sentences to the shopper, shown at checkout.",
    },
  },
  required: ["decision", "score", "summary"],
};

// One agent: its instructions as the system prompt, what it is handed as the
// user message, and its tools, the first of which it has to call. With an
// answer schema, the agent answers by filling it in, and its text is that
// answer as JSON.
async function runAgent(
  config: LDAIAgentConfig,
  input: string,
  registry: ToolRegistry,
  agentRun: TracedRun,
  answerSchema?: Record<string, unknown>,
): Promise<AgentRun> {
  const modelName = config.model?.name ?? "";
  const llm = await createLangChainModel(config);
  const definitions = (config.model?.parameters?.tools as unknown[]) ?? [];
  const lcTools = buildStructuredTools(definitions, registry);
  const toolsByName = new Map(lcTools.map((t) => [t.name, t]));

  const messages: BaseMessage[] = [
    new SystemMessage(config.instructions ?? ""),
    new HumanMessage(input),
  ];
  const tokens: LDTokenUsage = { total: 0, input: 0, output: 0 };
  const toolCalls: string[] = [];

  if (answerSchema) {
    let parsed: unknown;
    const raw = await agentRun.modelCall(modelName, [input], async () => {
      const result = await llm
        .withStructuredOutput(answerSchema, { name: "record_decision", includeRaw: true })
        .invoke(messages);
      parsed = result.parsed;
      const response = result.raw as AIMessage;
      return {
        response,
        usage: getAIUsageFromResponse(response),
        // The decision it filled in rather than a call to a tool that never
        // runs, since record_decision is only the shape of the answer.
        output: parsed ? JSON.stringify(parsed) : undefined,
      };
    });
    addUsage(tokens, getAIUsageFromResponse(raw));
    const text = parsed ? JSON.stringify(parsed) : textOf(raw);
    return { text, metrics: { success: Boolean(parsed), tokens, toolCalls } };
  }

  for (let round = 0; ; round += 1) {
    // Bedrock needs the tools on every request once one has been called,
    // so they stay bound after the first round and only stop being forced.
    const model =
      lcTools.length && llm.bindTools
        ? llm.bindTools(lcTools, round === 0 ? { tool_choice: "any" } : {})
        : llm;
    const response = await agentRun.modelCall(
      modelName,
      round === 0 ? [input] : [],
      async () => {
        const response = (await model.invoke(messages)) as AIMessage;
        return { response, usage: getAIUsageFromResponse(response) };
      },
    );
    addUsage(tokens, getAIUsageFromResponse(response));
    messages.push(response);

    const calls = response.tool_calls ?? [];
    if (calls.length === 0 || round === MAX_TOOL_ROUNDS) {
      const text = textOf(response);
      return { text, metrics: { success: text.length > 0, tokens, toolCalls } };
    }

    for (const call of calls) {
      toolCalls.push(call.name);
      const tool = toolsByName.get(call.name);
      const text = await agentRun.tool(call, async () => {
        const output = tool ? await tool.invoke(call.args) : `No tool named ${call.name}`;
        return typeof output === "string" ? output : JSON.stringify(output);
      });
      messages.push(new ToolMessage({ content: text, tool_call_id: call.id ?? "" }));
    }
  }
}

// The Order Decision agent's answer, filled in to DECISION_SCHEMA. Anything
// that still is not one of the three decisions is treated as no decision.
function parseDecision(text: string): { decision: FraudDecision; summary: string } | null {
  try {
    const parsed = JSON.parse(text);
    if (!DECISIONS.includes(parsed.decision) || typeof parsed.summary !== "string") return null;
    return { decision: parsed.decision, summary: parsed.summary.trim() };
  } catch {
    return null;
  }
}

function isRequest(body: unknown): body is OrderReviewRequest {
  const order = body as OrderReviewRequest;
  return (
    typeof order?.ref === "string" &&
    Array.isArray(order.lines) &&
    typeof order.total === "number" &&
    typeof order.shipTo?.zip === "string" &&
    typeof order.payment === "string"
  );
}

// Runs the graph, answering the shopper through answer as soon as the
// decision is made. False if the graph is off, so nothing was answered.
async function runGraph(
  aiClient: LDAIClient,
  context: LDContext,
  order: OrderReviewRequest,
  send: (event: OrderReviewEvent) => void,
  answer: (assessment: FraudAssessment) => void,
  span: Span,
  report: (err: unknown) => void,
): Promise<boolean> {
  const graph = await aiClient.agentGraph(ORDER_REVIEW_GRAPH_KEY, context);
  if (!graph.enabled) {
    span.setAttribute("ai.graph.enabled", false);
    return false;
  }

  const graphTracker = graph.createTracker();
  const tools = orderReviewTools(order, context);
  const started = Date.now();
  const path: string[] = [];
  const tokens: LDTokenUsage = { total: 0, input: 0, output: 0 };
  // The whole review is one conversation in LaunchDarkly, found by the
  // order's number. Order numbers are random and only unique within a
  // session (lib/fraudAgent.ts), so the id adds a few characters of its own.
  const conversationId = `${order.ref}-${randomUUID().slice(0, 8)}`;

  // Runs one node, records it on its own tracker, and streams it starting
  // and finishing. show turns what the agent wrote into what the panel
  // shows, which only differs for the Order Decision agent's JSON.
  const run = async (
    key: string,
    input: string,
    { show = (text: string) => text, answerSchema, judgeInput }: {
      show?: (text: string) => string;
      answerSchema?: Record<string, unknown>;
      // What the judges attached to the agent's variation are shown as the
      // agent's input when they score its answer, without anything waiting
      // on them. No judging without it.
      judgeInput?: string;
    } = {},
  ) => {
    const node = graph.getNode(key);
    if (!node) throw new Error(`The graph has no ${key} node`);
    const config = node.getConfig();
    const tracker = config.createTracker();
    const { variationKey, modelName } = tracker.getTrackData();
    const step: AgentStep = {
      key: key as OrderReviewAgentKey,
      status: "running",
      model: servedByFor(variationKey, modelName).model,
    };
    send({ type: "step", step });

    const agentRun = startAgentRun(span, conversationId, nameOf(key), config.instructions ?? "", input);
    const at = Date.now();
    try {
      const result = await tracker.trackMetricsOf(
        (r: AgentRun) => r.metrics,
        () => runAgent(config, input, tools.registry, agentRun, answerSchema),
      );
      // The start of what it did say, so the error in Observability shows
      // what went wrong rather than only that something did.
      if (!result.metrics.success) {
        throw new Error(`${key} returned no usable answer: ${result.text.slice(0, 200)}`);
      }
      path.push(key);
      addUsage(tokens, result.metrics.tokens);
      agentRun.finish(result.text, judgeInput !== undefined);
      if (judgeInput !== undefined) {
        judge(aiClient, config, context, tracker, judgeInput, result.text)
          .then(agentRun.scored)
          .catch((err) => {
            agentRun.scored();
            report(err);
          });
      }
      send({
        type: "step",
        step: { ...step, status: "done", text: show(result.text), ms: Date.now() - at },
      });
      return result.text;
    } catch (err) {
      agentRun.fail(err);
      send({ type: "step", step: { ...step, status: "failed", ms: Date.now() - at } });
      throw err;
    }
  };

  // A handoff succeeded once the agent handed to has finished its part.
  const handOff = async (from: string, to: string, input: string) => {
    try {
      const text = await run(to, input);
      graphTracker.trackHandoffSuccess(from, to);
      return text;
    } catch (err) {
      graphTracker.trackHandoffFailure(from, to);
      throw err;
    }
  };

  try {
    const intake = graph.rootNode();
    const summary = await run(intake.getKey(), `Order ${order.ref} has just been placed.`);

    const specialists = graph.getChildNodes(intake.getKey());
    const findings = await Promise.all(
      specialists.map((node) =>
        handOff(intake.getKey(), node.getKey(), `Case summary from Order Intake:\n${summary}`),
      ),
    );
    const reports = specialists
      .map((node, i) => `${nameOf(node.getKey())}: ${findings[i]}`)
      .join("\n\n");

    const decider = graph.getChildNodes(specialists[0].getKey())[0];
    if (!decider) throw new Error("The specialists hand to no decision agent");
    const decisionInput = `Order ${order.ref}.\n\nCase summary from Order Intake:\n${summary}\n\n${reports}`;
    const verdictText = await run(decider.getKey(), decisionInput, {
      show: (text) => parseDecision(text)?.summary ?? text,
      answerSchema: DECISION_SCHEMA,
      // With the total the tools found, so the Decision Policy judge can
      // check the decision against it rather than adding the points up
      // itself, which it does after it has already scored.
      judgeInput: `${decisionInput}\n\nRisk points the specialists' tools found: ${riskScore(tools.signals)}.`,
    });
    for (const node of specialists) {
      graphTracker.trackHandoffSuccess(node.getKey(), decider.getKey());
    }

    const signals = tools.signals;
    const score = riskScore(signals);
    const verdict = parseDecision(verdictText);
    if (!verdict) {
      throw new Error(`The decision agent did not answer with a decision: ${verdictText.slice(0, 200)}`);
    }
    let decision = verdict.decision;
    if (decision !== "decline" && isBlockedZip(order.shipTo.zip)) {
      decision = "decline";
      span.setAttribute("orderReview.guard", "blocked-zip");
    }
    const assessment: FraudAssessment = {
      decision,
      score,
      signals,
      // The scripted decline's wording when the guard overrode the model,
      // whose summary was written for a different decision.
      summary:
        decision === verdict.decision ? verdict.summary : assessOrder(underReview(order)).summary,
    };
    answer(assessment);
    span.setAttribute("orderReview.decision", decision);
    span.setAttribute("orderReview.score", score);

    const noteTaker = graph.getChildNodes(decider.getKey())[0];
    if (decision !== "approve" && noteTaker) {
      await handOff(
        decider.getKey(),
        noteTaker.getKey(),
        `Order ${order.ref} was ${decision === "review" ? "held for review" : "declined"}, ` +
          `with ${score} risk points.\n\nCase summary from Order Intake:\n${summary}\n\n${reports}`,
      );
    }

    graphTracker.trackPath(path);
    graphTracker.trackDuration(Date.now() - started);
    graphTracker.trackTotalTokens(tokens);
    graphTracker.trackInvocationSuccess();
    return true;
  } catch (err) {
    graphTracker.trackPath(path);
    graphTracker.trackDuration(Date.now() - started);
    graphTracker.trackInvocationFailure();
    throw err;
  }
}

export default activityGroup("Order Review", handler);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  if (!isRequest(req.body)) {
    res.status(400).json({ error: "Not an order" });
    return;
  }
  const order = req.body;

  // no-transform keeps the server's compression from holding the stream
  // back until it ends.
  res.writeHead(200, {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "X-Accel-Buffering": "no",
  });
  // A review that timed out has already been answered by the fallback, and
  // its agents may still be finishing.
  const send = (event: OrderReviewEvent) => {
    if (!res.writableEnded) res.write(`${JSON.stringify(event)}\n`);
  };
  // One result per order, whichever answers first.
  let answered = false;
  const answer = (assessment: FraudAssessment, scripted?: true) => {
    if (answered) return;
    answered = true;
    send({ type: "result", assessment, ...(scripted && { scripted }) });
  };
  const scripted = () => {
    answer(assessOrder(underReview(order)), true);
    res.end();
  };

  const aiClient = await getAiClient();
  if (!aiClient) {
    scripted();
    return;
  }

  await LDObserve.runWithHeaders("orderReview.review", req.headers, async (span) => {
    const { secureSessionId, requestId } = LDObserve.parseHeaders(req.headers);
    const context = contextFromRequest(req.headers);
    const attributes = { "ai.graph.key": ORDER_REVIEW_GRAPH_KEY, "order.ref": order.ref };
    span.setAttributes(attributes);

    let timer: NodeJS.Timeout | undefined;
    try {
      const ran = await Promise.race([
        runGraph(aiClient, context, order, send, answer, span, (err) =>
          LDObserve.recordError(err as Error, secureSessionId, requestId, attributes),
        ),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("The order review timed out")), REVIEW_TIMEOUT_MS);
        }),
      ]);
      if (!ran) scripted();
      res.end();
    } catch (err) {
      LDObserve.recordError(err as Error, secureSessionId, requestId, attributes, { span });
      // A failure after the decision only loses the case note; the shopper
      // already has their answer, and keeps it.
      scripted();
    } finally {
      clearTimeout(timer);
    }
  });
}
