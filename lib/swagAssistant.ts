import {
  BEST_SELLERS,
  WELCOME_CODE,
  WELCOME_DISCOUNT,
  type Product,
} from "@/lib/products";
import { type AnnouncementPersona } from "@/components/layout/AnnouncementBar";

// Which variation of the Swag Assistant AI Config wrote a reply, shown under
// it so a demo can point at the variation without opening LaunchDarkly.
export type ServedBy = { variation: string; model: string };

export type ChatMessage = {
  id: string;
  role: "assistant" | "user";
  text: string;
  products?: Product[];
  // Only on replies the model wrote. The id is what a thumbs up or down is
  // sent with; the server holds the rest (lib/aiServer.ts).
  replyId?: string;
  servedBy?: ServedBy;
  // A reply from the script below rather than the model, because the AI
  // Config is off or LaunchDarkly could not be reached.
  scripted?: boolean;
  // The request failed, so the message is ours rather than the assistant's
  // and is left out of the history sent with the next question.
  failed?: boolean;
  // The shopper's rating, once given. One per reply, as LaunchDarkly records.
  feedback?: FeedbackKind;
};

// What the browser sends to /api/swag-assistant: the conversation so far,
// ending with the shopper's new message.
export type SwagAssistantRequest = {
  messages: { role: ChatMessage["role"]; text: string }[];
};

// Products travel as slugs and are looked up again in the browser, so a
// reply can only ever show cards for products the catalogue really has.
export type SwagAssistantReply = {
  text: string;
  productSlugs: string[];
  replyId?: string;
  servedBy?: ServedBy;
  scripted?: boolean;
};

export type FeedbackKind = "positive" | "negative";

// The greeting and suggested prompts are always written here. The replies
// below are the fallback for when the Swag Assistant AI Config is switched
// off or LaunchDarkly is unreachable; with it on, pages/api/swag-assistant
// answers with a real model instead. Kept so turning the config off in
// LaunchDarkly visibly changes the assistant rather than breaking it.

const GREETINGS: Record<AnnouncementPersona, string> = {
  default:
    "Hey — I'm the ToggleWear swag assistant. Tell me what you're after, or I can show you what's moving right now.",
  cartAbandon:
    "Welcome back. You left a few things in your cart — want me to pick up where you left off, or find you something better?",
  newCustomer:
    `First time here? Good timing. I can help you find your first fit, and your ${Math.round(
      WELCOME_DISCOUNT * 100,
    )}% off code is ${WELCOME_CODE}.`,
  loyaltyGold:
    "Good to see you again. Member pricing is already applied, and I can show you the new drops before they go public.",
};

// One per tool, so a demo that clicks through all three shows each of them
// in the AI Config's tool calls.
export const SUGGESTED_PROMPTS = [
  "Help me pick a hoodie",
  "What's good under $30?",
  "What perks do I get?",
];

export function greetingFor(persona: AnnouncementPersona): ChatMessage {
  return { id: "greeting", role: "assistant", text: GREETINGS[persona] };
}

function bySlug(...slugs: string[]) {
  return slugs
    .map((s) => BEST_SELLERS.find((p) => p.slug === s))
    .filter((p): p is Product => Boolean(p));
}

// Matched in order, so the narrower intents come first. "new" is broad
// enough to swallow a question like "I'm new here, got hoodies?", which is
// why it sits last.
//
// Every pattern is anchored with \b. Without it the short words match inside
// unrelated ones — "hat" inside "what", "cap" inside "capacity", "ship"
// inside "relationship" — which made almost any question starting with
// "what" come back with hats.
const REPLIES: { match: RegExp; text: string; products: Product[] }[] = [
  {
    match: /\b(hoodies?|sweatshirts?|crewnecks?|warm)\b/i,
    text: "The hoodie is heavyweight cotton-blend fleece and runs true to size. If you want something lighter, the crewneck is the same fabric without the hood.",
    products: bySlug("togglewear-hoodie"),
  },
  {
    match: /\b(hats?|caps?|beanie|head)\b/i,
    text: "Two options depending on how much sun you're dealing with.",
    products: bySlug("togglewear-cap", "bucket-hat"),
  },
  {
    // "small" is deliberately absent — it is a sizing word, not a budget one.
    match: /\b(under \$?(30|25|20)|cheap|budget|gift)\b/i,
    text: "Here's what's under $30 — the sticker pack is the usual add-to-cart.",
    products: BEST_SELLERS.filter((p) => p.priceUsd < 30).slice(0, 3),
  },
  {
    match: /\b(ship\w*|deliver\w*|returns?|exchanges?)\b/i,
    // The cart charges nothing for shipping on any order (lib/cart.ts), so
    // the old "free over $75" was a promise the store did not match.
    text: "Shipping is free on every order and arrives in 3 to 5 business days, and anything unworn can go back within 30 days.",
    products: [],
  },
  {
    match: /\b(new|newest|drops?|dropped|latest|just in)\b/i,
    text: "These just landed. The socks and the bucket hat are moving fastest.",
    products: BEST_SELLERS.filter((p) => p.isNew),
  },
];

export function replyTo(input: string): SwagAssistantReply {
  const hit = REPLIES.find((r) => r.match.test(input));
  const products = hit
    ? hit.products
    : bySlug("togglewear-hoodie", "togglewear-cap");

  return {
    text:
      hit?.text ??
      "I can help with sizing, shipping, or finding something specific. In the meantime, these two are our best sellers.",
    productSlugs: products.map((p) => p.slug),
    scripted: true,
  };
}
