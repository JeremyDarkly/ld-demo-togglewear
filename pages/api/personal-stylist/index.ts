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
import { activityGroup } from "@/lib/activity";
import { getAiClient, judge, rememberReply, textOf } from "@/lib/aiServer";
import { contextFromRequest } from "@/lib/ldServer";
import { startAgentRun } from "@/lib/llmTrace";
import {
  PERSONAL_STYLIST_KEY,
  stylistCatalogFor,
  type StylistNote,
  type StylistReply,
} from "@/lib/personalStylist";
import { productBySlug, type Product } from "@/lib/products";
import { TIER_LABELS, isGuest, isMember, shopperById } from "@/lib/shopper";
import { servedByFor } from "@/lib/swagAssistant";
import { swagAssistantTools } from "@/lib/swagAssistantTools";

// The Personal Stylist's note on a product page, written by the Personal
// Stylist AI Config: a size, one other product to go with it and a short note
// on both, for the shopper looking at it. The page selects the size and shows
// the pairing as a card to add, and adding either is the metric a model
// change is judged on beside the judges' scores.
//
// It is the store's second AI Config and works differently from the chat on
// purpose. Nobody asks it anything; the page asks for one note, the prompt
// is filled in with everything the note is written from, and one model call
// answers it. Its two variations are the same prompt on two models, Claude
// Sonnet 4.6 and Claude Opus 5.5, which is the shape of a model upgrade a
// guarded rollout watches: duration, errors, judges' scores, thumbs and
// whether the shopper added what it suggested land on whichever model wrote
// the note.
//
// The facts come from the swag assistant's own tools, so the stylist and the
// chat cannot describe a product or an order two different ways.

// A note is written once per shopper, product and model, then kept: a page
// refresh should not cost a model call, and the same shopper should not see
// the note change under them. A different model, mid-rollout, or a new
// version of the prompt is a new note.
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

type Picked = { text: string; size?: string; pairing?: string };
type Written = { picked: Picked | null; metrics: LDAIMetrics };

// The reply is meant to be bare JSON but sometimes arrives fenced or with a
// sentence around it, so the object is cut out before parsing. With no note
// it is a failed answer. A size the product does not come in, or a pairing
// that is not in the catalog the stylist was given, is dropped rather than
// shown, and the note still stands.
function pickedFrom(text: string, product: Product, catalog: { slug: string }[]): Picked | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) return null;

  let parsed: { size?: unknown; pairing?: unknown; note?: unknown };
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  const note = typeof parsed.note === "string" ? parsed.note.trim() : "";
  if (!note) return null;

  const { size, pairing } = parsed;
  return {
    text: note,
    ...(typeof size === "string" && product.sizes.length > 1 && product.sizes.includes(size)
      ? { size }
      : {}),
    ...(typeof pairing === "string" && catalog.some((p) => p.slug === pairing) ? { pairing } : {}),
  };
}

export default activityGroup("Personal Stylist", handler);

async function handler(
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
    const catalog = stylistCatalogFor(person, slug);

    const config = await aiClient.completionConfig(
      PERSONAL_STYLIST_KEY,
      context,
      { enabled: false },
      {
        shopper_name: isGuest(person) ? "a guest who has not signed in" : person.name,
        loyalty_tier: TIER_LABELS[person.tier],
        product_facts: productFacts,
        order_history: orders,
        catalog: JSON.stringify(catalog),
      },
    );

    if (!config.enabled) {
      span.setAttribute("ai.config.enabled", false);
      res.status(200).json({ note: null });
      return;
    }

    const tracker = config.createTracker();
    const { variationKey, version, modelName } = tracker.getTrackData();
    // The version too, so a prompt edited in LaunchDarkly shows on the next
    // page load rather than after the server restarts.
    const cacheKey = `${context.key}|${slug}|${variationKey}|${version}`;
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

    // Each note is a conversation of one turn: the prompt filled in for
    // this shopper and product, and the note.
    const messages = config.messages ?? [];
    const asked = messages.filter((m) => m.role !== "system").map((m) => m.content).join("\n\n");
    const agentRun = startAgentRun(
      span,
      `stylist-note-${randomUUID()}`,
      "Personal Stylist",
      messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n"),
      asked,
    );

    let written: Written;
    try {
      written = await tracker.trackMetricsOf(
        (w: Written) => w.metrics,
        async () => {
          const model = await createLangChainModel(config);
          const response = await agentRun.modelCall(modelName, [asked], async () => {
            const response = (await model.invoke(
              convertMessagesToLangChain(messages),
            )) as AIMessage;
            return { response, usage: getAIUsageFromResponse(response) };
          });
          const picked = pickedFrom(textOf(response), product, catalog);
          return {
            picked,
            metrics: {
              success: picked !== null,
              tokens: getAIUsageFromResponse(response),
            },
          };
        },
      );
    } catch (err) {
      agentRun.fail(err);
      LDObserve.recordError(err as Error, secureSessionId, requestId, attributes, { span });
      res.status(502).json({ error: "The stylist could not write a note" });
      return;
    }

    if (!written.picked) {
      agentRun.fail(new Error("The personal stylist returned no usable note"));
      LDObserve.recordLog("Personal stylist returned no usable note", "warn", secureSessionId, requestId, attributes);
      res.status(502).json({ error: "The stylist could not write a note" });
      return;
    }

    // What the judges and the trace read: the picks spelled out by name, so
    // a pairing can be checked against the catalog it came from.
    const { picked } = written;
    const pairingName = picked.pairing ? productBySlug(picked.pairing)?.name : undefined;
    const answer = [
      `Size: ${picked.size ?? "one size"}`,
      `Pairing: ${pairingName ?? "none"}`,
      `Note: ${picked.text}`,
    ].join("\n");
    agentRun.finish(answer, true);
    const note: StylistNote = {
      ...picked,
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
      `data: catalog ${JSON.stringify(catalog)}`,
    ].join("\n");
    judge(aiClient, config, context, tracker, input, answer)
      .then(agentRun.scored)
      .catch((err) => {
        agentRun.scored();
        LDObserve.recordError(err as Error, secureSessionId, requestId, attributes);
      });
  });
}
