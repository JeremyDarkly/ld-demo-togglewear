import { randomUUID } from "crypto";
import type { NextApiRequest, NextApiResponse } from "next";
import { LDObserve } from "@launchdarkly/observability-node";
import {
  config as aiConfig,
  inspectConfig,
  type AiConfigRep,
  type TokenUsage,
} from "@launchdarkly/ai-node";
import {
  AIMessage,
  HumanMessage,
  ToolMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import { activityGroup } from "@/lib/activity";
import {
  UnusableAnswer,
  addUsage,
  getAiClient,
  judge,
  rememberReply,
  runTrackDataOf,
  storeHandlers,
  textOf,
  toolFunctions,
} from "@/lib/aiServer";
import { guard, LIMITS } from "@/lib/apiGuard";
import {
  langChainModel,
  renderedMessages,
  structuredTools,
  toLangChain,
  toolDefinitions,
  usageOf,
  type ToolFunctions,
} from "@/lib/langchainModel";
import { contextFromRequest, getServerClient } from "@/lib/ldServer";
import { startAgentRun, type AgentRun } from "@/lib/llmTrace";
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
import {
  isErrorResult,
  toolCallReporter,
  type ReportToolCall,
} from "@/lib/toolCallErrors";

// The swag assistant, answered by the Swag Assistant AI Config.
//
// LaunchDarkly decides everything about the reply that a prompt engineer
// would want to change without a deploy: which model, its parameters, the
// prompt, which tools it may call and which judges score it. Targeting picks
// the variation per shopper (Standard for everyone, Member Concierge for
// Gold and Platinum members), and the metrics recorded here — duration,
// tokens, success or error, each tool call and whether it failed, each
// judge's score, and the thumbs in pages/api/swag-assistant/feedback.ts —
// land on whichever variation answered.
//
// The AI SDK runs the reply through a handler of the store's own and records
// the run itself: duration, success or error, tokens and each tool call. The
// tool loop inside it is ours rather than the SDK's LangChain handler,
// because that one cannot ask the model again when it quotes a price no tool
// gave it. The SDK counts a reply as a success whenever the handler returns,
// so the handler throws on an empty reply to have it recorded as an error.
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

// A reply that quotes a price when no tool ran came from the model's memory,
// which knows nothing of this catalogue: Nova 2 Lite once offered a $45
// hoodie the store has never sold. The model is asked once to look it up.
const QUOTES_A_PRICE = /\$\s?\d/;
const LOOK_IT_UP =
  "Look that up with your tools before you answer, and only quote products and prices " +
  "they return. Then answer my last question again, without mentioning that you checked.";

// Markdown bold and quote marks. The chat shows text as typed, so they
// arrive as asterisks and a stray ">"; the prompt asks for plain text and
// this catches the rest.
function plainText(text: string) {
  return text.replace(/(\*\*|__)(.+?)\1/g, "$2").replace(/^>\s?/gm, "");
}

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

type Conversation = {
  content: string;
  metrics: { success: boolean; tokens: TokenUsage; toolCalls: string[] };
  // Each tool call and what it returned, for the judges: an accuracy score
  // means little unless the judge can see the catalogue facts the reply was
  // supposed to repeat.
  toolTranscript: string[];
  // Whether it quoted a price without a tool and was asked to look it up.
  lookedUp: boolean;
};

// config's messages are already filled in. functions are what the tools
// run, which in the route are the SDK's, so it counts each call.
export async function converse(
  config: Pick<AiConfigRep, "model" | "provider" | "tools" | "messages">,
  history: BaseMessage[],
  question: string,
  tools: SwagAssistantTools,
  agentRun: AgentRun,
  reportToolCall: ReportToolCall,
  functions: ToolFunctions = tools.registry,
): Promise<Conversation> {
  const llm = await langChainModel(config as AiConfigRep);
  const lcTools = structuredTools(toolDefinitions(config as AiConfigRep), functions);
  const toolsByName = new Map(lcTools.map((t) => [t.name, t]));
  const model =
    lcTools.length && llm.bindTools ? llm.bindTools(lcTools) : llm;

  const messages: BaseMessage[] = [...toLangChain(config.messages ?? []), ...history];
  const tokens: TokenUsage = { total: 0, input: 0, output: 0 };
  const toolCalls: string[] = [];
  const toolTranscript: string[] = [];
  let lookedUp = false;
  // What the model is shown new on each call, for the conversation trace.
  let inputs = [question];

  for (let round = 0; ; round += 1) {
    const shown = inputs;
    inputs = [];
    const response = await agentRun.modelCall(
      config.model?.name ?? "",
      shown,
      async () => {
        const response = (await model.invoke(messages)) as AIMessage;
        return { response, usage: usageOf(response) };
      },
    );
    addUsage(tokens, usageOf(response));
    messages.push(response);

    const calls = response.tool_calls ?? [];
    if (calls.length === 0 || round === MAX_TOOL_ROUNDS) {
      const content = plainText(textOf(response));
      if (
        !lookedUp &&
        toolCalls.length === 0 &&
        round < MAX_TOOL_ROUNDS &&
        QUOTES_A_PRICE.test(content)
      ) {
        lookedUp = true;
        messages.push(new HumanMessage(LOOK_IT_UP));
        inputs = [LOOK_IT_UP];
        continue;
      }
      return {
        content,
        metrics: { success: content.length > 0, tokens, toolCalls },
        toolTranscript,
        lookedUp,
      };
    }

    for (const call of calls) {
      toolCalls.push(call.name);
      const tool = toolsByName.get(call.name);
      // Reported whatever happens, a throw included, before the throw ends
      // the conversation.
      let failed = true;
      try {
        const text = await agentRun.tool(call, async () => {
          const output = tool
            ? await tool.invoke(call.args)
            : `No tool named ${call.name}`;
          return typeof output === "string" ? output : JSON.stringify(output);
        });
        failed = !tool || isErrorResult(text);
        toolTranscript.push(`${call.name}(${JSON.stringify(call.args)}) -> ${text}`);
        messages.push(new ToolMessage({ content: text, tool_call_id: call.id ?? "" }));
      } finally {
        reportToolCall(call.name, failed);
      }
    }
  }
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

// The chat's id from the panel, which makes the whole chat one conversation
// in LaunchDarkly; a reply without one is a conversation of its own.
function conversationIdFrom(value: unknown): string {
  return typeof value === "string" && /^[\w-]{8,80}$/.test(value)
    ? value
    : `swag-chat-${randomUUID()}`;
}

// The browser sends the whole conversation each turn, so the caps on it are
// a window, not a refusal: only the last MAX_TURNS well-formed turns are kept,
// and an earlier turn longer than MAX_TURN_LENGTH is cut to it. Refusing
// would end a long chat for good, since every later turn carries the same
// history. The one thing refused is a shopper's own message over the cap,
// which the panel's input does not allow and only a crafted request sends.
const MAX_TURNS = 40;
const MAX_TURN_LENGTH = 2_000;

function isTurn(value: unknown): value is Turn {
  const turn = value as Turn;
  return (
    (turn?.role === "user" || turn?.role === "assistant") &&
    typeof turn.text === "string"
  );
}

function recentTurns(sent: unknown): Turn[] {
  return (Array.isArray(sent) ? sent : []).filter(isTurn).slice(-MAX_TURNS);
}

// Next refuses a bigger body with 413 before the handler runs.
export const config = { api: { bodyParser: { sizeLimit: "128kb" } } };

export default activityGroup("Swag Assistant", handler);

async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SwagAssistantReply | { error: string }>,
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  if (!guard(req, res, "swag-assistant", LIMITS.ai)) return;

  const recent = recentTurns(req.body?.messages);
  const question = recent[recent.length - 1];
  if (!question || question.role !== "user" || !question.text.trim()) {
    res.status(400).json({ error: "The last message has to be the shopper's" });
    return;
  }
  if (question.text.length > MAX_TURN_LENGTH) {
    res.status(400).json({ error: `Keep a message under ${MAX_TURN_LENGTH} characters` });
    return;
  }
  const turns = recent.map((turn) => ({ ...turn, text: turn.text.slice(0, MAX_TURN_LENGTH) }));

  const aiClient = await getAiClient();
  if (!aiClient) {
    res.status(200).json(replyTo(question.text));
    return;
  }

  await LDObserve.runWithHeaders("swagAssistant.reply", req.headers, async (span) => {
    const { secureSessionId, requestId } = LDObserve.parseHeaders(req.headers);
    const context = contextFromRequest(req.headers);
    const person = shopperById(typeof context.key === "string" ? context.key : "");

    // Whether the config is on, and which variation and model this shopper
    // gets, before anything runs: invoke() throws for a config that is off
    // rather than handing back a fallback.
    const inspected = await inspectConfig(CONFIG_KEY, context);
    if (!inspected.enabled || !inspected.config) {
      span.setAttribute("ai.config.enabled", false);
      res.status(200).json(replyTo(question.text));
      return;
    }

    // Filled into the prompt's {{shopper_name}} and {{loyalty_tier}}. Sent
    // as variables rather than read off the context in the prompt, so a
    // guest reads as "a guest" instead of as an empty name.
    const variables = {
      shopper_name: isGuest(person) ? "a guest who has not signed in" : person.name,
      loyalty_tier: TIER_LABELS[person.tier],
    };
    const variationKey = inspected.meta?.variationKey ?? "";
    const modelName = inspected.config.model.name;
    const tools = swagAssistantTools(context);
    const client = await getServerClient();
    const served = servedByFor(variationKey, modelName);
    const attributes = {
      "ai.config.key": CONFIG_KEY,
      "ai.config.variation": variationKey,
      "ai.model": modelName,
    };
    span.setAttributes(attributes);

    const agentRun = startAgentRun(
      span,
      conversationIdFrom(req.body?.conversationId),
      "Swag Assistant",
      renderedMessages(inspected.config, { ...variables, ldContext: context })
        .filter((m) => m.role === "system")
        .map((m) => m.content)
        .join("\n\n"),
      question.text,
    );

    let conversation: Conversation | undefined;
    const handler = storeHandlers(async (config, _input, toolHandlers = {}, vars) => {
      const trackData = runTrackDataOf(vars);
      conversation = await converse(
        { ...config, messages: renderedMessages(config, vars) },
        toHistory(turns),
        question.text,
        tools,
        agentRun,
        toolCallReporter(client, context, trackData),
        toolFunctions(toolHandlers, tools.registry, context, trackData),
      );
      if (!conversation.metrics.success) {
        throw new UnusableAnswer(
          "The swag assistant returned an empty reply",
          conversation.content,
          conversation.metrics.tokens,
        );
      }
      return { output: conversation.content, usage: conversation.metrics.tokens };
    });

    let ran: Awaited<ReturnType<ReturnType<typeof aiConfig>["invoke"]>>;
    try {
      ran = await aiConfig({ key: CONFIG_KEY, handler, toolHandlers: tools.registry, skipJudges: true })
        .invoke(question.text, context, variables);
    } catch (err) {
      agentRun.fail(err);
      if (err instanceof UnusableAnswer) {
        LDObserve.recordLog("Swag assistant returned an empty reply", "warn", secureSessionId, requestId, attributes);
      } else {
        LDObserve.recordError(err as Error, secureSessionId, requestId, attributes, { span });
      }
      res.status(502).json({ error: "The swag assistant could not answer" });
      return;
    }
    const result = conversation!;

    span.setAttributes({
      "ai.tool_calls": result.metrics.toolCalls?.join(",") ?? "",
      "ai.tokens.total": result.metrics.tokens?.total ?? 0,
      "ai.looked_up_unsourced_price": result.lookedUp,
    });

    agentRun.finish(result.content, true);

    const replyId = randomUUID();
    rememberReply(replyId, ran.trackData);

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
    judge(ran.judgeTasks, context, transcript, result.content, (err) =>
      LDObserve.recordError(err as Error, secureSessionId, requestId, attributes),
    ).then(agentRun.scored, () => agentRun.scored());
  });
}
