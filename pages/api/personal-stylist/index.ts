import { randomUUID } from "crypto";
import type { NextApiRequest, NextApiResponse } from "next";
import { LDObserve } from "@launchdarkly/observability-node";
import type { LDAIMetrics } from "@launchdarkly/server-sdk-ai";
import {
  convertMessagesToLangChain,
  createLangChainModel,
  getAIUsageFromResponse,
} from "@launchdarkly/server-sdk-ai-langchain";
import type { AIMessage } from "@langchain/core/messages";
import { getAiClient, judge, rememberReply } from "@/lib/aiServer";
import { contextFromRequest } from "@/lib/ldServer";
import {
  PERSONAL_STYLIST_KEY,
  type StylistNote,
  type StylistReply,
} from "@/lib/personalStylist";
import { productBySlug } from "@/lib/products";
import { TIER_LABELS, isGuest, isMember, shopperById } from "@/lib/shopper";
import { servedByFor } from "@/lib/swagAssistant";
import { swagAssistantTools } from "@/lib/swagAssistantTools";

// The Personal Stylist's note on a product page, written by the Personal
// Stylist AI Config: a size, how it fits and what to wear it with, for the
// shopper looking at it.
//
// It is the store's second AI Config and works differently from the chat on
// purpose. Nobody asks it anything; the page asks for one note, the prompt
// is filled in with everything the note is written from, and one model call
// answers it. Its two variations are the same prompt on two models, Claude
// Sonnet 4.6 and Claude Opus 5.5, which is the shape of a model upgrade a
// guarded rollout watches: duration, errors, judges' scores and thumbs land
// on whichever model wrote the note.
//
// The facts come from the swag assistant's own tools, so the stylist and the
// chat cannot describe a product or an order two different ways.

// A note is written once per shopper, product and model, then kept: a page
// refresh should not cost a model call, and the same shopper should not see
// the note change under them. A different model, mid-rollout, is a new note.
const MAX_NOTES = 500;

const globalStore = globalThis as typeof globalThis & {
  stylistNotes?: Map<string, StylistNote>;
};
const notes = (globalStore.stylistNotes ??= new Map());

function remember(key: string, note: StylistNote) {
  notes.set(key, note);
  if (notes.size > MAX_NOTES) {
    const oldest = notes.keys().next().value;
    if (oldest !== undefined) notes.delete(oldest);
  }
}

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

type Written = { content: string; metrics: LDAIMetrics };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<StylistReply | { error: string }>,
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const slug = typeof req.body?.slug === "string" ? req.body.slug : "";
  const context = contextFromRequest(req.headers);
  const person = shopperById(typeof context.key === "string" ? context.key : "");
  const product = productBySlug(slug);
  if (!product || (product.membersOnly && !isMember(person))) {
    res.status(404).json({ error: "No such product" });
    return;
  }

  const aiClient = await getAiClient();
  if (!aiClient) {
    res.status(200).json({ note: null });
    return;
  }

  await LDObserve.runWithHeaders("personalStylist.note", req.headers, async (span) => {
    const { secureSessionId, requestId } = LDObserve.parseHeaders(req.headers);
    const tools = swagAssistantTools(context).registry;
    const productFacts = JSON.stringify(tools["get-product-details"]({ slug }));
    const orders = JSON.stringify(tools["get-order-status"]({}));

    const config = await aiClient.completionConfig(
      PERSONAL_STYLIST_KEY,
      context,
      { enabled: false },
      {
        shopper_name: isGuest(person) ? "a guest who has not signed in" : person.name,
        loyalty_tier: TIER_LABELS[person.tier],
        product_facts: productFacts,
        order_history: orders,
      },
    );

    if (!config.enabled) {
      span.setAttribute("ai.config.enabled", false);
      res.status(200).json({ note: null });
      return;
    }

    const tracker = config.createTracker();
    const { variationKey, modelName } = tracker.getTrackData();
    const cacheKey = `${context.key}|${slug}|${variationKey}`;
    const attributes = {
      "ai.config.key": PERSONAL_STYLIST_KEY,
      "ai.config.variation": variationKey,
      "ai.model": modelName,
      "product.slug": slug,
    };
    span.setAttributes(attributes);

    const kept = notes.get(cacheKey);
    if (kept) {
      span.setAttribute("ai.note.cached", true);
      res.status(200).json({ note: kept });
      return;
    }

    let written: Written;
    try {
      written = await tracker.trackMetricsOf(
        (w: Written) => w.metrics,
        async () => {
          const model = await createLangChainModel(config);
          const response = (await model.invoke(
            convertMessagesToLangChain(config.messages ?? []),
          )) as AIMessage;
          const content = textOf(response);
          return {
            content,
            metrics: {
              success: content.length > 0,
              tokens: getAIUsageFromResponse(response),
            },
          };
        },
      );
    } catch (err) {
      LDObserve.recordError(err as Error, secureSessionId, requestId, attributes, { span });
      res.status(502).json({ error: "The stylist could not write a note" });
      return;
    }

    if (!written.metrics.success) {
      LDObserve.recordLog("Personal stylist returned an empty note", "warn", secureSessionId, requestId, attributes);
      res.status(502).json({ error: "The stylist could not write a note" });
      return;
    }

    const note: StylistNote = {
      text: written.content,
      replyId: randomUUID(),
      servedBy: servedByFor(variationKey, modelName),
    };
    rememberReply(note.replyId, tracker.resumptionToken);
    remember(cacheKey, note);
    res.status(200).json({ note });

    // The judges read what the note was written from in the same "data:"
    // form the chat's tool results take, so one rubric serves both.
    const input = [
      `request: The stylist note for ${product.name}`,
      `data: product ${productFacts}`,
      `data: orders ${orders}`,
    ].join("\n");
    judge(aiClient, config, context, tracker, input, written.content).catch((err) =>
      LDObserve.recordError(err as Error, secureSessionId, requestId, attributes),
    );
  });
}
