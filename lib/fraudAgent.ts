// The fraud review that sits in front of Place Order.
//
// Orders are reviewed by the Order Review agent graph in LaunchDarkly
// (pages/api/order-review). This file is its rules and its fallback: the
// agents' tools find their signals with the checks below, and with the graph
// switched off, or the models unreachable, assessOrder reviews the order
// itself, the same shape as the swag assistant's scripted replies.
//
// Deterministic on purpose. An SE has to be able to produce any outcome on
// stage on the first try, so each one has its own lever and each lever works
// on its own:
//
//   approve  — the prefilled form, untouched
//   review   — push the cart over $800, such as the drone and the VR
//              headset together, or raise any line to quantity 5
//   decline  — change the ZIP to 99999, or do both of the review levers at
//              once, since two soft signals together clear the hard bar

export type FraudDecision = "approve" | "review" | "decline";

export type RiskSignal = {
  label: string;
  points: number;
};

export type FraudAssessment = {
  decision: FraudDecision;
  score: number;
  signals: RiskSignal[];
  summary: string;
};

export type OrderUnderReview = {
  zip: string;
  total: number;
  maxLineQuantity: number;
};

// The fallback's thresholds. The Order Decision agent's own are in its
// instructions in LaunchDarkly, as the same numbers, so sliding its review
// threshold down to 30 holds the ordinary order without a deploy.
//
// The two soft signals are weighted at 45 each so that either one on its own
// clears REVIEW_AT, and the two together clear DECLINE_AT. Anything less and
// a lever looks broken on stage: the signal shows up in the panel but the
// order sails through anyway.
const REVIEW_AT = 40;
const DECLINE_AT = 70;
const SOFT_SIGNAL_POINTS = 45;

// The value above which an order is worth a second look. High enough that
// any one tech item goes through on its own, since the drone alone is $599.
const HIGH_VALUE_USD = 800;

// The quantity that reads as resale rather than a personal order.
const BULK_QUANTITY = 5;

// The blocklist. One entry, because it only exists to be the lever.
const BLOCKED_ZIPS = ["99999"];

export function isBlockedZip(zip: string) {
  return BLOCKED_ZIPS.includes(zip.trim());
}

// The checks behind the Order Review agents' tools (lib/orderReviewTools.ts)
// as well as the scripted review below, so the agents and their fallback
// always find the same signals in the same order.
export function shippingSignals(order: OrderUnderReview): RiskSignal[] {
  if (!isBlockedZip(order.zip)) return [];
  return [
    {
      label: `Shipping ZIP ${order.zip.trim()} matches a known reshipping address`,
      points: 80,
    },
  ];
}

export function paymentSignals(order: OrderUnderReview): RiskSignal[] {
  const signals: RiskSignal[] = [];

  if (order.total > HIGH_VALUE_USD) {
    signals.push({
      label: `Order value is above the $${HIGH_VALUE_USD} review threshold`,
      points: SOFT_SIGNAL_POINTS,
    });
  }

  if (order.maxLineQuantity >= BULK_QUANTITY) {
    signals.push({
      label: `A single item is ordered ${order.maxLineQuantity} times, consistent with resale`,
      points: SOFT_SIGNAL_POINTS,
    });
  }

  return signals;
}

export function riskScore(signals: RiskSignal[]) {
  return Math.min(
    100,
    signals.reduce((sum, signal) => sum + signal.points, 0),
  );
}

export function decisionFor(score: number): FraudDecision {
  return score >= DECLINE_AT ? "decline" : score >= REVIEW_AT ? "review" : "approve";
}

export function assessOrder(order: OrderUnderReview): FraudAssessment {
  const signals = [...shippingSignals(order), ...paymentSignals(order)];
  const score = riskScore(signals);
  const decision = decisionFor(score);

  return { decision, score, signals, summary: SUMMARIES[decision] };
}

const SUMMARIES: Record<FraudDecision, string> = {
  approve:
    "Nothing on this order looks unusual. Payment captured and the order is on its way to fulfilment.",
  review:
    "This order is going to a human reviewer before it ships. Nothing has been charged yet.",
  decline:
    "This order has been stopped. No payment was taken and nothing will ship.",
};

// Order numbers are demo props, not records, so they only have to look right
// and not repeat within a session. Shaped like Jen's #TW-2026-98741.
export function orderNumber(now = new Date()) {
  const serial = Math.floor(10000 + Math.random() * 90000);
  return `TW-${now.getFullYear()}-${serial}`;
}
