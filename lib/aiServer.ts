import type { LDClient } from "@launchdarkly/node-server-sdk";
import {
  createHandler,
  getClient,
  initClient,
  makeRunTrackData,
  runJudge,
  type JudgeTask,
  type LDContext,
  type ProviderHandler,
  type TokenUsage,
  type TrackData,
} from "@launchdarkly/ai-node";
import { createLangChainMessagesHandler } from "@launchdarkly/ai-langchain-messages";
import type { AIMessage } from "@langchain/core/messages";
// LangChain loads its Bedrock model with import() on a package name held in
// a variable, which the build cannot follow, so the standalone server would
// ship without it and every model build would fail in production. Importing
// it here is what tells the build to bring it, and its AWS SDK, along.
import "@langchain/aws";
import type { ToolFunctions } from "@/lib/langchainModel";
import { getServerClient } from "@/lib/ldServer";

// The LaunchDarkly AI SDK, for the routes that answer with an AI Config. The
// 1.0 SDK keeps one LaunchDarkly client for the whole process, and builds a
// second one from LD_SDK_KEY the first time any of its calls runs without
// one. So the store's own server client, the one the flags and the
// observability plugin use, is handed to it before any AI call, and only
// when there is one: with no client, every route falls back as it did
// before. The SDK keeps the first client it is given for good; the store
// never calls its shutdown(), which would close the shared client.
//
// LangChain's Bedrock model reads its region from AWS_DEFAULT_REGION and
// throws without it. That includes the judges, which the AI SDK runs with
// its own LangChain handler from their AI Configs, so the region cannot
// simply be passed in where a route builds its own model. The deploy writes
// the variable into .env.production; a laptop usually only has the region
// in ~/.aws/config, which LangChain does not read.
process.env.AWS_DEFAULT_REGION ??= process.env.AWS_REGION ?? "us-east-1";

let aiClientPromise: Promise<LDClient | null> | null = null;

export function getAiClient(): Promise<LDClient | null> {
  if (!aiClientPromise) {
    aiClientPromise = getServerClient().then(async (client) => {
      // Not cached on failure, so the next request tries again once the
      // server client has recovered.
      if (!client) {
        aiClientPromise = null;
        return null;
      }
      await initClient(client);
      return client;
    });
  }
  return aiClientPromise;
}

// Thrown by a route's handler when the model answered but the answer cannot
// be used. The SDK records generation:success whenever a handler returns,
// so a handler throws to have an unusable answer recorded as
// generation:error, as the legacy tracker's success: false was. It carries
// what the model wrote, for the error the route logs, and the tokens it
// spent, which the SDK sends only when a handler returns, so storeHandlers
// sends them instead.
export class UnusableAnswer extends Error {
  readonly answer: string;
  readonly usage?: TokenUsage;

  constructor(message: string, answer: string, usage?: TokenUsage) {
    super(message);
    this.name = "UnusableAnswer";
    this.answer = answer;
    this.usage = usage;
  }
}

// Thrown by a handler when invoke() served a different variation, or
// version, than the inspectConfig() the route read first, because targeting
// changed in between. The route built its input, cache key and checks for
// the variation it inspected, so the answer is not written at all, and the
// route falls back as it does for any failed run.
export class ConfigChanged extends Error {
  constructor(inspected: string, served: string) {
    super(`The variation changed between inspectConfig() (${inspected}) and invoke() (${served})`);
    this.name = "ConfigChanged";
  }
}

type HandlerFn = Parameters<typeof createHandler>[1];

// The variation a route read with inspectConfig().
export type Inspected = { variationKey?: string; version?: number };

