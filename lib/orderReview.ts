import type { CartLine } from "@/lib/cart";
import type { FraudAssessment, OrderUnderReview } from "@/lib/fraudAgent";
import type { ShipTo } from "@/lib/order";

// The Order Review agent graph, which reviews every order at checkout. Its
// agents, their instructions and tools, and the graph joining them are all in
// LaunchDarkly (AGENT_CONFIGS and AGENT_GRAPHS in demo_resources.py);
// pages/api/order-review runs it and streams each agent's progress here.
export const ORDER_REVIEW_GRAPH_KEY = "order-review";

// The agents in the order the checkout panel lists them, which is the order
// they run in. The keys have to match the graph's nodes. The names are ours
// rather than read from LaunchDarkly because an agent config evaluated by
// the SDK does not carry its name.
export const ORDER_REVIEW_AGENTS = [
  { key: "order-intake-agent", name: "Order Intake" },
  { key: "payment-risk-agent", name: "Payment Risk" },
  { key: "shipping-check-agent", name: "Shipping Check" },
  { key: "account-history-agent", name: "Account History" },
  { key: "fraud-decision-agent", name: "Order Decision" },
  { key: "case-note-agent", name: "Case Note" },
] as const;

export type OrderReviewAgentKey = (typeof ORDER_REVIEW_AGENTS)[number]["key"];

// What checkout sends: the order as the shopper is about to place it. The
// total is the one the cart showed, discount and tax included.
export type OrderReviewRequest = {
  ref: string;
  lines: CartLine[];
  total: number;
  shipTo: ShipTo;
  payment: string;
};

// The three facts the risk rules in lib/fraudAgent.ts look at.
export function underReview(order: OrderReviewRequest): OrderUnderReview {
  return {
    zip: order.shipTo.zip,
    total: order.total,
    maxLineQuantity: order.lines.reduce((most, line) => Math.max(most, line.quantity), 0),
  };
}

export type AgentStep = {
  key: OrderReviewAgentKey;
  status: "running" | "done" | "failed";
  // What the agent wrote, once it is done.
  text?: string;
  // The model it ran on, as a room would say it: "Claude Haiku 4.5".
  model?: string;
  ms?: number;
};

// The response is newline-delimited JSON, one of these per line: a step each
// time an agent starts or finishes, and the result as soon as the decision
// is made. The Case Note agent's steps come after the result, since its note
// is for the review team and the shopper should not wait for it. A review
// the graph did not run — switched off, or a model failed — is a single
// scripted result.
export type OrderReviewEvent =
  | { type: "step"; step: AgentStep }
  | { type: "result"; assessment: FraudAssessment; scripted?: boolean };
