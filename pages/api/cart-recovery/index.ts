import { randomUUID } from "crypto";
import type { NextApiRequest, NextApiResponse } from "next";
import { LDObserve } from "@launchdarkly/observability-node";
import type { LDAIMetrics } from "@launchdarkly/server-sdk-ai";
import {
  createLangChainModel,
  getAIUsageFromResponse,
} from "@launchdarkly/server-sdk-ai-langchain";
import { HumanMessage, SystemMessage, type AIMessage } from "@langchain/core/messages";
import { getAiClient, judge } from "@/lib/aiServer";
import { resolveLines, type CartLine } from "@/lib/cart";
import {
  CART_RECOVERY_KEY,
  OFFERS,
  OFFER_LINES,
  type CartRecoveryReply,
  type Offer,
} from "@/lib/cartRecovery";
import { contextFromRequest } from "@/lib/ldServer";
import { startAgentRun } from "@/lib/llmTrace";
import { TIER_LABELS, isGuest, shopperById } from "@/lib/shopper";

// The line in the announcement bar for a signed-in shopper who came back to
// a cart they left, written by the Cart Recovery agent.
//
// Flag 08 decides who has an abandoned cart; this decides what they are
// told. The agent writes one sentence about what is in their cart and, where
// its variation allows a choice, picks the offer to go with it. The four
// variations are the arms of an experiment on order revenue: a reminder
// alone, a free sticker pack, 10% off, and the agent's own pick of the three.
//
// Which offers a variation allows is its custom "offers" parameter, and the
// agent answers by filling in a schema whose offer can only be one of them,
// so an arm cannot drift into another arm's strategy. The offer's wording,
// with its code, is the store's (lib/cartRecovery.ts), so the agent cannot
// promise a discount the cart does not give.

// Long enough for one sentence about a cart. A longer answer is a model
// ignoring its instructions, and the bar falls back to its own line.
const MAX_MESSAGE_LENGTH = 100;

// A line is written once per shopper, cart and variation, then kept: every
// page draws its own bar, and moving between pages should neither cost a
// model call nor change what the bar says.
const MAX_LINES = 500;

const globalStore = globalThis as typeof globalThis & {
  cartRecoveryLines?: Map<string, { message: string; offer: Offer }>;
};
const kept = (globalStore.cartRecoveryLines ??= new Map());

function remember(key: string, line: { message: string; offer: Offer }) {
  kept.set(key, line);
  if (kept.size > MAX_LINES) {
    const oldest = kept.keys().next().value;
    if (oldest !== undefined) kept.delete(oldest);
  }
}

function isLines(value: unknown): value is CartLine[] {
  return (
    Array.isArray(value) &&
    value.length <= 50 &&
    value.every(
      (line) =>
        typeof line?.slug === "string" &&
        typeof line?.size === "string" &&
        Number.isInteger(line?.quantity) &&
        line.quantity > 0,
    )
  );
}

function offersOf(custom: Record<string, unknown> | undefined): Offer[] {
  const offers = Array.isArray(custom?.offers) ? custom.offers : [];
  const known = offers.filter((o): o is Offer => OFFERS.includes(o as Offer));
  return known.length ? known : ["none"];
}

