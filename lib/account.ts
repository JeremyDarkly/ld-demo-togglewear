import type { LoyaltyTier, Person } from "./shopper";
import type { CartLine } from "./cart";
import type { ShipTo } from "./order";
import type { Stop, TrackingRoute } from "./tracking";

// The account page's data. Jen drew it for one person, Alex Rivera, a gold
// member, so these are her values with the products swapped for ones that
// actually exist in our catalogue — her order history lists a Two-tone
// Trucker Hat and prices the crewneck at $68 and the mug set at $32, none of
// which match what we sell.
//
// A shopper's name, email, join date and region are not here at all: those are
// on the Person in lib/shopper.ts, and the cards read them from whoever is
// signed in. There used to be a PROFILE constant holding Alex's, which is why
// every shopper's account page greeted them as Alex.

// What each shopper has earned, keyed by the person they belong to. Points are
// account detail rather than identity, which is why they live here and not on
// the Person — LaunchDarkly has no use for them until something targets on
// "close to the next tier".
const ACCOUNTS: Record<string, { points: number; referralCode: string }> = {
  "alex-rivera": { points: 750, referralCode: "alex-rivera-ld-92" },
  "diane-whitaker": { points: 2840, referralCode: "diane-whitaker-ld-07" },
  "megan-caldwell": { points: 320, referralCode: "megan-caldwell-ld-44" },
  "chris-donovan": { points: 240, referralCode: "chris-donovan-ld-18" },
};

// The rung a tier sits on, and the one above it. Jen's card shows the reward
// at the current rung on the left and the one being earned toward on the
// right, so each tier needs both names.
//
// FLAG: the target is the obvious knob — dropping gold's to 800 puts a member
// within reach of the next tier and changes the nudge copy underneath, without
// touching the points they have actually earned.
const LADDER: Record<
  LoyaltyTier,
  { current: string; next: string; target: number }
> = {
  none: { current: "Shopper", next: "Gold Member Drop", target: 500 },
  gold: {
    current: "Gold Member Drop",
    next: "Platinum Early Access",
    target: 1000,
  },
  // Platinum has nothing above it, so there is no target to earn toward. The
  // card reads atTop and shows a full bar rather than inventing a fourth rung
  // nobody has designed a reward for.
  platinum: {
    current: "Platinum Early Access",
    next: "Top tier reached",
    target: 0,
  },
};

export type TierStatus = {
  points: number;
  target: number;
  current: string;
  next: string;
  atTop: boolean;
};

export function tierStatusFor(person: Person): TierStatus {
  const points = ACCOUNTS[person.id]?.points ?? 0;
  const rung = LADDER[person.tier];
  const atTop = person.tier === "platinum";

  return {
    points,
    // A full bar at the top of the ladder, which needs target to equal points
    // rather than zero — dividing by zero would render a bar of NaN%.
    target: atTop ? points : rung.target,
    current: rung.current,
    next: rung.next,
    atTop,
  };
}

export function referralLinkFor(person: Person): string {
  const code = ACCOUNTS[person.id]?.referralCode ?? person.id;
  return `https://togglewear.com/refer/${code}`;
}

// Every stage a parcel moves through, in order. Named once here rather than
// per order, so two orders cannot disagree about what the journey is and so
// the panel can show the stages an order has not reached yet without each
// order having to list the ones it is still waiting on.
export const SHIPMENT_STAGES = [
  "Order placed",
  "Packed at the warehouse",
  "In transit",
  "Delivered",
];

// One stage a parcel has already cleared, in stage order and starting from
// the first. A cleared stage knows its date and place; the stages still to
// come are filled in from SHIPMENT_STAGES and carry neither, which is how
// the panel shows the distance left without inventing a date for it.
export type ShipmentEvent = {
  label: string;
  on: string;
  where: string;
};

export type PastOrder = {
  ref: string;
  placedOn: string;
  status: string;
  lines: CartLine[];
  // Jen writes a different action per order: a live shipment gets tracking,
  // a delivered one gets a summary. Both open the same panel — the content
  // differs because the shipment does, not because the label does.
  action: string;
  carrier: string;
  tracking: string;
  // Where it is going. The waypoints in between only mean something once you
  // know the destination — Reno is either most of the way there or nowhere
  // near it, depending on where the parcel is headed.
  destination: string;
  // The estimate while a parcel is moving, the date it landed once it has
  // arrived. Carries a midday time rather than a bare date: a bare "2026-01-22"
  // parses as UTC midnight and then renders as the 21st anywhere west of
  // Greenwich, which is every machine this demo runs on.
  arrivesOn: string;
  events: ShipmentEvent[];
  // Every stop on the way, for live tracking (flag 04). Only on a parcel that
  // is still moving; the last event's "where" is one of these stops, and is
  // where the live position starts from.
  route?: TrackingRoute;
};

