import type { LDContext } from "@launchdarkly/node-server-sdk";
import type { ToolRegistry } from "@launchdarkly/server-sdk-ai";
import { ordersFor } from "@/lib/account";
import { resolveLines } from "@/lib/cart";
import { paymentSignals, shippingSignals, type RiskSignal } from "@/lib/fraudAgent";
import { underReview, type OrderReviewRequest } from "@/lib/orderReview";
import { TIER_LABELS, isGuest, isMember, shopperById } from "@/lib/shopper";

// What the Order Review agents' tools actually do, for one order. Their
// names, descriptions and schemas live in LaunchDarkly (AI_TOOLS in
// demo_resources.py) and are attached to the agents there; the keys below
// have to match those tool keys exactly.
//
// The risk checks are lib/fraudAgent.ts's, so the agents find exactly the
// signals the scripted review would. Each signal a tool returns is also kept
// here, and the score at checkout is added up from these rather than taken
// from a model, so the number in the panel always matches the signals it
// lists.
export type OrderReviewTools = {
  registry: ToolRegistry;
  signals: RiskSignal[];
};

export function orderReviewTools(
  order: OrderReviewRequest,
  context: LDContext,
): OrderReviewTools {
  const person = shopperById(typeof context.key === "string" ? context.key : "");
  const lines = resolveLines(order.lines);
  const facts = underReview(order);
  const found = new Map<string, RiskSignal[]>();

  const signalsFrom = (tool: string, signals: RiskSignal[]) => {
    found.set(tool, signals);
    return signals.map((s) => ({ signal: s.label, points: s.points }));
  };

  const registry: ToolRegistry = {
    "get-order-details": () => ({
      order_number: order.ref,
      items: lines.map((line) => ({
        name: line.product.name,
        size: line.size,
        quantity: line.quantity,
        unit_price_usd: line.product.priceUsd,
      })),
      total_usd: order.total,
      payment_method: order.payment,
      ships_to: `${order.shipTo.city}, ${order.shipTo.state} ${order.shipTo.zip}`,
      placed_by: isGuest(person)
        ? "a guest who has not signed in"
        : isMember(person)
          ? `${person.name}, a ${TIER_LABELS[person.tier]} member, signed in`
          : `${person.name}, signed in`,
    }),

    "check-payment-risk": () => ({
      total_usd: facts.total,
      most_of_one_item: facts.maxLineQuantity,
      signals: signalsFrom("check-payment-risk", paymentSignals(facts)),
    }),

    "check-shipping-address": () => ({
      ships_to: `${order.shipTo.city}, ${order.shipTo.state} ${order.shipTo.zip}`,
      signals: signalsFrom("check-shipping-address", shippingSignals(facts)),
    }),

    "get-account-history": () => {
      if (isGuest(person)) {
        return { signed_in: false, past_orders: [] };
      }
      return {
        signed_in: true,
        name: person.name,
        loyalty_tier: TIER_LABELS[person.tier],
        customer_since: person.joined,
        orders_placed: person.orderCount,
        past_orders: ordersFor(person).map((past) => ({
          order_number: past.ref,
          placed_on: past.placedOn,
          items: past.lines.reduce((sum, line) => sum + line.quantity, 0),
          shipped_to: past.destination,
          status: past.status,
        })),
      };
    },
  };

  return {
    registry,
    get signals() {
      // Shipping first, as the scripted review lists them.
      return [
        ...(found.get("check-shipping-address") ?? []),
        ...(found.get("check-payment-risk") ?? []),
      ];
    },
  };
}
