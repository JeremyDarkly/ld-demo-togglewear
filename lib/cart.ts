import {
  BEST_SELLERS,
  LOYALTY_DISCOUNT,
  productBySlug,
  WELCOME_CODE,
  WELCOME_DISCOUNT,
  type PricingVariant,
  type Product,
} from "./products";

// A line is stored by slug rather than by product object so the cart survives
// a catalogue edit, and keyed by slug plus size because the same product in
// two sizes is two lines.
export type CartLine = {
  slug: string;
  size: string;
  quantity: number;
};

export type ResolvedLine = CartLine & { product: Product };

export function lineId(slug: string, size: string) {
  return `${slug}__${size}`;
}

export function resolveLines(lines: CartLine[]): ResolvedLine[] {
  return lines.flatMap((line) => {
    const product = productBySlug(line.slug);
    return product ? [{ ...line, product }] : [];
  });
}

// Jen's summary applies tax to the discounted subtotal rather than the gross:
// her $6.62 is 8% of $82.80, not of $92.00.
const TAX_RATE = 0.08;

export type CartTotals = {
  subtotal: number;
  discount: number;
  // Which rule produced the discount, so the summary rows can label it
  // without working the rule out a second time and risking a different
  // answer. It is part of the totals rather than derived at render because a
  // placed order snapshots these, and a receipt has to keep saying what it
  // said at checkout.
  discountKind: "none" | "loyalty" | "welcome";
  // The sticker pack flag 07's third offer promises. Part of the totals for
  // the same reason as discountKind: the receipt has to keep showing a gift
  // the checkout showed. Optional because orders placed before it existed
  // are snapshotted without it.
  freeGift?: boolean;
  shipping: number;
  tax: number;
  total: number;
};

// Why a code is refused, or null when it is good. A Gold member is turned
// away rather than stacked: WELCOME is a first-order code and a member is not
// a first-time buyer, and refusing it is the better demo beat anyway — it
// shows the store knows who it is talking to.
export type PromoRejection = "unknown" | "alreadyMember";

export function validatePromo(
  code: string,
  variant: PricingVariant
): PromoRejection | null {
  if (code.trim().toUpperCase() !== WELCOME_CODE) return "unknown";
  if (variant === "loyaltyGold") return "alreadyMember";
  return null;
}

// Flag 07's free gift offer: the banner variation that makes it, and how
// many items earn it. Kept beside the totals so the banner's promise and
// the cart's delivery on it cannot drift apart.
export const GIFT_OFFER = "free-sticker-pack";
export const GIFT_MIN_ITEMS = 2;

export function cartTotals(
  lines: ResolvedLine[],
  variant: PricingVariant,
  promo?: string | null,
  // Flag 07's value, so the cart knows which offer this shopper was shown.
  offer?: unknown
): CartTotals {
  const subtotal = lines.reduce(
    (sum, line) => sum + line.product.priceUsd * line.quantity,
    0
  );
  const itemCount = lines.reduce((sum, line) => sum + line.quantity, 0);

  // Free, so it adds a line and no money. "Any 2 items" counts quantity,
  // so two of the same tee qualifies.
  const freeGift = offer === GIFT_OFFER && itemCount >= GIFT_MIN_ITEMS;

  // Member pricing wins outright and the code is ignored, which is the same
  // rule validatePromo enforces at the field — it is repeated here so a
  // stored promo from before a persona switch cannot quietly stack.
  const discountKind: CartTotals["discountKind"] =
    variant === "loyaltyGold"
      ? "loyalty"
      : promo && !validatePromo(promo, variant)
        ? "welcome"
        : "none";

  // The loyalty rate is the same 15% the product pages apply, so a member
  // sees one rate across the whole site rather than a per-item saving that
  // stops adding up here.
  const discount =
    discountKind === "loyalty"
      ? subtotal * LOYALTY_DISCOUNT
      : discountKind === "welcome"
        ? subtotal * WELCOME_DISCOUNT
        : 0;

  // Jen shows FREE for both personas and leaves the "for Gold Members" caveat
  // to the estimator copy. Kept as a value rather than a literal zero because
  // it is a flag surface — the free-shipping threshold is the same kind of
  // knob as the free-gift threshold.
  const shipping = 0;

  const tax = (subtotal - discount) * TAX_RATE;

  return {
    subtotal,
    discount,
    discountKind,
    freeGift,
    shipping,
    tax,
    total: subtotal - discount + shipping + tax,
  };
}

// formatPrice in products.ts omits cents because the catalogue is whole
// dollars. Cart arithmetic is not, so totals need their own formatter.
export function formatMoney(usd: number) {
  return `$${usd.toFixed(2)} USD`;
}

// The three slots in Jen's "Complete your look". Holding each set as one
// ordered list rather than three separate values means the slots cannot
// collide with each other or come back empty.
export const UPSELL_SLUGS = [
  "sticker-pack",
  "checkerboard-socks",
  "canvas-tote",
];

// Flag 08's three arms, keyed by its variation values. The question each one
// answers is the one store teams actually argue about: suggest the cheap
// thing, the expensive thing, or the popular thing?
//
//   add-ons        Jen's three, $12 to $24: easy yeses that barely move the
//                  order total. The control.
//   premium-picks  $34 to $68: fewer adds, but each one is worth more.
//   best-sellers   the catalogue's top three, $28 to $34, as social proof.
//
// The sets do not overlap, so whichever arm wins, the result is about the
// strategy rather than about one product that happened to be in two arms.
export const UPSELL_SETS: Record<string, string[]> = {
  "add-ons": UPSELL_SLUGS,
  "premium-picks": ["togglewear-hoodie", "pool-float", "bucket-hat"],
  "best-sellers": ["togglewear-cap", "enamel-mug-set", "togglewear-tee"],
};

export function upsellsFor(
  inCart: string[],
  slugs: string[] = UPSELL_SLUGS
): Product[] {
  const held = new Set(inCart);
  const picked: Product[] = [];

  const consider = (product?: Product) => {
    if (!product) return;
    if (held.has(product.slug)) return;
    if (picked.some((p) => p.slug === product.slug)) return;
    picked.push(product);
  };

  slugs.forEach((slug) => consider(productBySlug(slug)));

  // Backfill cheapest-first so the row is always full. It will not be as soon
  // as a customer adds one of the named upsells, and a two-card row in a
  // three-column grid reads as a bug rather than a choice.
  [...BEST_SELLERS]
    .sort((a, b) => a.priceUsd - b.priceUsd)
    .forEach((product) => {
      if (picked.length < 3) consider(product);
    });

  return picked.slice(0, 3);
}