type Written = { message: string; offer: Offer; metrics: LDAIMetrics };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<CartRecoveryReply | { error: string }>,
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const context = contextFromRequest(req.headers);
  const person = shopperById(typeof context.key === "string" ? context.key : "");
  const lines = isLines(req.body?.lines) ? resolveLines(req.body.lines) : [];
  // Guests are flag 08's own experiment and never get the reminder.
  if (isGuest(person) || lines.length === 0) {
    res.status(200).json({ recovery: null });
    return;
  }

  const aiClient = await getAiClient();
  if (!aiClient) {
    res.status(200).json({ recovery: null });
    return;
  }

  await LDObserve.runWithHeaders("cartRecovery.line", req.headers, async (span) => {
    const { secureSessionId, requestId } = LDObserve.parseHeaders(req.headers);
    const config = await aiClient.agentConfig(CART_RECOVERY_KEY, context, { enabled: false });
    if (!config.enabled) {
      span.setAttribute("ai.config.enabled", false);
      res.status(200).json({ recovery: null });
      return;
    }

    const tracker = config.createTracker();
    const { variationKey, modelName } = tracker.getTrackData();
    const offers = offersOf(config.model?.custom);
    const attributes = {
      "ai.config.key": CART_RECOVERY_KEY,
      "ai.config.variation": variationKey,
      "ai.model": modelName,
      "cart.lines": lines.length,
    };
    span.setAttributes(attributes);

    const cartKey = lines.map((l) => `${l.slug}:${l.size}:${l.quantity}`).sort().join(",");
    const cacheKey = `${context.key}|${variationKey}|${cartKey}`;
    const known = kept.get(cacheKey);
    if (known) {
      span.setAttribute("ai.line.cached", true);
      res.status(200).json({ recovery: known });
      return;
    }

    const subtotal = lines.reduce((sum, l) => sum + l.product.priceUsd * l.quantity, 0);
    const cart = lines.map((l) => ({
      product: l.product.name,
      size: l.size,
      quantity: l.quantity,
      priceUsd: l.product.priceUsd,
    }));
    const input = [
      `Shopper: ${person.name.split(" ")[0]}, loyalty tier ${TIER_LABELS[person.tier]}, ` +
        `${person.orderCount} past orders`,
      `Cart subtotal: $${subtotal} USD`,
      `Cart, as JSON: ${JSON.stringify(cart)}`,
      `Offers you may attach: ${offers.join(", ")}`,
    ].join("\n");

    const schema = {
      type: "object",
      properties: {
        message: {
          type: "string",
          description: "One sentence for the bar, without any offer, code or price.",
        },
        offer: { type: "string", enum: offers },
      },
      required: ["message", "offer"],
    };

    const instructions = config.instructions ?? "";
    const agentRun = startAgentRun(
      span,
      `cart-recovery-${randomUUID()}`,
      "Cart Recovery",
      instructions,
      input,
    );

    let written: Written;
    try {
      written = await tracker.trackMetricsOf(
        (w: Written) => w.metrics,
        async () => {
          const llm = await createLangChainModel(config);
          let parsed: { message?: unknown; offer?: unknown } | undefined;
          const raw = await agentRun.modelCall(modelName, [input], async () => {
            const result = await llm
              .withStructuredOutput(schema, { name: "write_reminder", includeRaw: true })
              .invoke([new SystemMessage(instructions), new HumanMessage(input)]);
            parsed = result.parsed as typeof parsed;
            const response = result.raw as AIMessage;
            return {
              response,
              usage: getAIUsageFromResponse(response),
              output: parsed ? JSON.stringify(parsed) : undefined,
            };
          });
          const message = typeof parsed?.message === "string" ? parsed.message.trim() : "";
          const offer = offers.find((o) => o === parsed?.offer);
          return {
            message,
            offer: offer ?? "none",
            metrics: {
              success:
                Boolean(offer) && message.length > 0 && message.length <= MAX_MESSAGE_LENGTH,
              tokens: getAIUsageFromResponse(raw),
            },
          };
        },
      );
    } catch (err) {
      agentRun.fail(err);
      LDObserve.recordError(err as Error, secureSessionId, requestId, attributes, { span });
      res.status(200).json({ recovery: null });
      return;
    }

    if (!written.metrics.success) {
      agentRun.fail(new Error(`The cart recovery agent wrote no usable line: ${written.message.slice(0, 200)}`));
      LDObserve.recordLog("Cart recovery agent wrote no usable line", "warn", secureSessionId, requestId, attributes);
      res.status(200).json({ recovery: null });
      return;
    }

    const recovery = { message: written.message, offer: written.offer };
    const output = JSON.stringify(recovery);
    agentRun.finish(output, true);
    remember(cacheKey, recovery);
    res.status(200).json({ recovery });

    // The judges read the cart the line was written from, and the offer the
    // store attached to it, in the "data:" form the stylist's notes take.
    const judgeInput = [
      "request: The cart reminder line for a shopper who came back to their cart",
      `data: cart ${JSON.stringify(cart)}`,
      `data: offer shown after the line "${OFFER_LINES[recovery.offer] || "none"}"`,
    ].join("\n");
    judge(aiClient, config, context, tracker, judgeInput, recovery.message)
      .then(agentRun.scored)
      .catch((err) => {
        agentRun.scored();
        LDObserve.recordError(err as Error, secureSessionId, requestId, attributes);
      });
  });
}