const OAKLAND: Stop = { city: "Oakland, CA", lat: 37.8, lon: -122.27 };
const RENO: Stop = { city: "Reno, NV", lat: 39.53, lon: -119.81 };
const SALT_LAKE_CITY: Stop = { city: "Salt Lake City, UT", lat: 40.76, lon: -111.89 };
const DENVER: Stop = { city: "Denver, CO", lat: 39.74, lon: -104.99 };

// A parcel on its way, for the live tracking panel: the newest order that
// still has a route to travel.
export function activeShipmentFor(person: Person): PastOrder | undefined {
  return ordersFor(person).find(
    (order) => order.route && order.events.length < SHIPMENT_STAGES.length,
  );
}

// Each shopper's most recent orders, keyed by the person they belong to. Not
// the whole history: Diane has eleven lifetime orders and the card is headed
// Recent Orders so that showing two of them is not a lie.
//
// Members-only products (the crewneck) only appear in members' orders.
const ORDERS: Record<string, PastOrder[]> = {
  "alex-rivera": [
    {
      ref: "LD-928104",
      placedOn: "Placed on Mar 12, 2026",
      status: "In transit",
      lines: [{ slug: "togglewear-crewneck", size: "M", quantity: 1 }],
      action: "Track package delivery",
      carrier: "ToggleShip Standard",
      tracking: "TS4820193847US",
      destination: "Austin, TX",
      arrivesOn: "2026-03-17T12:00:00",
      events: [
        { label: "Order placed", on: "Mar 12", where: "Oakland, CA" },
        { label: "Packed at the warehouse", on: "Mar 13", where: "Oakland, CA" },
        { label: "In transit", on: "Mar 14", where: "Reno, NV" },
      ],
      route: {
        unit: "mi",
        stops: [
          OAKLAND,
          RENO,
          SALT_LAKE_CITY,
          DENVER,
          { city: "Amarillo, TX", lat: 35.22, lon: -101.83 },
          { city: "Austin, TX", lat: 30.27, lon: -97.74 },
        ],
      },
    },
    {
      ref: "LD-890312",
      placedOn: "Placed on Jan 18, 2026",
      status: "Delivered",
      lines: [
        { slug: "bucket-hat", size: "One size", quantity: 1 },
        { slug: "enamel-mug-set", size: "One size", quantity: 1 },
      ],
      action: "View delivery summary",
      carrier: "ToggleShip Standard",
      tracking: "TS4820188211US",
      destination: "Austin, TX",
      arrivesOn: "2026-01-22T12:00:00",
      events: [
        { label: "Order placed", on: "Jan 18", where: "Oakland, CA" },
        { label: "Packed at the warehouse", on: "Jan 19", where: "Oakland, CA" },
        { label: "In transit", on: "Jan 20", where: "Denver, CO" },
        { label: "Delivered, left at front door", on: "Jan 22", where: "Austin, TX" },
      ],
    },
  ],
  "diane-whitaker": [
    {
      ref: "LD-931577",
      placedOn: "Placed on Mar 15, 2026",
      status: "In transit",
      lines: [
        { slug: "togglewear-hoodie", size: "L", quantity: 1 },
        { slug: "togglewear-crewneck", size: "S", quantity: 1 },
      ],
      action: "Track package delivery",
      carrier: "ToggleShip Express",
      tracking: "TS4820195562US",
      destination: "Seattle, WA",
      arrivesOn: "2026-03-18T12:00:00",
      events: [
        { label: "Order placed", on: "Mar 15", where: "Oakland, CA" },
        { label: "Packed at the warehouse", on: "Mar 15", where: "Oakland, CA" },
        { label: "In transit", on: "Mar 16", where: "Portland, OR" },
      ],
      route: {
        unit: "mi",
        stops: [
          OAKLAND,
          { city: "Redding, CA", lat: 40.59, lon: -122.39 },
          { city: "Medford, OR", lat: 42.33, lon: -122.87 },
          { city: "Portland, OR", lat: 45.52, lon: -122.68 },
          { city: "Seattle, WA", lat: 47.61, lon: -122.33 },
        ],
      },
    },
    {
      ref: "LD-902246",
      placedOn: "Placed on Feb 2, 2026",
      status: "Delivered",
      lines: [
        { slug: "water-bottle", size: "One size", quantity: 1 },
        { slug: "canvas-tote", size: "One size", quantity: 1 },
      ],
      action: "View delivery summary",
      carrier: "ToggleShip Express",
      tracking: "TS4820189034US",
      destination: "Seattle, WA",
      arrivesOn: "2026-02-05T12:00:00",
      events: [
        { label: "Order placed", on: "Feb 2", where: "Oakland, CA" },
        { label: "Packed at the warehouse", on: "Feb 2", where: "Oakland, CA" },
        { label: "In transit", on: "Feb 3", where: "Medford, OR" },
        { label: "Delivered, handed to resident", on: "Feb 5", where: "Seattle, WA" },
      ],
    },
  ],
  "megan-caldwell": [
    {
      ref: "LD-930268",
      placedOn: "Placed on Mar 13, 2026",
      status: "In transit",
      lines: [
        { slug: "togglewear-hoodie", size: "M", quantity: 1 },
        { slug: "water-bottle", size: "One size", quantity: 1 },
      ],
      action: "Track package delivery",
      carrier: "ToggleShip International",
      tracking: "TS4820194120NL",
      destination: "Amsterdam, NL",
      arrivesOn: "2026-03-20T12:00:00",
      events: [
        { label: "Order placed", on: "Mar 13", where: "Oakland, CA" },
        { label: "Packed at the warehouse", on: "Mar 14", where: "Oakland, CA" },
        { label: "In transit", on: "Mar 15", where: "Louisville, KY" },
      ],
      route: {
        unit: "km",
        stops: [
          OAKLAND,
          { city: "Louisville, KY", lat: 38.25, lon: -85.76 },
          { city: "Cologne, DE", lat: 50.94, lon: 6.96 },
          { city: "Amsterdam, NL", lat: 52.37, lon: 4.9 },
        ],
      },
    },
    {
      ref: "LD-915830",
      placedOn: "Placed on Feb 20, 2026",
      status: "Delivered",
      lines: [
        { slug: "togglewear-tee", size: "S", quantity: 1 },
        { slug: "sticker-pack", size: "One size", quantity: 2 },
      ],
      action: "View delivery summary",
      carrier: "ToggleShip International",
      tracking: "TS4820190457NL",
      destination: "Amsterdam, NL",
      arrivesOn: "2026-02-27T12:00:00",
      events: [
        { label: "Order placed", on: "Feb 20", where: "Oakland, CA" },
        { label: "Packed at the warehouse", on: "Feb 21", where: "Oakland, CA" },
        { label: "In transit", on: "Feb 24", where: "Leipzig, DE" },
        { label: "Delivered, left with a neighbour", on: "Feb 27", where: "Amsterdam, NL" },
      ],
    },
  ],
  "chris-donovan": [
    {
      ref: "LD-931904",
      placedOn: "Placed on Mar 15, 2026",
      status: "In transit",
      lines: [
        { slug: "togglewear-tee", size: "L", quantity: 1 },
        { slug: "sticker-pack", size: "One size", quantity: 1 },
      ],
      action: "Track package delivery",
      carrier: "ToggleShip Standard",
      tracking: "TS4820195978US",
      destination: "Denver, CO",
      arrivesOn: "2026-03-18T12:00:00",
      events: [
        { label: "Order placed", on: "Mar 15", where: "Oakland, CA" },
        { label: "Packed at the warehouse", on: "Mar 15", where: "Oakland, CA" },
        { label: "In transit", on: "Mar 16", where: "Reno, NV" },
      ],
      route: { unit: "mi", stops: [OAKLAND, RENO, SALT_LAKE_CITY, DENVER] },
    },
    {
      ref: "LD-921409",
      placedOn: "Placed on Mar 4, 2026",
      status: "Delivered",
      lines: [
        { slug: "togglewear-cap", size: "One size", quantity: 1 },
        { slug: "checkerboard-socks", size: "L/XL", quantity: 1 },
      ],
      action: "View delivery summary",
      carrier: "ToggleShip Standard",
      tracking: "TS4820192716US",
      destination: "Denver, CO",
      arrivesOn: "2026-03-08T12:00:00",
      events: [
        { label: "Order placed", on: "Mar 4", where: "Oakland, CA" },
        { label: "Packed at the warehouse", on: "Mar 5", where: "Oakland, CA" },
        { label: "In transit", on: "Mar 6", where: "Salt Lake City, UT" },
        { label: "Delivered to the mailroom", on: "Mar 8", where: "Denver, CO" },
      ],
    },
  ],
};

