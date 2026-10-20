import { randomUUID } from "crypto";
import type { NextApiRequest, NextApiResponse } from "next";
import type { LDContext } from "@launchdarkly/node-server-sdk";
import { LDObserve } from "@launchdarkly/observability-node";
import type {
  LDAIClient,
  LDAICompletionConfig,
  LDAIConfigTracker,
  LDAIMetrics,
  LDTokenUsage,
} from "@launchdarkly/server-sdk-ai";
import {
  buildStructuredTools,
  convertMessagesToLangChain,
  createLangChainModel,
  getAIUsageFromResponse,
} from "@launchdarkly/server-sdk-ai-langchain";
import {
  AIMessage,
  HumanMessage,
  ToolMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import { getAiClient, rememberReply } from "@/lib/aiServer";
import { contextFromRequest } from "@/lib/ldServer";
import { productBySlug } from "@/lib/products";
import { TIER_LABELS, isGuest, shopperById } from "@/lib/shopper";
import {
  SWAG_ASSISTANT_KEY,
  replyTo,
  servedByFor,
  type SwagAssistantReply,
  type SwagAssistantRequest,
} from "@/lib/swagAssistant";
import {
  swagAssistantTools,
  type SwagAssistantTools,
} from "@/lib/swagAssistantTools";

// The swag assistant, answered by the Swag Assistant AI Config.
//
// LaunchDarkly decides everything about the reply that a prompt engineer
// would want to change without a deploy: which model, its parameters, the
// prompt, which tools it may call and which judges score it. Targeting picks
// the variation per shopper (Standard for everyone, Member Concierge for
// Gold and Platinum members), and the metrics recorded here — duration,
// tokens, success or error, each tool call, each judge's score, and the
// thumbs in pages/api/swag-assistant/feedback.ts — land on whichever
// variation answered.
//
// The model runs through LaunchDarkly's LangChain provider, which builds a
// Bedrock model from the variation. The tool loop is ours: the AI SDK's own
// managed model only runs tools for agent-mode configs, and this is a
// completion-mode one. Everything it records goes through the same tracker
// the managed model would use, so the Monitoring tab cannot tell the
// difference.
//
// With the config off, or LaunchDarkly unreachable, the scripted replies in
// lib/swagAssistant.ts answer instead.
const CONFIG_KEY = SWAG_ASSISTANT_KEY;

// Enough for a search, a detail lookup and a perks check in one answer,
// with room to spare; a model still asking for tools after that is looping.
const MAX_TOOL_ROUNDS = 4;

// The model only needs the recent conversation, and a long demo would
// otherwise send every earlier answer again with each question.
const MAX_HISTORY = 12;

// Cards for the products the reply actually names, at most this many.
const MAX_CARDS = 3;

type Turn = SwagAssistantRequest["messages"][number];

// Bedrock wants the conversation to open with the shopper and alternate from
// there. The panel's greeting is ours rather than the model's, so it is
// dropped, and two messages in a row from one side are joined.
function toHistory(turns: Turn[]): BaseMessage[] {
  const trimmed = turns.slice(-MAX_HISTORY);
  while (trimmed.length && trimmed[0].role !== "user") trimmed.shift();

  const merged: Turn[] = [];
  for (const turn of trimmed) {
    const last = merged[merged.length - 1];
    if (last?.role === turn.role) last.text += `\n\n${turn.text}`;
    else merged.push({ ...turn });
  }
  return merged.map((t) =>
    t.role === "user" ? new HumanMessage(t.text) : new AIMessage(t.text),
  );
}

// A reply with a tool call in it comes back as content blocks rather than a
// plain string; the text blocks are the part meant for the shopper.
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

type Conversation = {
  content: string;
  metrics: LDAIMetrics;
  // Each tool call and what it returned, for the judges: an accuracy score
  // means little unless the judge can see the catalogue facts the reply was
  // supposed to repeat.
  toolTranscript: string[];
};

async function converse(
  config: LDAICompletionConfig,
  history: BaseMessage[],
  tools: SwagAssistantTools,
): Promise<Conversation> {
  const llm = await createLangChainModel(config);
  const definitions = (config.model?.parameters?.tools as unknown[]) ?? [];
  const lcTools = buildStructuredTools(definitions, tools.registry);
  const toolsByName = new Map(lcTools.map((t) => [t.name, t]));
  const model =
    lcTools.length && llm.bindTools ? llm.bindTools(lcTools) : llm;

  const messages: BaseMessage[] = [
    ...convertMessagesToLangChain(config.messages ?? []),
    ...history,
  ];
  const tokens: LDTokenUsage = { total: 0, input: 0, output: 0 };
  const toolCalls: string[] = [];
  const toolTranscript: string[] = [];

  for (let round = 0; ; round += 1) {
    const response = (await model.invoke(messages)) as AIMessage;
    addUsage(tokens, getAIUsageFromResponse(response));
    messages.push(response);

    const calls = response.tool_calls ?? [];
    if (calls.length === 0 || round === MAX_TOOL_ROUNDS) {
      const content = textOf(response);
      return {
        content,
        metrics: { success: content.length > 0, tokens, toolCalls },
        toolTranscript,
      };
    }

    for (const call of calls) {
      toolCalls.push(call.name);
      const tool = toolsByName.get(call.name);
      const output = tool
        ? await tool.invoke(call.args)
        : `No tool named ${call.name}`;
      const text = typeof output === "string" ? output : JSON.stringify(output);
      toolTranscript.push(`${call.name}(${JSON.stringify(call.args)}) -> ${text}`);
      messages.push(new ToolMessage({ content: text, tool_call_id: call.id ?? "" }));
    }
  }
}

// The judges attached to the variation that answered, run the way the AI
// SDK's managed model runs them: each judge is its own AI Config, its score
// is recorded on this reply's tracker, and nothing waits for them — the
// shopper has their answer before the judges have read it.
async function judge(
  aiClient: LDAIClient,
  config: LDAICompletionConfig,
  context: LDContext,
  tracker: LDAIConfigTracker,
  input: string,
  output: string,
) {
  const attached = config.judgeConfiguration?.judges ?? [];
  await Promise.all(
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
    }),
  );
}

