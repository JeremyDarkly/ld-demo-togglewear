import type { AnnouncementPersona } from "@/components/layout/AnnouncementBar";
import type { PricingVariant } from "./products";

// The labels a ToggleWear shopper carries, modelled on core-demo's user
// context (utils/contexts/StarterUserPersonas.ts over in ld-core-demo).
//
// Components ask about these rather than about persona names, because this is
// the shape LaunchDarkly supplies: client.identify() can tell us a shopper's
// tier, but it can never tell us which demo button is pressed. Writing the
// conditions against the labels now means they survive the switch.
//
// core-demo carries a third label, launchclub, which is a ToggleBank concept.
// loyaltyTier does that job here.

// Who sees things early — the "staff first, then testers, then everyone" axis.
// Deliberately independent of what a shopper has spent, which is the whole
// reason it is a separate label: a gold member is not necessarily a tester,
// and a tester is not necessarily a paying customer.
export type ShopperRole = "shopper" | "beta" | "developer";

// What a shopper has earned. Drives pricing and the members-only products.
//
// Platinum is the top of the swag tier ladder in lib/account.ts, which the
// gold rung already promises. It is a third rung rather than a rename of gold,
// because the demo needs two member tiers on screen to show that a targeting
// rule is reading an attribute rather than just answering "member, yes or no".
export type LoyaltyTier = "none" | "gold" | "platinum";

export type Shopper = {
  role: ShopperRole;
  loyaltyTier: LoyaltyTier;
};

export const ROLES: { id: ShopperRole; label: string }[] = [
  { id: "shopper", label: "Shopper" },
  { id: "beta", label: "Beta" },
  { id: "developer", label: "Developer" },
];

export const TIER_LABELS: Record<LoyaltyTier, string> = {
  none: "No tier",
  gold: "Gold",
  platinum: "Platinum",
};

// Someone you can shop as.
//
// Only the durable facts live here — the things that are true about a person
// before they touch the site. What is in their cart is deliberately absent:
// that is a state, it belongs to CartProvider, and it can be true of any of
// these four. Keeping it out is what stops the Cart Abandoner mistake from
// being made again, where a thing that happens to people was modelled as a
// kind of person.
//
// orderCount is the one borderline field. It changes, so it is a state in the
// strict sense, but it only changes by checking out, so it is stable enough to
// seed per person and it is what "new customer" is read from.
export type Person = {
  // Ours, for React keys and session storage. Whether this also becomes the
  // LaunchDarkly context key is a separate decision: a fixed key per person
  // makes percentage rollouts land the same way every time, which is good for
  // a scripted demo and bad for showing a 50/50 split re-bucket.
  id: string;
  name: string;
  email: string;
  tier: LoyaltyTier;
  role: ShopperRole;
  orderCount: number;
  joined: string;
  region: string;
  // Why this person is in the roster at all. Surfaced in the switcher so the
  // demo explains itself instead of relying on whoever is driving to remember.
  demonstrates: string;
  // A pose of the mascot, Albert, cropped to head and shoulders, picked to fit
  // what the person demonstrates. Not sent to LaunchDarkly: contextFor lists
  // the attributes it sends by name.
  portrait: string;
};

