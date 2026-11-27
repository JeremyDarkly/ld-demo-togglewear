import { randomUUID } from "crypto";
import type { NextApiRequest, NextApiResponse } from "next";
import { LDObserve } from "@launchdarkly/observability-node";
import {
  buildJudgeTasks,
  getClient,
  makeGraphTrackData,
  parseTemplate,
  resolveGraph,
  type AiConfigRep,
  type GraphNode,
  type LDContext,
  type TokenUsage,
  type TrackData,
} from "@launchdarkly/ai-node";
import type { Span } from "@opentelemetry/api";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import { activityGroup } from "@/lib/activity";
import {
  UnusableAnswer,
  addUsage,
  getAiClient,
  judge,
  runTrackDataOf,
  storeHandlers,
  textOf,
  toolFunctions,
  type JudgeResult,
} from "@/lib/aiServer";
import {
  caseNoteCoversTheCase,
  codeChecksOn,
  decisionMatchesPoints,
  demoSummaryNamesDecision,
  runCodeChecks,
  sendJudgeDisagreement,
  type CheckResult,
  type CodeCheckKey,
} from "@/lib/codeChecks";
import {
  assessOrder,
  decisionFor,
  isBlockedZip,
  riskScore,
  summaryFor,
  type FraudAssessment,
  type FraudDecision,
} from "@/lib/fraudAgent";
import { guard, LIMITS, text } from "@/lib/apiGuard";
import { isJevConfig, JEV_PROVIDER, jevDecision } from "@/lib/jev";
import {
  langChainModel,
  structuredTools,
  toolDefinitions,
  usageOf,
  type ToolFunctions,
} from "@/lib/langchainModel";
import { contextFromRequest, getServerClient } from "@/lib/ldServer";
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
import {
  isErrorResult,
  toolCallReporter,
  type ReportToolCall,
} from "@/lib/toolCallErrors";

// The fraud review at checkout, run by the Order Review agent graph.
//
// The graph's shape is LaunchDarkly's, read from its edges with the AI SDK's
// resolveGraph: the root agent (Order Intake) reads the order, its children
// (the three specialists) check it at the same time, the agent they all hand
// to (Order Decision) makes the call, and the one after that (Case Note)
// writes up an order that was not approved. Each agent's model, instructions
// and tools come from its own agent config, and each agent runs through the
// SDK's runNode, which records the run on that agent with the graph's key
// and sends the handoff into it. The SDK's own graph runner follows one edge
// at a time, chosen by a model, so it cannot run the specialists side by
// side or skip the case note for an approved order; the graph's own events
// (each node, duration, tokens, success or failure) are sent here instead.
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

// The judge code-check-judge-disagreement compares decision-matches-points
// with, since both ask whether the decision follows from the points.
const DECISION_POLICY_JUDGE_KEY = "togglewear-decision-policy-judge";

// The Decision Policy judge's score, sent again on each specialist's run.
// The judges are attached to the Order Decision agent alone, so their scores
// carry its config and variation, and a rollout on a specialist would only
// see them through the context. The Decision Policy judge checks the
// decision against the points the specialists' tools found, so it says
// something about their work too; the Shopper Message judge scores the
// Order Decision agent's own wording, so it stays there.
const SPECIALIST_POLICY_KEY = "specialist-judge-decision-policy";

// 1 when the Order Decision agent gave no usable decision, whether a model
// failed, its answer did not parse or Jev could not answer, and 0 when it
// did, on every decision, so the metric is a rate a rollout to Jev can be
// held to.
const DECISION_ERROR_KEY = "order-decision-error";

type CodeChecks = Partial<Record<CodeCheckKey, () => CheckResult>>;

const nameOf = (key: string) =>
  ORDER_REVIEW_AGENTS.find((agent) => agent.key === key)?.name ?? key;

