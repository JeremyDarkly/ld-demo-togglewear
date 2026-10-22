import type { CartLine } from "@/lib/cart";
import {
  COMEBACK_CODE,
  COMEBACK_DISCOUNT,
  STICKERS_CODE,
} from "@/lib/products";

// The Cart Recovery AI Config's key. The announcement bar asks
// /api/cart-recovery for its line whenever flag 08 serves the cart reminder.
export const CART_RECOVERY_KEY = "cart-recovery-agent";

// What the agent may attach to its line. Which of these a variation offers
// is that variation's custom "offers" parameter in LaunchDarkly, so the
// strategy each arm of the experiment tests lives with the arm.
export const OFFERS = ["none", "sticker-pack", "comeback"] as const;
export type Offer = (typeof OFFERS)[number];

// The offer's half of the bar, written by the store rather than the agent,
// so the code and the rate are always ones the cart honours. Built from the
// constants for the same reason the bar's own lines are.
export const OFFER_LINES: Record<Offer, string> = {
  none: "",
  "sticker-pack": `Use code ${STICKERS_CODE} for a free sticker pack`,
  comeback: `Take ${Math.round(COMEBACK_DISCOUNT * 100)}% off with code ${COMEBACK_CODE}`,
};

export type CartRecoveryRequest = { lines: CartLine[] };

// A null line means the config is off, LaunchDarkly is unreachable or the
// agent failed, and the bar shows its own reminder instead.
export type CartRecoveryReply = {
  recovery: { message: string; offer: Offer } | null;
};

export function recoveryText({ message, offer }: { message: string; offer: Offer }) {
  return [message, OFFER_LINES[offer]].filter(Boolean).join(" ");
}