// Four people, each there for one thing a flag targets: Gold, Platinum, beta
// and developer. There is no "shopper with an abandoned cart" here on
// purpose — an abandoned cart is something that happens to any of them, so
// it is reached by coming back to items left in the cart (Refill in the
// account menu stands in for that) rather than by picking a
// different name. There is no new customer either: first-order offers are
// one of the banner experiment's arms, which only guests are entered into,
// and the guest already covers the plain visitor with no perks.
//
// Addresses are on an invented consumer mail domain because these are the
// store's customers. Chris is the exception: he works on ToggleWear rather
// than buying from it, and the address says so.
export const SHOPPERS: Person[] = [
  {
    id: "alex-rivera",
    name: "Alex Rivera",
    email: "alex.rivera@launchmail.io",
    tier: "gold",
    role: "shopper",
    orderCount: 2,
    joined: "October 2024",
    region: "North America",
    demonstrates:
      "Member pricing, members-only products and tier progress. The only one Jen designed for.",
    portrait: "/images/illustrations/albert-hi.png",
  },
  {
    id: "diane-whitaker",
    name: "Diane Whitaker",
    email: "diane.whitaker@launchmail.io",
    tier: "platinum",
    role: "shopper",
    orderCount: 11,
    joined: "March 2023",
    region: "North America",
    demonstrates:
      "The top of the ladder: her own hero, the deepest discount and free shipping.",
    portrait: "/images/illustrations/albert-proud.png",
  },
  {
    id: "megan-caldwell",
    name: "Megan Caldwell",
    email: "megan.caldwell@launchmail.io",
    tier: "none",
    role: "beta",
    orderCount: 4,
    joined: "July 2025",
    region: "Europe",
    demonstrates:
      "Opted into early access, so she sees drops before they are generally available.",
    portrait: "/images/illustrations/albert-juggling.png",
  },
  {
    id: "chris-donovan",
    name: "Chris Donovan",
    email: "chris.donovan@togglewear.com",
    tier: "none",
    role: "developer",
    orderCount: 3,
    joined: "January 2024",
    region: "North America",
    demonstrates:
      "Staff, so he is the first ring of a progressive rollout and sees internal flags.",
    portrait: "/images/illustrations/albert-glitch.png",
  },
];

// Who you are before signing in, and where every visit starts. Kept out of
// SHOPPERS so the account menu never offers it as someone to become: it is
// the absence of a choice rather than a sixth person.
//
// It still fills in every field a person has, so the twenty-odd places that
// read the current shopper keep working and simply see someone with no tier,
// no history and the default role. The few places that should look different
// for a guest ask isGuest.
export const GUEST: Person = {
  id: "guest",
  name: "Guest",
  email: "",
  tier: "none",
  role: "shopper",
  orderCount: 0,
  joined: "",
  region: "",
  demonstrates: "Not signed in, so LaunchDarkly sees an anonymous visitor.",
  portrait: "/images/illustrations/user.png",
};

export const DEFAULT_SHOPPER_ID = GUEST.id;

export function isGuest(person: Person): boolean {
  return person.id === GUEST.id;
}

// An id that matches nobody, such as one saved before a shopper was renamed,
// signs you out rather than signing you in as someone you did not pick.
export function shopperById(id: string): Person {
  return SHOPPERS.find((p) => p.id === id) ?? GUEST;
}

// Read off a person rather than stored on one. "New customer" is not a kind of
// shopper you can be assigned, it is a fact about an order history that stops
// being true the moment someone checks out — which is exactly why it belongs in
// a function and not in the table above.
//
// A guest's orderCount of 0 is a placeholder, not a history: nobody knows who
// they are, so they are not treated as new. Otherwise every anonymous visitor
// would be shown the first-order offer meant for a new account.
export function isNewCustomer(person: Person): boolean {
  return !isGuest(person) && person.orderCount === 0;
}

export function isMember(person: Person): boolean {
  return person.tier !== "none";
}

// One copy of what used to be an identical VARIANT_BY_PERSONA table in four
// separate pages.
//
// Platinum maps onto the gold variant for now. The deeper platinum rate has to
// land in lib/products.ts first, and the pricing there is a chain of
// `variant === "loyaltyGold"` comparisons rather than an exhaustive map, so a
// third variant would type-check and then quietly sell to platinum members at
// list price. Charging them the gold rate is wrong by fifteen points; charging
// them full price would be wrong by thirty and look like a bug on screen.
export function variantFor(tier: LoyaltyTier): PricingVariant {
  return tier === "none" ? "default" : "loyaltyGold";
}

// The throwaway piece. Jen designed two variants of the hero and the item
// block, default and Loyalty Gold, so the persona buttons stand in for the
// tier LaunchDarkly will eventually hand us. Cart Abandoner and New Customer
// are behaviours rather than entitlements, so neither earns a tier — they
// keep their own announcement bar and shop at list price.
export function tierForPersona(persona: AnnouncementPersona): LoyaltyTier {
  return persona === "loyaltyGold" ? "gold" : "none";
}