// The store's own model loop as the SDK's handler, for either mode, since
// the Swag Assistant, the Personal Stylist and Smart Search are completion
// configs and Cart Recovery and the Order Review agents are agent ones.
// Given the variation the route inspected, it runs only on that one (see
// ConfigChanged). An unusable answer's tokens are sent here, on the run's
// track data, the way the SDK sends them for an answer it returns.
export function storeHandlers(run: HandlerFn, inspected?: Inspected | null): ProviderHandler[] {
  const guarded: HandlerFn = async (config, input, toolHandlers, vars, history) => {
    const trackData = runTrackDataOf(vars);
    if (inspected !== undefined) {
      const expected = `${inspected?.variationKey ?? ""} v${inspected?.version ?? 1}`;
      const served = `${trackData.variationKey} v${trackData.version}`;
      if (expected !== served) throw new ConfigChanged(expected, served);
    }
    try {
      return await run(config, input, toolHandlers, vars, history);
    } catch (err) {
      if (err instanceof UnusableAnswer && err.usage) {
        trackTokens(vars?.ldContext as LDContext, trackData, err.usage);
      }
      throw err;
    }
  };
  return [createHandler(["*", "messages"], guarded), createHandler(["*", "agent"], guarded)];
}

function trackTokens(context: LDContext, trackData: TrackData, usage: TokenUsage) {
  try {
    if (usage.total > 0) getClient().track("$ld:ai:tokens:total", context, trackData, usage.total);
    if (usage.input > 0) getClient().track("$ld:ai:tokens:input", context, trackData, usage.input);
    if (usage.output > 0) getClient().track("$ld:ai:tokens:output", context, trackData, usage.output);
  } catch (err) {
    console.warn("$ld:ai:tokens could not be sent:", err);
  }
}

// The run's track data, inside a handler. The SDK hands it over among the
// variables, under __ld, which its own handlers read and its types do not
// declare; it is what a handler needs to send the store's own events
// (ai-tool-call-error) on the same run the SDK's land on.
export function runTrackDataOf(variables: Record<string, unknown> | undefined): TrackData {
  return (variables?.__ld ?? {}) as TrackData;
}

// A tool call the SDK did not count itself, because the variation carries
// the tool only in model.parameters.tools (lib/langchainModel.ts), sent the
// way the SDK sends its own.
export function trackToolCall(context: LDContext, trackData: TrackData, toolKey: string) {
  try {
    getClient().track("$ld:ai:tool_call", context, { ...trackData, toolKey }, 1);
  } catch (err) {
    console.warn("$ld:ai:tool_call could not be sent:", err);
  }
}

// What each of the store's tools runs inside a handler: the SDK's wrapped
// tool where it handed one over, which sends $ld:ai:tool_call as it runs,
// and otherwise the store's own, sending the same event itself.
export function toolFunctions(
  sdkTools: Record<string, unknown>,
  registry: ToolFunctions,
  context: LDContext,
  trackData: TrackData,
): ToolFunctions {
  return Object.fromEntries(
    Object.entries(registry).map(([key, fn]) => {
      const wrapped = sdkTools[key];
      if (typeof wrapped === "function") return [key, wrapped as ToolFunctions[string]];
      return [
        key,
        (args: unknown) => {
          trackToolCall(context, trackData, key);
          return fn(args);
        },
      ];
    }),
  );
}

// One judge's score on a reply, for the conversation's trace
// (lib/llmTrace.ts) and the judge-disagreement check (lib/codeChecks.ts).
export type JudgeResult = {
  judgeConfigKey: string;
  metricKey?: string;
  score: number;
  reasoning?: string;
};

let judgeHandlers: ProviderHandler[] | null = null;

