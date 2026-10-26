// The demo generator's menu: what each one is for, in the words the Cmd+K
// panel shows a user who has never seen it before. Shared by the panel and the
// server, so the two cannot disagree about what exists.
//
// Every one of these is a backend scenario with no screen in the store. The
// generator plays the part of ToggleWear's services and visitors, and the
// story happens in LaunchDarkly: a rollout advancing or rolling back, an
// experiment's results, a trigger firing.

export type GeneratorId =
  | "inventoryService"
  | "orderPipeline"
  | "stylistUpgrade"
  | "stylistRegression"
  | "announcementOffer"
  | "upsellPicks"
  | "expressCheckout"
  | "referralOffer"
  | "cardTesting"
  | "recommendationsOutage";

export type GeneratorGroup = "Guarded releases" | "Experiments" | "Triggers";

export type GeneratorInfo = {
  id: GeneratorId;
  group: GeneratorGroup;
  flag: string;
  flagKey: string;
  name: string;
  kind: string;
  // How a guarded release ends, shown as a tag beside the name so a user
  // picking between the healthy and failing version of a story cannot pick
  // the wrong one.
  outcome?: "succeeds" | "rollsBack";
  does: string;
  purpose: string;
  before: string;
  stops: string;
};

export const GENERATORS: GeneratorInfo[] = [
  {
    id: "inventoryService",
    group: "Guarded releases",
    flag: "06",
    flagKey: "inventoryServiceV2",
    name: "Live Inventory Service",
    kind: "Guarded release",
    outcome: "succeeds",
    does: "Sends stock lookups where the new live service beats the nightly snapshot on success, speed and errors.",
    purpose: "Shows a guarded rollout walking all the way to 100% with nobody touching it.",
    before: "Start a guarded rollout on flag 06. The generator waits for it.",
    stops: "When the rollout reaches 100%.",
  },
  {
    id: "orderPipeline",
    group: "Guarded releases",
    flag: "07",
    flagKey: "orderPipelineV2",
    name: "Order Pipeline v2",
    kind: "Guarded release",
    outcome: "rollsBack",
    does: "Sends orders through both pipelines. v2 is fine for four minutes, then its orders start failing, with real errors, logs and traces.",
    purpose: "Shows LaunchDarkly catching a regression and rolling the flag back on its own.",
    before: "Start a guarded rollout on flag 07 with automatic rollback. The generator waits for it.",
    stops: "When LaunchDarkly rolls the flag back.",
  },
  // The Personal Stylist is an AI Config rather than a numbered flag, so its
  // badge says AI. One story told two ways: the same upgrade from Claude
  // Sonnet 4.6 to Claude Opus 5.5, going right or going wrong, so a user can
  // pick which one the room sees.
  {
    id: "stylistUpgrade",
    group: "Guarded releases",
    flag: "AI",
    flagKey: "personal-stylist",
    name: "Personal Stylist on Opus 5.5",
    kind: "AI Config guarded release",
    outcome: "succeeds",
    does: "Shoppers open product pages and get stylist notes from Sonnet or Opus. Opus's notes score a little higher with both judges, and shoppers add its suggestions a little more often, at the same speed and error rate.",
    purpose: "Shows a model upgrade guarded by judge scores and shoppers' adds walking all the way to 100%.",
    before: "Set the Personal Stylist's default rule back to Claude Sonnet 4.6, then start a guarded rollout to Claude Opus 5.5 on it with Stylist Suggestion Added among its metrics. The generator waits for it.",
    stops: "When the rollout reaches 100%.",
  },
  {
    id: "stylistRegression",
    group: "Guarded releases",
    flag: "AI",
    flagKey: "personal-stylist",
    name: "Personal Stylist on Opus 5.5",
    kind: "AI Config guarded release",
    outcome: "rollsBack",
    does: "The same notes, but after four minutes Opus's judge scores start slipping and shoppers stop adding its suggestions, while its speed and errors stay normal.",
    purpose: "Shows LaunchDarkly rolling back a model whose answers got worse, which errors and latency alone would never catch.",
    before: "Set the Personal Stylist's default rule back to Claude Sonnet 4.6, then start a guarded rollout to Claude Opus 5.5 on it, with Stylist Suggestion Added among its metrics and automatic rollback. The generator waits for it.",
    stops: "When LaunchDarkly rolls the config back.",
  },
  {
    id: "announcementOffer",
    group: "Experiments",
    flag: "08",
    flagKey: "announcementOffer",
    name: "Announcement Banner Offer",
    kind: "Experiment",
    does: "3,000 guests each see one banner offer and some of them go on to order.",
    purpose: "Fills the results so 10% off wins on orders, in a closer race on revenue.",
    before: "The experiment is running. DemoBuilder starts it.",
    stops: "After 3,000 visitors, in about 30 seconds.",
  },
  {
    id: "upsellPicks",
    group: "Experiments",
    flag: "09",
    flagKey: "upsellPicks",
    name: "Complete Your Look Picks",
    kind: "Experiment",
    does: "3,000 shoppers reach the cart, each shown one set of picks.",
    purpose: "Fills the results so premium picks win on revenue, though they are added least.",
    before: "The experiment is running. DemoBuilder starts it.",
    stops: "After 3,000 visitors, in about 30 seconds.",
  },
  {
    id: "expressCheckout",
    group: "Experiments",
    flag: "10",
    flagKey: "expressCheckout",
    name: "Express Checkout",
    kind: "Experiment",
    does: "3,000 shoppers walk the purchase funnel, half of them with express checkout.",
    purpose: "Fills the funnel so express checkout wins at the last step.",
    before: "The experiment is running. DemoBuilder starts it.",
    stops: "After 3,000 visitors, in about 30 seconds.",
  },
  {
    id: "referralOffer",
    group: "Experiments",
    flag: "11",
    flagKey: "referralOffer",
    name: "Referral Offer",
    kind: "Experiment",
    does: "3,000 signed-in shoppers open their account page, each shown one referral offer, and some copy their link.",
    purpose: "Fills the results so the free tee beats $20 credit on links copied.",
    before: "The experiment is running. DemoBuilder starts it.",
    stops: "After 3,000 visitors, in about 30 seconds.",
  },
  {
    id: "cardTesting",
    group: "Triggers",
    flag: "13",
    flagKey: "cardTestingProtection",
    name: "Card Testing Protection",
    kind: "Auto-enable trigger",
    does: "A bot tries stolen cards with $1 charges, two a second, and the payments service declines each one as a CardDeclinedError.",
    purpose: "Your alert on CardDeclinedError calls flag 13's trigger, the flag turns on and the attack is blocked.",
    before: "Flag 13 is off. DemoBuilder already created its alert and trigger.",
    stops: "Shortly after flag 13 turns on, or after 15 minutes.",
  },
  {
    id: "recommendationsOutage",
    group: "Triggers",
    flag: "14",
    flagKey: "recommendationEngine",
    name: "Recommendation Engine",
    kind: "Adaptive trigger",
    does: "Product pages ask the recommendation service for picks and every call times out, sending Recommendations Failed and an error.",
    purpose: "Flag 14's adaptive trigger switches to Best Sellers, and the failures stop.",
    before: "Flag 14 serves Personalized Picks. DemoBuilder already created its adaptive trigger.",
    stops: "Shortly after flag 14 switches to Best Sellers, or after 15 minutes.",
  },
];

export const GENERATOR_GROUPS: GeneratorGroup[] = [
  "Guarded releases",
  "Experiments",
  "Triggers",
];

// idle: never started since the server did. waiting: started, but the thing
// it feeds (a guarded rollout) has not begun yet. running: sending. done: it
// stopped itself because the story is over. stopped: a user stopped it.
export type GeneratorState =
  | "idle"
  | "waiting"
  | "running"
  | "done"
  | "stopped"
  | "error";

export type GeneratorStatus = {
  id: GeneratorId;
  state: GeneratorState;
  // One sentence on where it is up to, in the panel's words.
  detail: string;
  // Lookups, orders, visitors or attempts sent so far, and how many it will
  // send in all when that is known in advance.
  sent: number;
  total?: number;
  startedAt?: number;
  endedAt?: number;
};

export function isActive(state: GeneratorState) {
  return state === "waiting" || state === "running";
}

export function isGeneratorId(value: unknown): value is GeneratorId {
  return GENERATORS.some((g) => g.id === value);
}
