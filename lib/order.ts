import type { CartLine, CartTotals } from "./cart";
import type { PricingVariant } from "./products";

// A placed order, snapshotted at the moment Place Order succeeded.
//
// The totals are stored rather than recomputed because a receipt has to show
// what was actually paid. The lines are stored as slugs and re-resolved on
// the confirmation page, so the snapshot stays small and serialisable.
export type PlacedOrder = {
  ref: string;
  lines: CartLine[];
  variant: PricingVariant;
  totals: CartTotals;
  // ISO so the stored order survives JSON, formatted at render time.
  deliveryBy: string;
  shipTo: ShipTo;
  paymentLabel: string;
  // Carried through so the receipt can say the agent cleared the order. The
  // agent running and nobody seeing it is a wasted demo beat.
  riskScore: number;
  // The scripted rules cleared it rather than the Order Review agents,
  // because the agent graph was off or out of reach. Absent on orders
  // stored before the agents existed.
  scripted?: boolean;
};

export type ShipTo = {
  name: string;
  street: string;
  apartment: string;
  city: string;
  state: string;
  zip: string;
};

// Jen writes the address as one line under the name.
export function addressLine(ship: ShipTo) {
  return [ship.street, ship.apartment, `${ship.city}, ${ship.state} ${ship.zip}`]
    .filter((part) => part.trim().length > 0)
    .join(", ");
}

// FLAG: the shipping promise. Jen's copy says 3-5 business days, so the
// estimate takes the slow end — a date that arrives early is a nicer
// surprise than one that arrives late.
const DELIVERY_BUSINESS_DAYS = 5;

export function estimateDelivery(from = new Date()) {
  const date = new Date(from);
  let remaining = DELIVERY_BUSINESS_DAYS;
  while (remaining > 0) {
    date.setDate(date.getDate() + 1);
    const day = date.getDay();
    if (day !== 0 && day !== 6) remaining -= 1;
  }
  return date;
}

// "Wednesday, September 16, 2026", matching Jen's string. Called on the
// client only, so there is no server/client locale mismatch to worry about.
export function formatDeliveryDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

// Jen's receipt says "Visa •••• 4242" where the checkout said "Credit Card
// ending in •••• 4242", so the label is per-screen rather than one string.
export const PAYMENT_LABELS: Record<string, string> = {
  card: "Visa •••• 4242",
  paypal: "PayPal",
  applePay: "Apple Pay",
};

export function paymentLabel(method: string) {
  return PAYMENT_LABELS[method] ?? PAYMENT_LABELS.card;
}
