import type { LDContext } from "@launchdarkly/node-server-sdk";
import {
  initAi,
  type LDAIClient,
  type LDAICompletionConfig,
  type LDAIConfigTracker,
  type LDJudgeResult,
  type LDTokenUsage,
} from "@launchdarkly/server-sdk-ai";
import type { AIMessage } from "@langchain/core/messages";
// LangChain loads its Bedrock model with import() on a package name held in
// a variable, which the build cannot follow, so the standalone server would
// ship without it and every model build would fail in production. Importing
// it here is what tells the build to bring it, and its AWS SDK, along.
import "@langchain/aws";
import { getServerClient } from "@/lib/ldServer";

// The LaunchDarkly AI client, for the routes that answer with an AI Config
// (the swag assistant and the personal stylist). It wraps the same server client the flags use
// rather than starting a second one, so AI Config evaluations and the
// metrics they record arrive under the same SDK connection as everything
// else this server does.
//
// LangChain's Bedrock model reads its region from AWS_DEFAULT_REGION and
// throws without it. That includes the judges, which the AI SDK builds by
// itself from their AI Configs, so the region cannot simply be passed in
// where the assistant builds its own model. The deploy writes the variable
// into .env.production; a laptop usually only has the region in
// ~/.aws/config, which LangChain does not read.
process.env.AWS_DEFAULT_REGION ??= process.env.AWS_REGION ?? "us-east-1";

let aiClientPromise: Promise<LDAIClient | null> | null = null;

export function getAiClient(): Promise<LDAIClient | null> {
  if (!aiClientPromise) {
    aiClientPromise = getServerClient().then((client) => {
      // Not cached on failure, so the next request tries again once the
      // server client has recovered.
      if (!client) aiClientPromise = null;
      return client ? initAi(client) : null;
    });
  }
  return aiClientPromise;
}

// The judges attached to the variation that answered, run the way the AI
// SDK's managed model runs them: each judge is its own AI Config, its score
// is recorded on this reply's tracker, and nothing waits for them — the
// shopper has their answer before the judges have read it. Any config with
// judges attached will do, which includes the Order Review's agents. Resolves
// to the judges' results, for the conversation's trace (lib/llmTrace.ts).
export async function judge(
  aiClient: LDAIClient,
  config: Pick<LDAICompletionConfig, "judgeConfiguration">,
  context: LDContext,
  tracker: LDAIConfigTracker,
  input: string,
  output: string,
): Promise<LDJudgeResult[]> {
  const attached = config.judgeConfiguration?.judges ?? [];
  const results = await Promise.all(
    attached.map(async ({ key, samplingRate }) => {
      const judge = await aiClient.createJudge(
        key,
        context,
        undefined,
        undefined,
        "langchain",
        samplingRate,
      );
      const result = await judge?.evaluate(input, output);
      if (result?.sampled) tracker.trackJudgeResult(result);
      return result;
    }),
  );
  return results.filter((r): r is LDJudgeResult => Boolean(r));
}

// Thumbs up and down arrive in a later request than the reply they rate, and
// LaunchDarkly needs them recorded against the same run so the feedback
// lands on the variation that wrote the reply. The SDK hands back a
// resumption token for that, and asks for it to stay on the server, so the
// browser only ever sees the reply's id.
//
// Kept on globalThis so a dev server's hot reload does not forget replies a
// shopper can still see, and capped because nothing else ever clears it.
const MAX_REPLIES = 500;

const globalStore = globalThis as typeof globalThis & {
  swagAssistantReplies?: Map<string, string>;
};
const replies = (globalStore.swagAssistantReplies ??= new Map());

export function rememberReply(replyId: string, resumptionToken: string) {
  replies.set(replyId, resumptionToken);
  if (replies.size > MAX_REPLIES) {
    const oldest = replies.keys().next().value;
    if (oldest !== undefined) replies.delete(oldest);
  }
}

// Each reply takes one rating, which is also all LaunchDarkly will record
// against a run, so the token is handed out once.
export function takeReply(replyId: string): string | undefined {
  const token = replies.get(replyId);
  replies.delete(replyId);
  return token;
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

export function addUsage(total: LDTokenUsage, usage?: LDTokenUsage) {
  if (!usage) return;
  total.total += usage.total;
  total.input += usage.input;
  total.output += usage.output;
}