export function ordersFor(person: Person): PastOrder[] {
  return ORDERS[person.id] ?? [];
}

// Where each shopper's orders go, prefilled at checkout. In the same city
// as their past orders above, so the Account History agent reads an order
// placed as them as going where their orders always go, and changing the
// address on stage is something it notices.
export type HomeAddress = ShipTo & { country: "US" | "NL" };

const ADDRESSES: Record<string, HomeAddress> = {
  "alex-rivera": {
    name: "Alex Rivera",
    street: "2210 South Lamar Blvd",
    apartment: "Apt 312",
    city: "Austin",
    state: "TX",
    zip: "78704",
    country: "US",
  },
  "diane-whitaker": {
    name: "Diane Whitaker",
    street: "1418 Queen Anne Ave N",
    apartment: "",
    city: "Seattle",
    state: "WA",
    zip: "98109",
    country: "US",
  },
  // A Dutch postcode, four digits and two letters, and the country where a
  // US address has its state.
  "megan-caldwell": {
    name: "Megan Caldwell",
    street: "Keizersgracht 214",
    apartment: "3rd floor",
    city: "Amsterdam",
    state: "NL",
    zip: "1016 DZ",
    country: "NL",
  },
  "chris-donovan": {
    name: "Chris Donovan",
    street: "1600 Wynkoop St",
    apartment: "Unit 4C",
    city: "Denver",
    state: "CO",
    zip: "80202",
    country: "US",
  },
};