type AgentRun = { text: string; metrics: { success: boolean; tokens: TokenUsage; toolCalls: string[] } };

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
// answer as JSON. config's instructions are already filled in. registry is
// what the tools run, which in the route are the SDK's, so it counts each
// call.
export async function runAgent(
  config: Pick<AiConfigRep, "model" | "provider" | "tools" | "instructions">,
  input: string,
  registry: ToolFunctions,
  agentRun: TracedRun,
  reportToolCall: ReportToolCall,
  answerSchema?: Record<string, unknown>,
): Promise<AgentRun> {
  const modelName = config.model?.name ?? "";
  const llm = await langChainModel(config as AiConfigRep);
  const lcTools = structuredTools(toolDefinitions(config as AiConfigRep), registry);
  const toolsByName = new Map(lcTools.map((t) => [t.name, t]));

  const messages: BaseMessage[] = [
    new SystemMessage(config.instructions ?? ""),
    new HumanMessage(input),
  ];
  const tokens: TokenUsage = { total: 0, input: 0, output: 0 };
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
        usage: usageOf(response),
        // The decision it filled in rather than a call to a tool that never
        // runs, since record_decision is only the shape of the answer.
        output: parsed ? JSON.stringify(parsed) : undefined,
      };
    });
    addUsage(tokens, usageOf(raw));
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
        return { response, usage: usageOf(response) };
      },
    );
    addUsage(tokens, usageOf(response));
    messages.push(response);

    const calls = response.tool_calls ?? [];
    if (calls.length === 0 || round === MAX_TOOL_ROUNDS) {
      const text = textOf(response);
      return { text, metrics: { success: text.length > 0, tokens, toolCalls } };
    }

    for (const call of calls) {
      toolCalls.push(call.name);
      const tool = toolsByName.get(call.name);
      // Reported whatever happens, a throw included, before the throw ends
      // the agent's run.
      let failed = true;
      try {
        const text = await agentRun.tool(call, async () => {
          const output = tool ? await tool.invoke(call.args) : `No tool named ${call.name}`;
          return typeof output === "string" ? output : JSON.stringify(output);
        });
        failed = !tool || isErrorResult(text);
        messages.push(new ToolMessage({ content: text, tool_call_id: call.id ?? "" }));
      } finally {
        reportToolCall(call.name, failed);
      }
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

// The Order Decision as Jev makes it (lib/jev.ts), answered the way the
// LLM variations answer, filled in to DECISION_SCHEMA. Jev picks the
// decision and writes nothing, so the shopper is shown the scripted
// review's message for it. Jev failing throws, which the SDK records as the
// run's error, and the review falls back as it does for a model failing.
export async function runJev(
  config: Parameters<typeof jevDecision>[0],
  input: string,
  points: number,
  agentRun: TracedRun,
  span?: Span,
  options?: Parameters<typeof jevDecision>[3],
): Promise<AgentRun> {
  let made: Awaited<ReturnType<typeof jevDecision>> | undefined;
  await agentRun.modelCall(config.model?.name ?? "", [input], async () => {
    made = await jevDecision(config, input, points, options);
    const output = JSON.stringify({
      decision: made.decision,
      score: points,
      summary: summaryFor(made.decision),
    });
    return { response: new AIMessage(output), usage: made.usage, output };
  }, JEV_PROVIDER);
  const decision = made!;
  span?.setAttributes({
    "orderReview.jev.choice": decision.choice,
    "orderReview.jev.confidence": decision.confidence,
    "orderReview.jev.fellBack": decision.fellBack,
  });
  const text = JSON.stringify({
    decision: decision.decision,
    score: points,
    summary: summaryFor(decision.decision),
  });
  return { text, metrics: { success: true, tokens: decision.usage, toolCalls: [] } };
}

// What a checkout form can hold, with room to spare. A cart has at most a few
// dozen lines; an address field a few dozen characters.
const MAX_LINES = 50;
const MAX_FIELD = 200;

function isRequest(body: unknown): body is OrderReviewRequest {
  const order = body as OrderReviewRequest;
  return (
    text(order?.ref, 64) !== null &&
    Array.isArray(order.lines) &&
    order.lines.length <= MAX_LINES &&
    order.lines.every(
      (line) =>
        text(line?.slug, 100) !== null &&
        text(line?.size, 20) !== null &&
        Number.isInteger(line?.quantity) &&
        line.quantity > 0 &&
        line.quantity <= 1_000,
    ) &&
    typeof order.total === "number" &&
    Number.isFinite(order.total) &&
    order.shipTo !== null &&
    typeof order.shipTo === "object" &&
    Object.values(order.shipTo).every((field) => text(field, MAX_FIELD) !== null) &&
    text(order.shipTo.zip, 16) !== null &&
    text(order.payment, 64) !== null
  );
}

// What the handler needs to run one agent, by the agent's key, which is how
// the handler, shared by every node, tells them apart: the trace of its run
// and the shape its answer takes, and back from it, what it wrote.
type NodeRun = {
  agentRun: TracedRun;
  answerSchema?: Record<string, unknown>;
  result?: AgentRun;
  // The SDK's run of it, once the handler has been called.
  trackData?: TrackData;
};

// Runs the graph, answering the shopper through answer as soon as the
// decision is made. False if the graph is off, so nothing was answered.
export async function runGraph(
  context: LDContext,
  order: OrderReviewRequest,
  send: (event: OrderReviewEvent) => void,
  answer: (assessment: FraudAssessment) => void,
  span: Span,
  report: (err: unknown) => void,
): Promise<boolean> {
  const tools = orderReviewTools(order, context);
  const client = await getServerClient();
  const nodeRuns = new Map<string, NodeRun>();

  // Every agent's run, through the SDK, which records its duration, success
  // or error, tokens and tool calls. An agent with no usable answer is
  // thrown, so it is recorded as an error, as the legacy tracker's success:
  // false was, and the review falls back.
  const handlers = storeHandlers(async (config, input = "", toolHandlers = {}, vars = {}) => {
    const trackData = runTrackDataOf(vars);
    const key = trackData.configKey;
    const node = nodeRuns.get(key);
    if (!node) throw new Error(`No run was started for ${key}`);
    node.trackData = trackData;
    const instructions = parseTemplate(config.instructions ?? "", vars);
    // A variation on a TypeSafe model config is Jev, which only the Order
    // Decision agent, the one with an answer schema, knows how to ask.
    const result =
      node.answerSchema && isJevConfig(config)
        ? await runJev({ ...config, instructions }, input, riskScore(tools.signals), node.agentRun, span)
        : await runAgent(
            { ...config, instructions },
            input,
            toolFunctions(toolHandlers, tools.registry, context, trackData),
            node.agentRun,
            toolCallReporter(client, context, trackData),
            node.answerSchema,
          );
    node.result = result;
    // The start of what it did say, so the error in Observability shows
    // what went wrong rather than only that something did.
    if (!result.metrics.success) {
      throw new UnusableAnswer(
        `${key} returned no usable answer: ${result.text.slice(0, 200)}`,
        result.text,
        result.metrics.tokens,
      );
    }
    return { output: result.text, usage: result.metrics.tokens };
  });

  const graph = await resolveGraph(ORDER_REVIEW_GRAPH_KEY, {
    context,
    handlers,
    toolHandlers: tools.registry,
  });
  const intake = graph.root;
  if (!graph.enabled || !intake) {
    span.setAttribute("ai.graph.enabled", false);
    return false;
  }

  // Read once per review, so its agents are all checked or none are.
  const checking = await codeChecksOn(client, context);
  const started = Date.now();
  const tokens: TokenUsage = { total: 0, input: 0, output: 0 };
  // The graph's own events, on one run of their own. resolveGraph does not
  // hand back the graph variation's track data, so these carry no
  // variation key.
  const graphTrackData: TrackData = makeGraphTrackData(ORDER_REVIEW_GRAPH_KEY, randomUUID());
  // A metric that failed to send is never worth a failed review.
  const track = (key: string, data: object, value: number) => {
    try {
      getClient().track(key, context, data, value);
    } catch (err) {
      console.warn(`${key} could not be sent:`, err);
    }
  };
  let entered = 0;
  // Each agent's run, as the SDK recorded it, for the specialists' copy of
  // the Decision Policy judge's score.
  const ranTrackData = new Map<string, TrackData>();
  // The whole review is one conversation in LaunchDarkly, found by the
  // order's number. Order numbers are random and only unique within a
  // session (lib/fraudAgent.ts), so the id adds a few characters of its own.
  const conversationId = `${order.ref}-${randomUUID().slice(0, 8)}`;

  // Runs one node through the SDK, and streams it starting and finishing.
  // from is the agent handing to it, for the SDK's handoff event. show turns
  // what the agent wrote into what the panel shows, which only differs for
  // the Order Decision agent's JSON.
  const run = async (
    node: GraphNode,
    input: string,
    { from, show = (text: string) => text, answerSchema, judgeInput, codeChecks, onScored }: {
      from?: GraphNode;
      show?: (text: string) => string;
      answerSchema?: Record<string, unknown>;
      // The offline evals' checks to run on what the agent wrote, while the
      // response-code-checks flag serves true (lib/codeChecks.ts). They only
      // send events: the review never waits on them or reads their results.
      codeChecks?: (text: string) => CodeChecks;
      // What the judges attached to the agent's variation are shown as the
      // agent's input when they score its answer, without anything waiting
      // on them. No judging without it.
      judgeInput?: string;
      // What the judges scored, once they all have.
      onScored?: (results: JudgeResult[]) => void;
    } = {},
  ) => {
    const key = node.key;
    const step: AgentStep = {
      key: key as OrderReviewAgentKey,
      status: "running",
      model: servedByFor(node.meta.variationKey ?? "", node.config.model.name).model,
    };
    send({ type: "step", step });

    const agentRun = startAgentRun(
      span,
      conversationId,
      nameOf(key),
      parseTemplate(node.config.instructions ?? "", { ldContext: context }),
      input,
    );
    const nodeRun: NodeRun = { agentRun, answerSchema };
    nodeRuns.set(key, nodeRun);
    track("$ld:ai:graph:node", { ...graphTrackData, nodeKey: key, index: entered++ }, 1);
    const at = Date.now();
    try {
      // runNode runs the agent's judges itself and waits for them, with no
      // way to skip them, which would hold the shopper at Place Order. So
      // the node runs without its judges, and they are built from it
      // afterwards and run in the background, as every other route's are.
      const ran = await graph.runNode(
        { ...node, config: { ...node.config, judgeConfiguration: undefined } },
        input,
        { from },
      );
      const text = nodeRun.result?.text ?? String(ran.response);
      ranTrackData.set(key, ran.trackData);
      addUsage(tokens, ran.usage);
      agentRun.finish(text, judgeInput !== undefined);
      const checked =
        checking && codeChecks
          ? runCodeChecks(client, context, ran.trackData, codeChecks(text))
          : null;
      if (judgeInput !== undefined) {
        buildJudgeTasks({
          config: node.config,
          userContext: context,
          handler: handlers[1],
          handlers,
          llmResponse: text,
          baseTrackData: ran.trackData,
          userInput: judgeInput,
        })
          .then((tasks) => judge(tasks, context, judgeInput, text, report))
          .then((results) => {
            agentRun.scored(results);
            if (checked) {
              sendJudgeDisagreement(
                client,
                context,
                ran.trackData,
                checked["decision-matches-points"],
                results.find((r) => r.judgeConfigKey === DECISION_POLICY_JUDGE_KEY),
              );
            }
            onScored?.(results);
          })
          .catch((err) => {
            agentRun.scored();
            report(err);
          });
      }
      send({
        type: "step",
        step: { ...step, status: "done", text: show(text), ms: Date.now() - at },
      });
      return text;
    } catch (err) {
      agentRun.fail(err);
      send({ type: "step", step: { ...step, status: "failed", ms: Date.now() - at } });
      throw err;
    }
  };

  try {
    const summary = await run(intake, `Order ${order.ref} has just been placed.`);

    const specialists = graph.getChildNodes(intake.key);
    const findings = await Promise.all(
      specialists.map((node) =>
        run(node, `Case summary from Order Intake:\n${summary}`, { from: intake }),
      ),
    );
    const reports = specialists
      .map((node, i) => `${nameOf(node.key)}: ${findings[i]}`)
      .join("\n\n");

    const decider = graph.getChildNodes(specialists[0].key)[0];
    if (!decider) throw new Error("The specialists hand to no decision agent");
    const decisionInput = `Order ${order.ref}.\n\nCase summary from Order Intake:\n${summary}\n\n${reports}`;
    const points = riskScore(tools.signals);
    // On the decision's own run, so it carries the variation that made it.
    const decisionError = (value: number) =>
      track(DECISION_ERROR_KEY, nodeRuns.get(decider.key)?.trackData ?? graphTrackData, value);
    // Without from: runNode takes one agent handing over, and all three
    // specialists hand to the decision, so their handoffs are sent below.
    const verdictText = await run(decider, decisionInput, {
      show: (text) => parseDecision(text)?.summary ?? text,
      answerSchema: DECISION_SCHEMA,
      // With the total the tools found, so the Decision Policy judge can
      // check the decision against it rather than adding the points up
      // itself, which it does after it has already scored.
      judgeInput: `${decisionInput}\n\nRisk points the specialists' tools found: ${points}.`,
      // The model's own decision, before the blocked-ZIP guard below can
      // override it.
      codeChecks: (text) => ({
        "decision-matches-points": () => decisionMatchesPoints(text, decisionFor(points), points),
        "demo-summary-names-decision": () => demoSummaryNamesDecision(text),
      }),
      // On each specialist's run, with the judge's key, as the judge's own
      // event is on the decision's. Nothing when the judge was not sampled,
      // failed or did not parse, since it then has no score.
      onScored: (results) => {
        const policy = results.find((r) => r.judgeConfigKey === DECISION_POLICY_JUDGE_KEY);
        if (typeof policy?.score !== "number") return;
        for (const node of specialists) {
          const trackData = ranTrackData.get(node.key);
          if (!trackData) continue;
          track(
            SPECIALIST_POLICY_KEY,
            { ...trackData, judgeConfigKey: DECISION_POLICY_JUDGE_KEY },
            policy.score,
          );
        }
      },
    }).catch((err) => {
      decisionError(1);
      throw err;
    });
    for (const node of specialists) {
      track(
        "$ld:ai:graph:handoff_success",
        { ...graphTrackData, sourceKey: node.key, targetKey: decider.key },
        1,
      );
    }

    const signals = tools.signals;
    const score = riskScore(signals);
    const verdict = parseDecision(verdictText);
    decisionError(verdict ? 0 : 1);
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

    const noteTaker = graph.getChildNodes(decider.key)[0];
    if (decision !== "approve" && noteTaker) {
      await run(
        noteTaker,
        `Order ${order.ref} was ${decision === "review" ? "held for review" : "declined"}, ` +
          `with ${score} risk points.\n\nCase summary from Order Intake:\n${summary}\n\n${reports}`,
        {
          from: decider,
          // The note's text, checked against the final decision and the
          // points the tools found rather than anything parsed from prose.
          codeChecks: (note) => ({
            "case-note-covers-the-case": () =>
              caseNoteCoversTheCase(note, decision, signals.map((s) => s.points)),
          }),
        },
      );
    }

    track("$ld:ai:graph:duration:total", graphTrackData, Date.now() - started);
    if (tokens.total > 0) track("$ld:ai:graph:total_tokens", graphTrackData, tokens.total);
    track("$ld:ai:graph:invocation_success", graphTrackData, 1);
    return true;
  } catch (err) {
    track("$ld:ai:graph:duration:total", graphTrackData, Date.now() - started);
    track("$ld:ai:graph:invocation_failure", graphTrackData, 1);
    throw err;
  }
}

// Next refuses a bigger body with 413 before the handler runs.
export const config = { api: { bodyParser: { sizeLimit: "32kb" } } };

export default activityGroup("Order Review", handler);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  if (!guard(req, res, "order-review", LIMITS.ai)) return;
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
        runGraph(context, order, send, answer, span, (err) =>
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