// The judges attached to the variation that answered, as the SDK handed
// them back from invoke() with skipJudges, run without anything waiting on
// them: the shopper has their answer before the judges have read it. Each
// judge is its own AI Config, run by the SDK's LangChain handler, which
// records the judge's own duration, success and tokens; its score is sent
// here on the reply's track data, which runJudge leaves to its caller. The
// judges read input as the reply's input rather than what invoke() was
// given, since that is the store's own transcript, tool results included.
// Any config with judges attached will do, which includes the Order
// Review's agents. A judge whose model call fails is reported through
// onError and sends nothing; the others still score.
export async function judge(
  tasks: JudgeTask[] | undefined,
  context: LDContext,
  input: string,
  output: string,
  onError: (err: unknown) => void = () => {},
): Promise<JudgeResult[]> {
  judgeHandlers ??= [createLangChainMessagesHandler()];
  const handlers = judgeHandlers;
  const results = await Promise.all(
    (tasks ?? []).map(async (task): Promise<JudgeResult[]> => {
      let result: Awaited<ReturnType<typeof runJudge>>;
      try {
        result = await runJudge(
          { ...task, userInput: input, actualOutput: output, trajectory: undefined },
          handlers,
        );
      } catch (err) {
        onError(err);
        return [];
      }
      trackParseResult(task, context, result === null);
      if (!result) return [];

      const scores = result.metrics?.length
        ? result.metrics.map((m) => ({ ...m, metricKey: m.eventKey }))
        : task.evaluationMetricKey && typeof result.score === "number"
          ? [{ metricKey: task.evaluationMetricKey, score: result.score, judgeConfigKey: task.configKey }]
          : [];
      // result.trackData is the reply's, with judgeConfigKey merged in by
      // runJudge; each of several metrics carries its own judgeConfigKey.
      for (const { metricKey, score, judgeConfigKey } of scores) {
        try {
          getClient().track(metricKey, context, { ...result.trackData, judgeConfigKey }, score);
        } catch (err) {
          console.warn(`${metricKey} could not be sent:`, err);
        }
      }
      return scores.map((s) => ({ ...s, reasoning: result.response }));
    }),
  );
  return results.flat();
}

// The shopper as a "data:" line, for the judges: the prompt is told their
// name and tier, so a reply that rightly names the tier needs the judges told
// too. Built from the variables the prompt was filled from, so a guest reads
// as one who has not signed in. .github/workflows/demo_provisioning_scripts/
// ci_eval.py writes the same line for the offline evals.
export function shopperLine(variables: { shopper_name: string; loyalty_tier: string }): string {
  return `data: shopper ${JSON.stringify({ name: variables.shopper_name, loyalty_tier: variables.loyalty_tier })}`;
}

// Whether a judge's reply parsed, recorded on the judge's own config and
// variation: 1 when it did not, 0 when it did. runJudge returns null for a
// reply it cannot parse, without an error, so this is the only sign of a
// judge model that keeps breaking. A judge that was not sampled has no task,
// and one whose model call failed threw, so neither had a reply to parse. A
// failed send is only logged.
function trackParseResult(task: JudgeTask, context: LDContext, failed: boolean) {
  try {
    getClient().track(
      "judge-parse-error",
      context,
      makeRunTrackData({ configKey: task.configKey, config: task.judgeConfig, meta: task.judgeMeta }),
      failed ? 1 : 0,
    );
  } catch (err) {
    console.warn("judge-parse-error could not be sent:", err);
  }
}

// Thumbs up and down arrive in a later request than the reply they rate, and
// LaunchDarkly needs them recorded against the same run so the feedback
// lands on the variation that wrote the reply. That is the run's track
// data, which stays on the server, so the browser only ever sees the reply's
// id.
//
// Kept on globalThis so a dev server's hot reload does not forget replies a
// shopper can still see, and capped because nothing else ever clears it.
const MAX_REPLIES = 500;

const globalStore = globalThis as typeof globalThis & {
  swagAssistantReplies?: Map<string, TrackData>;
};
const replies = (globalStore.swagAssistantReplies ??= new Map());

export function rememberReply(replyId: string, trackData: TrackData) {
  replies.set(replyId, trackData);
  if (replies.size > MAX_REPLIES) {
    const oldest = replies.keys().next().value;
    if (oldest !== undefined) replies.delete(oldest);
  }
}

// Each reply takes one rating, which is also all LaunchDarkly will record
// against a run, so the track data is handed out once.
export function takeReply(replyId: string): TrackData | undefined {
  const trackData = replies.get(replyId);
  replies.delete(replyId);
  return trackData;
}

// A reply with a tool call in it comes back as content blocks rather than a
// plain string; the text blocks are the agent's answer.
export function textOf(message: AIMessage): string {
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

export function addUsage(total: TokenUsage, usage?: TokenUsage) {
  if (!usage) return;
  total.total += usage.total;
  total.input += usage.input;
  total.output += usage.output;
}