function servedBy(tracker: LDAIConfigTracker) {
  const { variationKey, modelName } = tracker.getTrackData();
  return servedByFor(variationKey, modelName);
}

// Cards for the products the reply names, in the order it names them, and
// only ones a tool returned — a model can mention a product it was never
// shown, but it cannot conjure a card for one.
function productsNamed(text: string, seenSlugs: Set<string>) {
  const lower = text.toLowerCase();
  return [...seenSlugs]
    .map((slug) => {
      const product = productBySlug(slug);
      return { slug, at: product ? lower.indexOf(product.name.toLowerCase()) : -1 };
    })
    .filter((p) => p.at >= 0)
    .sort((a, b) => a.at - b.at)
    .slice(0, MAX_CARDS)
    .map((p) => p.slug);
}

// The same for orders, which the prompt asks the model to name by number.
function ordersNamed(text: string, seenOrders: Set<string>) {
  return [...seenOrders]
    .map((ref) => ({ ref, at: text.indexOf(ref) }))
    .filter((o) => o.at >= 0)
    .sort((a, b) => a.at - b.at)
    .slice(0, MAX_CARDS)
    .map((o) => o.ref);
}

function isTurn(value: unknown): value is Turn {
  const turn = value as Turn;
  return (
    (turn?.role === "user" || turn?.role === "assistant") &&
    typeof turn.text === "string"
  );
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SwagAssistantReply | { error: string }>,
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const turns = Array.isArray(req.body?.messages)
    ? (req.body.messages as unknown[]).filter(isTurn)
    : [];
  const question = turns[turns.length - 1];
  if (!question || question.role !== "user" || !question.text.trim()) {
    res.status(400).json({ error: "The last message has to be the shopper's" });
    return;
  }

  const aiClient = await getAiClient();
  if (!aiClient) {
    res.status(200).json(replyTo(question.text));
    return;
  }

  await LDObserve.runWithHeaders("swagAssistant.reply", req.headers, async (span) => {
    const { secureSessionId, requestId } = LDObserve.parseHeaders(req.headers);
    const context = contextFromRequest(req.headers);
    const person = shopperById(typeof context.key === "string" ? context.key : "");

    // Filled into the prompt's {{shopper_name}} and {{loyalty_tier}}. Sent
    // as variables rather than read off the context in the prompt, so a
    // guest reads as "a guest" instead of as an empty name.
    const config = await aiClient.completionConfig(
      CONFIG_KEY,
      context,
      { enabled: false },
      {
        shopper_name: isGuest(person) ? "a guest who has not signed in" : person.name,
        loyalty_tier: TIER_LABELS[person.tier],
      },
    );

    if (!config.enabled) {
      span.setAttribute("ai.config.enabled", false);
      res.status(200).json(replyTo(question.text));
      return;
    }

    const tracker = config.createTracker();
    const tools = swagAssistantTools(context);
    const served = servedBy(tracker);
    const attributes = {
      "ai.config.key": CONFIG_KEY,
      "ai.config.variation": tracker.getTrackData().variationKey,
      "ai.model": tracker.getTrackData().modelName,
    };
    span.setAttributes(attributes);

    let result: Conversation;
    try {
      result = await tracker.trackMetricsOf(
        (r: Conversation) => r.metrics,
        () => converse(config, toHistory(turns), tools),
      );
    } catch (err) {
      LDObserve.recordError(err as Error, secureSessionId, requestId, attributes, { span });
      res.status(502).json({ error: "The swag assistant could not answer" });
      return;
    }

    span.setAttributes({
      "ai.tool_calls": result.metrics.toolCalls?.join(",") ?? "",
      "ai.tokens.total": result.metrics.tokens?.total ?? 0,
    });

    if (!result.metrics.success) {
      LDObserve.recordLog("Swag assistant returned an empty reply", "warn", secureSessionId, requestId, attributes);
      res.status(502).json({ error: "The swag assistant could not answer" });
      return;
    }

    const replyId = randomUUID();
    rememberReply(replyId, tracker.resumptionToken);

    res.status(200).json({
      text: result.content,
      productSlugs: productsNamed(result.content, tools.seenSlugs),
      orderRefs: ordersNamed(result.content, tools.seenOrders),
      replyId,
      servedBy: served,
    });

    const transcript = turns
      .slice(-MAX_HISTORY)
      .map((t) => `${t.role}: ${t.text}`)
      .concat(result.toolTranscript.map((t) => `tool: ${t}`))
      .join("\n");
    judge(aiClient, config, context, tracker, transcript, result.content).catch((err) =>
      LDObserve.recordError(err as Error, secureSessionId, requestId, attributes),
    );
  });
}
