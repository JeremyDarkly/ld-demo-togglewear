import { randomUUID } from "crypto";
import type { NextApiRequest, NextApiResponse } from "next";
import { LDObserve } from "@launchdarkly/observability-node";
import type { LDClient, LDContext } from "@launchdarkly/node-server-sdk";
import { config as aiConfig, inspectConfig, type TrackData } from "@launchdarkly/ai-node";
import type { AIMessage } from "@langchain/core/messages";
import { activityGroup } from "@/lib/activity";
import {
  UnusableAnswer,
  getAiClient,
  judge,
  rememberReply,
  runTrackDataOf,
  shopperLine,
  storeHandlers,
  textOf,
} from "@/lib/aiServer";
import { guard, LIMITS, text } from "@/lib/apiGuard";
import { codeChecksOn, runCodeChecks, stylistReplyUsable } from "@/lib/codeChecks";
import { langChainModel, renderedMessages, toLangChain, usageOf } from "@/lib/langchainModel";
import { contextFromRequest, getServerClient } from "@/lib/ldServer";
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
// Slugs are short; anything longer is not one of ours.
const MAX_SLUG_LENGTH = 100;

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

// The offline evals' check on the reply as the model wrote it, before
// pickedFrom drops a size or a pairing, while the response-code-checks flag
// serves true (lib/codeChecks.ts). It only sends events.
export async function checkReply(
  client: LDClient | null,
  context: LDContext,
  trackData: object,
  raw: string,
  product: Pick<Product, "sizes">,
  catalog: { slug: string }[],
) {
  if (!(await codeChecksOn(client, context))) return;
  runCodeChecks(client, context, trackData, {
    "stylist-reply-usable": () =>
      stylistReplyUsable(raw, product.sizes, catalog.map((p) => p.slug)),
  });
}

// Next refuses a bigger body with 413 before the handler runs.
export const config = { api: { bodyParser: { sizeLimit: "4kb" } } };

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
  if (!guard(req, res, "personal-stylist", LIMITS.ai)) return;

  const slug = text(req.body?.slug, MAX_SLUG_LENGTH) ?? "";
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

    const variables = {
      shopper_name: isGuest(person) ? "a guest who has not signed in" : person.name,
      loyalty_tier: TIER_LABELS[person.tier],
      product_facts: productFacts,
      order_history: orders,
      catalog: JSON.stringify(catalog),
    };

    // The variation this shopper gets, for the note kept from before, read
    // without running anything. invoke() throws for a config that is off.
    const inspected = await inspectConfig(PERSONAL_STYLIST_KEY, context);
    if (!inspected.enabled || !inspected.config) {
      span.setAttribute("ai.config.enabled", false);
      res.status(200).json({ note: null });
      return;
    }

    const variationKey = inspected.meta?.variationKey ?? "";
    const version = inspected.meta?.version ?? 1;
    const modelName = inspected.config.model.name;
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
    const shown = renderedMessages(inspected.config, { ...variables, ldContext: context });
    const asked = shown.filter((m) => m.role !== "system").map((m) => m.content).join("\n\n");
    const agentRun = startAgentRun(
      span,
      `stylist-note-${randomUUID()}`,
      "Personal Stylist",
      shown.filter((m) => m.role === "system").map((m) => m.content).join("\n\n"),
      asked,
    );

    // One model call. A note that does not parse is thrown, so the SDK
    // records it as a generation error, as the legacy tracker's success:
    // false was. It runs only on the variation inspected above, which the
    // note is labelled and kept under.
    let raw: string | undefined;
    let runTrackData: TrackData | undefined;
    let picked = null as Picked | null;
    const handler = storeHandlers(async (config, _input, _tools, vars) => {
      runTrackData = runTrackDataOf(vars);
      const model = await langChainModel(config);
      const response = await agentRun.modelCall(config.model.name, [asked], async () => {
        const response = (await model.invoke(
          toLangChain(renderedMessages(config, vars)),
        )) as AIMessage;
        return { response, usage: usageOf(response) };
      });
      raw = textOf(response);
      picked = pickedFrom(raw, product, catalog);
      if (!picked) throw new UnusableAnswer("The personal stylist returned no usable note", raw, usageOf(response));
      return { output: raw, usage: usageOf(response) };
    }, inspected.meta);

    let ran: Awaited<ReturnType<ReturnType<typeof aiConfig>["invoke"]>> | undefined;
    let failure: unknown;
    try {
      ran = await aiConfig({ key: PERSONAL_STYLIST_KEY, handler, skipJudges: true })
        .invoke(asked, context, variables);
    } catch (err) {
      failure = err;
    }

    // A cached note returned above, unchecked, as it goes unjudged. So is a
    // note whose model call failed, which wrote nothing to check.
    if (raw !== undefined && runTrackData) {
      await checkReply(await getServerClient(), context, runTrackData, raw, product, catalog);
    }

    if (!ran || !picked) {
      agentRun.fail(failure);
      if (failure instanceof UnusableAnswer) {
        LDObserve.recordLog("Personal stylist returned no usable note", "warn", secureSessionId, requestId, attributes);
      } else {
        LDObserve.recordError(failure as Error, secureSessionId, requestId, attributes, { span });
      }
      res.status(502).json({ error: "The stylist could not write a note" });
      return;
    }

    // What the judges and the trace read: the picks spelled out by name, so
    // a pairing can be checked against the catalog it came from.
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
    rememberReply(note.replyId, ran.trackData);
    remember(cacheKey, note);
    res.status(200).json({ note });

    // The judges read what the note was written from, the shopper first, in
    // the same "data:" form the chat's tool results take, so one rubric
    // serves both.
    const input = [
      shopperLine(variables),
      `request: The stylist note for ${product.name}`,
      `data: product ${productFacts}`,
      `data: orders ${orders}`,
      `data: catalog ${JSON.stringify(catalog)}`,
    ].join("\n");
    judge(ran.judgeTasks, context, input, answer, (err) =>
      LDObserve.recordError(err as Error, secureSessionId, requestId, attributes),
    ).then(agentRun.scored, () => agentRun.scored());
  });
}
