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
import { getAiClient } from "@/lib/aiServer";
import {
  assessOrder,
  isBlockedZip,
  riskScore,
  type FraudAssessment,
  type FraudDecision,
} from "@/lib/fraudAgent";
import { contextFromRequest } from "@/lib/ldServer";
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
// since that is the decline lever an SE pulls on stage and it cannot be left
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

// A reply with a tool call in it comes back as content blocks rather than a
// plain string; the text blocks are the agent's answer.
function textOf(message: AIMessage): string {
  if (typeof message.content === "string") return message.content.trim();
  return message.content
    .map((block) =>
      typeof block === "string"
        ? block
        : block.type === "text" && typeof block.text === "string"
          ? block.text
          : "",
    )
    .join("")
    .trim();
}

function addUsage(total: LDTokenUsage, usage?: LDTokenUsage) {
  if (!usage) return;
  total.total += usage.total;
  total.input += usage.input;
  total.output += usage.output;
}

type AgentRun = { text: string; metrics: LDAIMetrics };

// One agent: its instructions as the system prompt, what it is handed as the
// user message, and its tools, the first of which it has to call.
async function runAgent(
  config: LDAIAgentConfig,
  input: string,
  registry: ToolRegistry,
): Promise<AgentRun> {
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

  for (let round = 0; ; round += 1) {
    // Bedrock needs the tools on every request once one has been called,
    // so they stay bound after the first round and only stop being forced.
    const model =
      lcTools.length && llm.bindTools
        ? llm.bindTools(lcTools, round === 0 ? { tool_choice: "any" } : {})
        : llm;
    const response = (await model.invoke(messages)) as AIMessage;
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
      const output = tool ? await tool.invoke(call.args) : `No tool named ${call.name}`;
      const text = typeof output === "string" ? output : JSON.stringify(output);
      messages.push(new ToolMessage({ content: text, tool_call_id: call.id ?? "" }));
    }
  }
}

// The Order Decision agent answers in JSON. Anything else, or a decision
// that is not one of the three, is treated as no decision.
function parseDecision(text: string): { decision: FraudDecision; summary: string } | null {
  const json = text.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
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
  span: { setAttribute: (key: string, value: string | number | boolean) => void },
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

  // Runs one node, records it on its own tracker, and streams it starting
  // and finishing. show turns what the agent wrote into what the panel
  // shows, which only differs for the Order Decision agent's JSON.
  const run = async (key: string, input: string, show = (text: string) => text) => {
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

    const at = Date.now();
    try {
      const result = await tracker.trackMetricsOf(
        (r: AgentRun) => r.metrics,
        () => runAgent(config, input, tools.registry),
      );
      if (!result.metrics.success) throw new Error(`${key} returned an empty answer`);
      path.push(key);
      addUsage(tokens, result.metrics.tokens);
      send({
        type: "step",
        step: { ...step, status: "done", text: show(result.text), ms: Date.now() - at },
      });
      return result.text;
    } catch (err) {
      send({ type: "step", step: { ...step, status: "failed", ms: Date.now() - at } });
      throw err;
    }
  };

  // A handoff succeeded once the agent handed to has finished its part.
  const handOff = async (from: string, to: string, input: string, show?: (t: string) => string) => {
    try {
      const text = await run(to, input, show);
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
    const verdictText = await run(
      decider.getKey(),
      `Order ${order.ref}.\n\nCase summary from Order Intake:\n${summary}\n\n${reports}`,
      (text) => parseDecision(text)?.summary ?? text,
    );
    for (const node of specialists) {
      graphTracker.trackHandoffSuccess(node.getKey(), decider.getKey());
    }

    const signals = tools.signals;
    const score = riskScore(signals);
    const verdict = parseDecision(verdictText);
    if (!verdict) throw new Error("The decision agent did not answer in JSON");
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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
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
        runGraph(aiClient, context, order, send, answer, span),
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