// Jen's Alex Morgan, for a guest, who has no address on file.
const GUEST_ADDRESS: HomeAddress = {
  name: "Alex Morgan",
  street: "91 Orchard Street",
  apartment: "Apt 4B",
  city: "New York",
  state: "NY",
  zip: "10001",
  country: "US",
};

export function addressFor(person: Person): HomeAddress {
  return ADDRESSES[person.id] ?? GUEST_ADDRESS;
}

// Where each shopper's wishlist starts. Alex's are Jen's two: a trucker hat
// we do not sell, which the bucket hat stands in for, and the sticker pack.
// Nobody but a member has the members-only crewneck saved.
const SAVED: Record<string, string[]> = {
  "alex-rivera": ["bucket-hat", "sticker-pack"],
  "diane-whitaker": ["pool-float", "togglewear-tee"],
  "megan-caldwell": ["canvas-tote"],
  "chris-donovan": ["water-bottle", "sticker-pack"],
};

export function savedSlugsFor(personId: string): string[] {
  return SAVED[personId] ?? [];
}

// The link is per shopper and comes from referralLinkFor; what is left here is
// the offer itself, which is the store's. Flag 11 decides which one a shopper
// sees, so the keys are its variation values.
export type ReferralOffer = "store-credit" | "free-tee";

export const REFERRAL: Record<ReferralOffer, { headline: string; description: string }> = {
  "store-credit": {
    headline: "Give $20, Get $20",
    description:
      "Invite your team members to join ToggleWear. They'll get $20 USD off their first order, and you'll earn 150 loyalty points plus $20 USD credit once they checkout.",
  },
  "free-tee": {
    headline: "Give a Tee, Get a Tee",
    description:
      "Invite your team members to join ToggleWear. They'll get a free ToggleWear Tee with their first order, and you'll earn 150 loyalty points plus a free tee of your own once they check out.",
  },
};

export type Preference = {
  id: string;
  title: string;
  description: string;
  defaultOn: boolean;
  // The middle preference is the beta role under another name, so it drives
  // the shopper rather than a checkbox of its own. Flagged here so the
  // component does not have to special-case it by title.
  drivesBetaRole?: boolean;
};

export const PREFERENCES: Preference[] = [
  {
    id: "tier-notifications",
    title: "Loyalty Tier Notifications",
    description:
      "Get notified when you are close to earning a free seasonal merch drop.",
    defaultOn: true,
  },
  {
    id: "beta-access",
    title: "Feature Flag Beta Access",
    description:
      "Opt-in to test experimental co-branded swags before general rollout.",
    defaultOn: true,
    drivesBetaRole: true,
  },
  {
    id: "newsletter",
    title: "Monthly Swag Newsletter",
    description:
      "Receive drop alerts, custom community design updates, and behind-the-scenes engineering logs.",
    defaultOn: false,
  },
];
