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
import { getAiClient, textOf } from "@/lib/aiServer";
import { contextFromRequest, getServerClient } from "@/lib/ldServer";
import { startAgentRun } from "@/lib/llmTrace";
import { memberPriceUsd, productsFor, type Product } from "@/lib/products";
import { searchProducts } from "@/lib/search";
import { shopperById, variantFor } from "@/lib/shopper";
import {
  SMART_SEARCH_FAILED_KEY,
  SMART_SEARCH_KEY,
  type SmartSearchPick,
  type SmartSearchReply,
} from "@/lib/smartSearch";
import { servedByFor } from "@/lib/swagAssistant";

// Picks for a search, written by the Smart Search AI Config: up to three
// products that fit what the shopper meant, from their own catalogue, under
// the panel's word-match results.
//
// It is the store's adaptive trigger on an AI Config. Its two variations are
// two providers, Llama 4 Maverick on Meta and Claude Sonnet 4.6 on
// Anthropic, and every failed search sends smart-search-failed, which the
// trigger's alert counts. The search model outage switch in the account
// menu fails the Meta calls only, as a provider outage would, so once the
// trigger moves the default rule to Claude the picks come back by
// themselves.

const MAX_PICKS = 3;
const MAX_QUERY_LENGTH = 100;

// "under $50", "below 40", "less than $30": a limit the shopper typed, which
// the model was seen to break, so it is enforced here rather than asked for.
const PRICE_LIMIT = /\b(?:under|below|less than|max)\s*\$?\s*(\d+(?:\.\d+)?)/i;

type Answered = { picks: SmartSearchPick[] | null; metrics: LDAIMetrics };

function shopperPrice(product: Product, member: boolean) {
  return member ? memberPriceUsd(product.priceUsd) : product.priceUsd;
}

// Only what a pick can be justified from: no images, sizes or colours, which
// would cost tokens and invite the model to describe things it cannot see.
function catalogFor(catalogue: Product[], member: boolean) {
  return catalogue.map((product) => ({
    slug: product.slug,
    name: product.name,
    priceUsd: shopperPrice(product, member),
    category: product.category,
    description: product.description,
    detail: product.detail.split("\n")[0],
  }));
}

// The reply is meant to be bare JSON but sometimes arrives fenced or with a
// sentence around it, so the object is cut out before parsing. Anything that
// still does not parse is a failed answer. Picks are kept only for products
// in this shopper's catalogue, within any price they typed and not already
// in the word-match results above the row.
function picksFrom(
  text: string,
  catalogue: Product[],
  member: boolean,
  query: string,
  shown: Set<string>,
): SmartSearchPick[] | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  const raw = (parsed as { picks?: unknown }).picks;
  if (!Array.isArray(raw)) return null;

  const limit = query.match(PRICE_LIMIT);
  const maxPrice = limit ? Number(limit[1]) : Infinity;
  const bySlug = new Map(catalogue.map((product) => [product.slug, product]));
  const picks: SmartSearchPick[] = [];

  for (const entry of raw) {
    const { slug, reason } = (entry ?? {}) as { slug?: unknown; reason?: unknown };
    const product = typeof slug === "string" ? bySlug.get(slug) : undefined;
    if (!product || shown.has(product.slug)) continue;
    if (shopperPrice(product, member) > maxPrice) continue;
    if (picks.some((pick) => pick.slug === product.slug)) continue;
    picks.push({
      slug: product.slug,
      ...(typeof reason === "string" && reason.trim() ? { reason: reason.trim() } : {}),
    });
    if (picks.length === MAX_PICKS) break;
  }
  return picks;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SmartSearchReply | { error: string }>,
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const query =
    typeof req.body?.query === "string" ? req.body.query.trim().slice(0, MAX_QUERY_LENGTH) : "";
  if (!query) {
    res.status(400).json({ error: "No search" });
    return;
  }
  const outage = req.body?.outage === true;

  const context = contextFromRequest(req.headers);
  const person = shopperById(typeof context.key === "string" ? context.key : "");
  const variant = variantFor(person.tier);
  const member = variant === "loyaltyGold";
  const catalogue = productsFor(variant);

  const aiClient = await getAiClient();
  if (!aiClient) {
    res.status(200).json({ picks: null });
    return;
  }

  await LDObserve.runWithHeaders("smartSearch.picks", req.headers, async (span) => {
    const { secureSessionId, requestId } = LDObserve.parseHeaders(req.headers);

    const config = await aiClient.completionConfig(
      SMART_SEARCH_KEY,
      context,
      { enabled: false },
      { catalog: JSON.stringify(catalogFor(catalogue, member)), query },
    );

    if (!config.enabled) {
      span.setAttribute("ai.config.enabled", false);
      res.status(200).json({ picks: null });
      return;
    }

    const tracker = config.createTracker();
    const { variationKey, modelName } = tracker.getTrackData();
    const attributes = {
      "ai.config.key": SMART_SEARCH_KEY,
      "ai.config.variation": variationKey,
      "ai.model": modelName,
      "search.outage": outage,
    };
    span.setAttributes(attributes);

    const messages = config.messages ?? [];
    const agentRun = startAgentRun(
      span,
      `smart-search-${randomUUID()}`,
      "Smart Search",
      messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n"),
      query,
    );
    const shown = new Set(searchProducts(variant, query).map((product) => product.slug));

    let answered: Answered;
    try {
      answered = await tracker.trackMetricsOf(
        (a: Answered) => a.metrics,
        async () => {
          // Inside the tracked call, so the outage lands on the variation as
          // a generation error the way a real provider failure would.
          if (outage && /(^|\.)meta\./.test(modelName)) {
            const error = new Error(`${modelName} is unavailable (simulated search model outage)`);
            error.name = "ServiceUnavailableException";
            throw error;
          }
          const model = await createLangChainModel(config);
          const response = await agentRun.modelCall(modelName, [query], async () => {
            const response = (await model.invoke(
              convertMessagesToLangChain(messages),
            )) as AIMessage;
            return { response, usage: getAIUsageFromResponse(response) };
          });
          const picks = picksFrom(textOf(response), catalogue, member, query, shown);
          return {
            picks,
            metrics: { success: picks !== null, tokens: getAIUsageFromResponse(response) },
          };
        },
      );
    } catch (err) {
      agentRun.fail(err);
      LDObserve.recordError(err as Error, secureSessionId, requestId, attributes, { span });
      (await getServerClient())?.track(SMART_SEARCH_FAILED_KEY, context, { model: modelName }, 1);
      res.status(502).json({ error: "Smart search could not answer" });
      return;
    }

    if (!answered.metrics.success) {
      agentRun.fail(new Error("Smart search returned no usable JSON"));
      LDObserve.recordLog("Smart search returned no usable JSON", "warn", secureSessionId, requestId, attributes);
      (await getServerClient())?.track(SMART_SEARCH_FAILED_KEY, context, { model: modelName }, 1);
      res.status(502).json({ error: "Smart search could not answer" });
      return;
    }

    agentRun.finish(JSON.stringify(answered.picks), true);
    res.status(200).json({
      picks: answered.picks,
      servedBy: servedByFor(variationKey, modelName),
    });
  });
}
