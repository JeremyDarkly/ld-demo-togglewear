import type { LDClient, LDContext } from "@launchdarkly/node-server-sdk";
import { LDObserve } from "@launchdarkly/observability-node";
import { LDFeedbackKind } from "@launchdarkly/server-sdk-ai";
import { getAiClient } from "@/lib/aiServer";
import { rolloutRunning } from "@/lib/ldServer";
import { PERSONAL_STYLIST_KEY } from "@/lib/personalStylist";
import { BEST_SELLERS } from "@/lib/products";
import type { GeneratorStatus } from "@/lib/generator/catalog";
import {
  botContext,
  guestContext,
  shopperContext,
} from "@/lib/generator/contexts";

// What each demo generator sends. The guarded releases and experiments are
// results_generator.py's, ported with its numbers intact — its comments
// record why each one is what it is, and most of them were learned by
// watching LaunchDarkly roll something back too early or not at all. The two
// triggers are new: they used to be staged from the storefront, and are
// backend scenarios now.
//
// Each resolves with the sentence the panel shows once it has stopped itself.

export type Run = {
  client: LDClient;
  signal: AbortSignal;
  update: (patch: Partial<GeneratorStatus>) => void;
};

export type Scenario = (run: Run) => Promise<string>;

type Attributes = Record<string, string | number | boolean>;

// How long a guarded release generator waits for its rollout to be started,
// and how long the triggers wait for their flag to react, before giving up
// rather than sending forever in a tab someone forgot about.
const WAIT_LIMIT_MS = 15 * 60_000;
// A guarded rollout's own schedule decides when it ends. The shortest the
// LaunchDarkly UI offers is an hour, and one took 59 minutes end to end, so
// the cap on one running is well past that.
const RUN_LIMIT_MS = 2 * 60 * 60_000;

// ---------------------------------------------------------------- helpers

export function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

const uniform = (low: number, high: number) => low + Math.random() * (high - low);
const randint = (low: number, high: number) => Math.floor(uniform(low, high + 1));
const clamp = (value: number, low: number, high: number) =>
  Math.max(low, Math.min(high, value));

// Box-Muller, for the per-event noise Python's random.gauss gives the
// original.
function gauss(mean: number, sd: number) {
  const u = 1 - Math.random();
  const v = Math.random();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function pick<T>(options: readonly T[]): T {
  return options[Math.floor(Math.random() * options.length)];
}

function flush(client: LDClient) {
  client.flush().catch(() => {
    // The SDK retries on its next interval.
  });
}

// Waits for a guarded rollout to appear on the flag. Events tracked before
// one exists are attributed to no release and quietly do nothing, so the
// generator sends nothing until then.
async function waitForRollout(run: Run, what: string, flagKey: string) {
  const deadline = Date.now() + WAIT_LIMIT_MS;
  while (!rolloutRunning(flagKey)) {
    if (Date.now() > deadline) return false;
    run.update({
      state: "waiting",
      detail: `Waiting for a guarded rollout on ${what}. Start one in LaunchDarkly.`,
    });
    await sleep(2000, run.signal);
  }
  return true;
}

// Once the rollout is over, which way it went: a completed rollout serves the
// new variation to everyone, a rolled back one the old.
async function rolloutOutcome(client: LDClient, flagKey: string) {
  const served = await client.variation(flagKey, shopperContext(), false);
  return served === true ? "reached 100%" : "was rolled back";
}

// ---------------------------------------- 06 Live Inventory Service, healthy

const INVENTORY_FLAG_KEY = "inventoryServiceV2";
const INVENTORY_SUCCESS_KEY = "inventory-lookup-success";
const INVENTORY_LATENCY_KEY = "inventory-lookup-latency";
const INVENTORY_ERRORS_KEY = "inventory-lookup-errors";
const INVENTORY_SERVED_KEY = "inventory-lookups-served";

// The treatment is simply given better numbers than the control, so the
// release guardian finds no regression and the rollout walks its ramp.
const inventoryService: Scenario = async (run) => {
  const { client, signal } = run;
  if (!(await waitForRollout(run, "flag 06", INVENTORY_FLAG_KEY))) {
    return "No guarded rollout was started on flag 06 within 15 minutes.";
  }

  run.update({
    state: "running",
    detail: "Sending stock lookups to both services while the rollout advances.",
  });
  const deadline = Date.now() + RUN_LIMIT_MS;
  let sent = 0;

  while (rolloutRunning(INVENTORY_FLAG_KEY)) {
    if (Date.now() > deadline) return "Stopped after two hours with the rollout still going.";

    const ctx = shopperContext();
    const live = await client.variation(INVENTORY_FLAG_KEY, ctx, false);
    if (live === true) {
      if (Math.random() < 0.04) client.track(INVENTORY_ERRORS_KEY, ctx);
      if (Math.random() < 0.94) client.track(INVENTORY_SUCCESS_KEY, ctx);
      client.track(INVENTORY_LATENCY_KEY, ctx, undefined, randint(40, 130));
    } else {
      if (Math.random() < 0.14) client.track(INVENTORY_ERRORS_KEY, ctx);
      if (Math.random() < 0.83) client.track(INVENTORY_SUCCESS_KEY, ctx);
      client.track(INVENTORY_LATENCY_KEY, ctx, undefined, randint(210, 420));
    }
    client.track(INVENTORY_SERVED_KEY, ctx, undefined, 1);

    sent += 1;
    if (sent % 30 === 0) run.update({ sent });
    await sleep(30, signal);
  }

  run.update({ sent });
  const outcome = await rolloutOutcome(client, INVENTORY_FLAG_KEY);
  return `The rollout ${outcome} after ${sent.toLocaleString()} stock lookups.`;
};

// ------------------------------------------ 07 Order Pipeline v2, failing

const ORDER_FLAG_KEY = "orderPipelineV2";
const ORDER_SUCCESS_KEY = "order-pipeline-success-rate";
const ORDER_LATENCY_KEY = "order-pipeline-latency";
const ORDER_ERROR_KEY = "order-pipeline-error-rate";
const ORDERS_PROCESSED_KEY = "orders-processed";
const ORDER_SERVICE_NAME = "togglewear-order-pipeline";

// Named by hand rather than from the class, because the production build
// minifies class names and the Errors page groups and titles by this.
class OrderPipelineError extends Error {
  name = "OrderPipelineError";
}
class OrderPipelineTimeout extends OrderPipelineError {
  name = "OrderPipelineTimeout";
}
class StockReservationError extends OrderPipelineError {
  name = "StockReservationError";
}
class AddressValidationError extends OrderPipelineError {
  name = "AddressValidationError";
}
class TaxCalculationError extends OrderPipelineError {
  name = "TaxCalculationError";
}
class ShippingRateError extends OrderPipelineError {
  name = "ShippingRateError";
}
class PaymentAuthorisationError extends OrderPipelineError {
  name = "PaymentAuthorisationError";
}
class OrderPersistenceError extends OrderPipelineError {
  name = "OrderPersistenceError";
}
class OrderConfirmationError extends OrderPipelineError {
  name = "OrderConfirmationError";
}

// Raised from a function each, for a real stack trace per failure, and with
// constant messages: an order id in the message would make every instance
// its own group. The per-order detail travels in the attributes instead.
const ORDER_FAILURES: [string, () => never][] = [
  ["order-pipeline.submit", () => {
    throw new OrderPipelineTimeout("Order pipeline timed out after 30s");
  }],
  ["order-pipeline.reserve-stock", () => {
    throw new StockReservationError("Inventory hold refused for one or more SKUs");
  }],
  ["order-pipeline.validate-address", () => {
    throw new AddressValidationError("Shipping address failed validation");
  }],
  ["order-pipeline.calculate-tax", () => {
    throw new TaxCalculationError("Tax jurisdiction lookup came back empty");
  }],
  ["order-pipeline.rate-shipping", () => {
    throw new ShippingRateError("No shipping rates returned for the parcel");
  }],
  ["order-pipeline.authorise-payment", () => {
    throw new PaymentAuthorisationError("Payment authorisation returned 500");
  }],
  ["order-pipeline.persist", () => {
    throw new OrderPersistenceError("Database connection pool exhausted on write");
  }],
  ["order-pipeline.confirm", () => {
    throw new OrderConfirmationError("Confirmation handoff rejected by the notifier");
  }],
];

type ObserveSpan = Parameters<Parameters<typeof LDObserve.runWithHeaders>[2]>[0];

// Recorded against the order's own span, which is the one carrying the flag
// evaluation: errors are filed under a flag per span, so a child span of
// their own left them off flag 07's Monitoring tab.
function reportOrderFailure(span: ObserveSpan, attributes: Attributes) {
  const [step, fail] = pick(ORDER_FAILURES);
  const detail = { ...attributes, "pipeline.step": step };
  try {
    fail();
  } catch (error) {
    const failure = error as Error;
    LDObserve.recordError(failure, undefined, undefined, detail, { span });
    LDObserve.recordLog(
      `${attributes["order.id"]} failed at ${step}: ${failure.message}`,
      "error",
      undefined,
      undefined,
      detail,
    );
  }
}

// Healthy orders are logged sparingly, about twenty a second would bury the
// failures the Logs page is there to show.
function reportOrderSuccess(attributes: Attributes) {
  if (Math.random() >= 0.05) return;
  LDObserve.recordLog(
    `${attributes["order.id"]} completed in ${attributes["order.latency_ms"]}ms`,
    "info",
    undefined,
    undefined,
    attributes,
  );
}

// Four minutes in which v2 draws from exactly the control's numbers, so there
// is genuinely nothing to find, then a near-linear collapse in error and
// success rate over the next four. Latency never differs: the detector rolls
// back on a few milliseconds, and the error rate is the story worth telling.
// The shared random walk and oscillators keep the two arms from drifting
// apart by chance, which the detector would also read as a regression.
const SUSTAIN_END_S = 240;
const CATASTROPHE_END_S = 480;

const orderPipeline: Scenario = async (run) => {
  const { client, signal } = run;
  if (!(await waitForRollout(run, "flag 07", ORDER_FLAG_KEY))) {
    return "No guarded rollout was started on flag 07 within 15 minutes.";
  }

  run.update({
    state: "running",
    detail: "Sending orders. v2 holds up for four minutes, then starts failing.",
  });
  const start = Date.now();
  const deadline = start + RUN_LIMIT_MS;
  let walkLat = 0;
  let walkErr = 0;
  let walkSuc = 0;
  let sent = 0;
  let failingAnnounced = false;

  while (rolloutRunning(ORDER_FLAG_KEY)) {
    if (Date.now() > deadline) return "Stopped after two hours with the rollout still going.";

    const elapsed = (Date.now() - start) / 1000;
    if (elapsed >= SUSTAIN_END_S && !failingAnnounced) {
      failingAnnounced = true;
      run.update({
        detail: "v2 is failing. Waiting for LaunchDarkly to roll it back.",
      });
    }

    walkLat = clamp(walkLat + uniform(-3, 3), -10, 10);
    walkErr = clamp(walkErr + uniform(-0.8, 0.8), -3, 3);
    walkSuc = clamp(walkSuc + uniform(-0.8, 0.8), -3, 3);
    const oscLat =
      10 * Math.sin(elapsed / 45) + 7 * Math.sin(elapsed / 19) + 4 * Math.sin(elapsed / 8);
    const oscErr =
      2 * Math.sin(elapsed / 40) + 1.5 * Math.sin(elapsed / 17) + Math.sin(elapsed / 7);
    const oscSuc =
      2 * Math.sin(elapsed / 36) + 1.5 * Math.sin(elapsed / 15) + Math.sin(elapsed / 6);
    const latMean = 110 + oscLat + walkLat;
    const errMean = 6 + oscErr + walkErr;
    const sucMean = 93 + oscSuc + walkSuc;

    const ctx = shopperContext();
    const orderId = `order-${String(sent).padStart(6, "0")}`;

    // The evaluation happens inside the span, which is what files this
    // order's telemetry under flag 07.
    await LDObserve.runWithHeaders("order-pipeline.submit", {}, async (span) => {
      const onV2 = (await client.variation(ORDER_FLAG_KEY, ctx, false)) === true;
      const latency = clamp(Math.round(gauss(latMean, 25)), 55, 200);

      let errorPct: number;
      let successPct: number;
      if (!onV2 || elapsed < SUSTAIN_END_S) {
        errorPct = clamp(errMean + uniform(-1.5, 1.5), 2, 12);
        successPct = clamp(sucMean + uniform(-1.2, 1.2), 88, 97);
      } else {
        const progress = Math.min(
          (elapsed - SUSTAIN_END_S) / (CATASTROPHE_END_S - SUSTAIN_END_S),
          1,
        );
        const curve = 1 - (1 - progress) ** 1.3;
        errorPct = clamp(errMean + 59 * curve + uniform(-1.5, 1.5), 2, 80);
        successPct = clamp(sucMean - 68 * curve + uniform(-1.5, 1.5), 18, 97);
      }

      const failed = Math.random() * 100 < errorPct;
      client.track(ORDER_ERROR_KEY, ctx, undefined, failed ? 100 : 0);
      client.track(
        ORDER_SUCCESS_KEY,
        ctx,
        undefined,
        Math.random() * 100 < successPct ? 100 : 0,
      );
      client.track(ORDER_LATENCY_KEY, ctx, undefined, latency);
      client.track(ORDERS_PROCESSED_KEY, ctx, undefined, 1);

      const attributes: Attributes = {
        "order.id": orderId,
        "shopper.key": ctx.key as string,
        "service.name": ORDER_SERVICE_NAME,
        "pipeline.version": onV2 ? "v2" : "v1",
        "order.latency_ms": latency,
      };
      span.setAttributes(attributes);
      // The control reports too, so v2's spike has a quiet baseline beside it.
      if (failed) reportOrderFailure(span, attributes);
      else reportOrderSuccess(attributes);
    });

    sent += 1;
    if (sent % 20 === 0) run.update({ sent });
    await sleep(50, signal);
  }

  run.update({ sent });
  const outcome = await rolloutOutcome(client, ORDER_FLAG_KEY);
  return `The rollout ${outcome} after ${sent.toLocaleString()} orders.`;
};

// ------------------------------- Personal Stylist on Opus 5.5, AI Config

const STYLIST_OPUS = "claude-opus-5-5";
const ACCURACY_JUDGE_KEY = "togglewear-accuracy-judge";
const RELEVANCE_JUDGE_KEY = "togglewear-relevance-judge";
const ACCURACY_METRIC_KEY = "$ld:ai:judge:accuracy";
const RELEVANCE_METRIC_KEY = "$ld:ai:judge:relevance";
const STYLIST_SUGGESTION_KEY = "stylist-suggestion-added";
// How often a shopper adds what the stylist suggested, its size or its
// pairing, when the notes are as good as Sonnet's.
const STYLIST_TAKE_RATE = 0.2;

// Each note is a real evaluation of the Personal Stylist for a made-up
// shopper, so the guarded rollout decides which model they get, and then
// everything a real note records goes through the same AI SDK tracker
// pages/api/personal-stylist uses: duration, success or error, tokens, both
// judges' scores and the odd thumb, and then whether the shopper added the
// stylist's suggestion, as the product page sends it. What it does not do is
// call Bedrock. The scores are invented, which keeps a demo free and its
// outcome certain.
//
// Both models get the same duration and error rate. A real Opus is slower,
// and the detector rolls back on a few hundred milliseconds if Completion
// time is one of the metrics, so the only difference either generator
// draws is the one each story is about: the quality of the notes.
//
// Healthy: Opus's notes score a few points higher with both judges from the
// start. Failing: Opus matches Sonnet exactly for four minutes, so there is
// genuinely nothing to find, then its scores slide over the next four, as
// if a prompt change had made its notes ramble and get sizes wrong. Errors
// and duration never move, which is the point: only the judges, and the
// shoppers no longer taking its suggestions, catch it.
const STYLIST_SUSTAIN_END_S = 240;
const STYLIST_SLIDE_END_S = 480;

function stylistUpgrade(failing: boolean): Scenario {
  return async (run) => {
    const { client, signal } = run;
    if (!(await waitForRollout(run, "the Personal Stylist", PERSONAL_STYLIST_KEY))) {
      return "No guarded rollout was started on the Personal Stylist within 15 minutes.";
    }
    const aiClient = await getAiClient();
    if (!aiClient) return "The LaunchDarkly AI client could not start.";

    run.update({
      state: "running",
      detail: failing
        ? "Writing stylist notes. Opus holds up for four minutes, then its scores slip."
        : "Writing stylist notes on both models while the rollout advances.",
    });
    const start = Date.now();
    const deadline = start + RUN_LIMIT_MS;
    let sent = 0;
    let slipAnnounced = false;

    while (rolloutRunning(PERSONAL_STYLIST_KEY)) {
      if (Date.now() > deadline) return "Stopped after two hours with the rollout still going.";

      const elapsed = (Date.now() - start) / 1000;
      if (failing && elapsed >= STYLIST_SUSTAIN_END_S && !slipAnnounced) {
        slipAnnounced = true;
        run.update({
          detail: "Opus's notes are scoring worse. Waiting for LaunchDarkly to roll it back.",
        });
      }

      const ctx = shopperContext();
      const config = await aiClient.completionConfig(PERSONAL_STYLIST_KEY, ctx, {
        enabled: false,
      });
      if (config.enabled) {
        const tracker = config.createTracker();
        const onOpus = tracker.getTrackData().variationKey === STYLIST_OPUS;

        // How far Opus's scores sit from Sonnet's: a little ahead when
        // healthy, level and then falling behind when failing.
        let lift = onOpus ? 0.05 : 0;
        if (failing) {
          const progress = clamp(
            (elapsed - STYLIST_SUSTAIN_END_S) / (STYLIST_SLIDE_END_S - STYLIST_SUSTAIN_END_S),
            0,
            1,
          );
          lift = onOpus ? -0.35 * progress : 0;
        }

        tracker.trackDuration(clamp(Math.round(gauss(2600, 450)), 1200, 4500));
        if (Math.random() < 0.01) {
          tracker.trackError();
        } else {
          tracker.trackSuccess();
          // Real notes' sizes, catalog included: Opus writes no more words
          // but counts the same prompt as more tokens and bills about five
          // times the output tokens for its thinking, which is the cost an
          // SE can point at beside its better scores.
          const input = onOpus ? randint(2050, 2450) : randint(1450, 1750);
          const output = onOpus ? randint(380, 500) : randint(60, 110);
          tracker.trackTokens({ input, output, total: input + output });
          tracker.trackJudgeResult({
            judgeConfigKey: ACCURACY_JUDGE_KEY,
            metricKey: ACCURACY_METRIC_KEY,
            success: true,
            sampled: true,
            score: clamp(gauss(0.88 + lift, 0.06), 0, 1),
          });
          tracker.trackJudgeResult({
            judgeConfigKey: RELEVANCE_JUDGE_KEY,
            metricKey: RELEVANCE_METRIC_KEY,
            success: true,
            sampled: true,
            score: clamp(gauss(0.85 + lift, 0.06), 0, 1),
          });
          // About one note in ten gets a thumb, mostly up, and more often
          // down once a failing Opus's notes have slipped.
          if (Math.random() < 0.1) {
            const down = Math.random() < 0.15 - lift;
            tracker.trackFeedback({
              kind: down ? LDFeedbackKind.Negative : LDFeedbackKind.Positive,
            });
          }
          // A little more often for a healthy Opus, and hardly at all once
          // a failing one's sizes and pairings have gone wrong.
          if (Math.random() < clamp(STYLIST_TAKE_RATE + 0.6 * lift, 0.02, 1)) {
            client.track(STYLIST_SUGGESTION_KEY, ctx, { kind: Math.random() < 0.6 ? "size" : "pairing" });
          }
        }
      }

      sent += 1;
      if (sent % 30 === 0) run.update({ sent });
      await sleep(30, signal);
    }

    run.update({ sent });
    flush(client);
    const settled = await aiClient.completionConfig(PERSONAL_STYLIST_KEY, shopperContext(), {
      enabled: false,
    });
    const outcome =
      settled.enabled && settled.createTracker().getTrackData().variationKey === STYLIST_OPUS
        ? "reached 100%"
        : "was rolled back";
    return `The rollout ${outcome} after ${sent.toLocaleString()} stylist notes.`;
  };
}

const stylistUpgradeHealthy = stylistUpgrade(false);
const stylistUpgradeFailing = stylistUpgrade(true);

// --------------------------------------------------- 08 to 11 experiments
//
// Each visitor is evaluated once and walks the purchase funnel with odds set
// by the variation they got. The event keys are the storefront's
// (lib/events.ts), so generated visits and real clicks land in the same
// metrics.

const PRODUCT_VIEWED_KEY = "product-viewed";
const ADD_TO_CART_KEY = "add-to-cart";
const UPSELL_ADDED_KEY = "upsell-added";
const CHECKOUT_STARTED_KEY = "checkout-started";
const ORDER_PLACED_KEY = "order-placed";
const REFERRAL_LINK_COPIED_KEY = "referral-link-copied";

const EXPERIMENT_VISITORS = 3000;

const orderTotal = (low = 50, high = 110) =>
  Math.round(uniform(low, high) * 100) / 100;

function experiment(visit: (client: LDClient) => Promise<void>): Scenario {
  return async (run) => {
    const { client, signal } = run;
    run.update({
      state: "running",
      total: EXPERIMENT_VISITORS,
      detail: "Sending visitors.",
    });
    for (let i = 1; i <= EXPERIMENT_VISITORS; i++) {
      await visit(client);
      if (i % 100 === 0) {
        flush(client);
        run.update({ sent: i });
      }
      await sleep(5, signal);
    }
    flush(client);
    return `${EXPERIMENT_VISITORS.toLocaleString()} visitors sent. The results page catches up within a few minutes.`;
  };
}

// (viewed, added, started checkout, ordered) odds, each step given the one
// before, and what the arm does to the order total.
const ANNOUNCEMENT_ARMS: Record<string, [[number, number, number, number], number]> = {
  "free-shipping": [[0.7, 0.4, 0.55, 0.6], 1.0],
  "first-order-discount": [[0.72, 0.46, 0.62, 0.7], 0.9],
  // Two items to qualify, so its orders run a little larger.
  "free-sticker-pack": [[0.7, 0.43, 0.56, 0.58], 1.12],
};

const announcementOffer = experiment(async (client) => {
  const ctx = guestContext();
  const offer = await client.variation("announcementOffer", ctx, "free-shipping");
  const [[view, add, checkout, order], factor] =
    ANNOUNCEMENT_ARMS[String(offer)] ?? ANNOUNCEMENT_ARMS["free-shipping"];
  if (Math.random() >= view) return;
  client.track(PRODUCT_VIEWED_KEY, ctx);
  if (Math.random() >= add) return;
  client.track(ADD_TO_CART_KEY, ctx);
  if (Math.random() >= checkout) return;
  client.track(CHECKOUT_STARTED_KEY, ctx);
  if (Math.random() >= order) return;
  client.track(
    ORDER_PLACED_KEY,
    ctx,
    undefined,
    Math.round(orderTotal() * factor * 100) / 100,
  );
});

// Everyone here has reached the cart: (odds of adding a pick, its price
// range). The order odds are the same, so the result is about what the picks
// add to the total.
const UPSELL_ARMS: Record<string, [number, [number, number]]> = {
  "add-ons": [0.34, [12, 24]],
  "premium-picks": [0.18, [34, 68]],
  "best-sellers": [0.24, [28, 34]],
};

const upsellPicks = experiment(async (client) => {
  const ctx = shopperContext();
  const picks = await client.variation("upsellPicks", ctx, "add-ons");
  const [addRate, [low, high]] = UPSELL_ARMS[String(picks)] ?? UPSELL_ARMS["add-ons"];
  let total = orderTotal();
  if (Math.random() < addRate) {
    client.track(ADD_TO_CART_KEY, ctx);
    client.track(UPSELL_ADDED_KEY, ctx);
    total += randint(low, high);
  }
  if (Math.random() < 0.55) {
    client.track(ORDER_PLACED_KEY, ctx, undefined, Math.round(total * 100) / 100);
  }
});

// Only the last step differs: the wallet buttons sit on the checkout page, so
// they cannot change whether someone gets there.
const expressCheckout = experiment(async (client) => {
  const ctx = shopperContext();
  const express = (await client.variation("expressCheckout", ctx, false)) === true;
  client.track(PRODUCT_VIEWED_KEY, ctx);
  if (Math.random() >= 0.45) return;
  client.track(ADD_TO_CART_KEY, ctx);
  if (Math.random() >= 0.7) return;
  client.track(CHECKOUT_STARTED_KEY, ctx);
  if (Math.random() >= (express ? 0.68 : 0.55)) return;
  client.track(ORDER_PLACED_KEY, ctx, undefined, orderTotal());
});

// Signed-in shoppers on the account page, since that is the only place the
// referral card is. Odds of copying the link, per offer.
const REFERRAL_COPY_RATES: Record<string, number> = {
  "store-credit": 0.11,
  "free-tee": 0.16,
};

const referralOffer = experiment(async (client) => {
  const ctx = shopperContext();
  const offer = String(await client.variation("referralOffer", ctx, "store-credit"));
  if (Math.random() < (REFERRAL_COPY_RATES[offer] ?? REFERRAL_COPY_RATES["store-credit"])) {
    client.track(REFERRAL_LINK_COPIED_KEY, ctx, { offer });
  }
});

// ------------------------------------- 13 Card Testing Protection, trigger

const CARD_TESTING_FLAG_KEY = "cardTestingProtection";
const PAYMENTS_SERVICE_NAME = "togglewear-payments";

class CardDeclinedError extends Error {
  name = "CardDeclinedError";
}

// What an issuer says to a stolen card, in the order a run of them cycles
// through. Constant messages, so the Errors page shows one group per reason.
const DECLINES: (() => never)[] = [
  () => {
    throw new CardDeclinedError("Card declined: do not honor");
  },
  () => {
    throw new CardDeclinedError("Card declined: incorrect CVC");
  },
  () => {
    throw new CardDeclinedError("Card declined: expired card");
  },
  () => {
    throw new CardDeclinedError("Card declined: insufficient funds");
  },
];

// Enough blocked attempts after the flag turns on to show the attack hitting
// the wall in the logs, about five seconds' worth.
const BLOCKED_TO_FINISH = 10;

// Two $1 authorizations a second, each from a fresh anonymous bot. An alert
// threshold of ten in a minute is crossed within seconds. Once flag 13 is on,
// the payments service asks for verification before the charge reaches the
// issuer, so the declines stop and blocked attempts take their place.
const cardTesting: Scenario = async (run) => {
  const { client, signal } = run;
  if ((await client.variation(CARD_TESTING_FLAG_KEY, botContext(), false)) === true) {
    return "Flag 13 is already on. Turn it off in LaunchDarkly, then start this again.";
  }

  run.update({
    state: "running",
    detail: "A bot is testing stolen cards. Waiting for flag 13 to turn on.",
  });
  const deadline = Date.now() + WAIT_LIMIT_MS;
  let attempts = 0;
  let declined = 0;
  let blocked = 0;

  while (blocked < BLOCKED_TO_FINISH) {
    if (Date.now() > deadline) {
      return `Flag 13 never turned on after ${declined} declined cards. Check its alert is set up and calls the trigger.`;
    }

    const ctx = botContext();
    attempts += 1;
    await LDObserve.runWithHeaders("payments.authorize", {}, async (span) => {
      const attributes: Attributes = {
        "service.name": PAYMENTS_SERVICE_NAME,
        "payment.amount": "1.00",
        "payment.attempt": attempts,
        "card.last4": String(randint(0, 9999)).padStart(4, "0"),
      };
      span.setAttributes(attributes);

      if ((await client.variation(CARD_TESTING_FLAG_KEY, ctx, false)) === true) {
        blocked += 1;
        LDObserve.recordLog(
          "Card verification required; unverified $1.00 charge refused before reaching the issuer",
          "info",
          undefined,
          undefined,
          attributes,
        );
        return;
      }

      declined += 1;
      try {
        DECLINES[attempts % DECLINES.length]();
      } catch (error) {
        const decline = error as Error;
        LDObserve.recordError(decline, undefined, undefined, attributes, { span });
        LDObserve.recordLog(
          `Issuer declined a $1.00 authorization: ${decline.message}`,
          "warn",
          undefined,
          undefined,
          attributes,
        );
      }
    });

    run.update({
      sent: attempts,
      detail:
        blocked > 0
          ? `Flag 13 is on. ${blocked} attempts blocked so far.`
          : `${declined} cards declined. Waiting for flag 13 to turn on.`,
    });
    await sleep(500, signal);
  }

  return `Flag 13 turned on after ${declined} declined cards, and the attack is blocked.`;
};

// --------------------------------- 14 Recommendation Engine, adaptive trigger

const RECOMMENDATION_FLAG_KEY = "recommendationEngine";
const RECOMMENDATIONS_FAILED_KEY = "recommendations-failed";
const RECOMMENDATIONS_SERVICE_NAME = "togglewear-recommendations";
const SERVICE_TIMEOUT_MS = 1500;

class RecommendationServiceError extends Error {
  name = "RecommendationServiceError";
}

function callPersonalizationService(): never {
  throw new RecommendationServiceError(
    `Personalization service timed out after ${SERVICE_TIMEOUT_MS}ms`,
  );
}

// Best sellers served once the trigger has switched the flag, before this
// calls it done: the logs then show the failures giving way to fallbacks.
const FALLBACKS_TO_FINISH = 10;

// A product page asking for its "Recommended for you" row, one after another.
// Each personalized request waits out the service's timeout, so the trace
// shows the time lost, then fails: an error for the Errors page and a
// Recommendations Failed event, which is what flag 14's adaptive trigger
// counts. Best sellers is a list the store already has, with nothing to fail.
const recommendationsOutage: Scenario = async (run) => {
  const { client, signal } = run;
  const engine = await client.variation(
    RECOMMENDATION_FLAG_KEY,
    shopperContext(),
    "personalized",
  );
  if (engine === "best-sellers") {
    return "Flag 14 is already serving Best Sellers. Switch it back to Personalized Picks, then start this again.";
  }

  run.update({
    state: "running",
    detail: "The recommendation service is down. Waiting for flag 14 to switch to Best Sellers.",
  });
  const deadline = Date.now() + WAIT_LIMIT_MS;
  let requests = 0;
  let failed = 0;
  let fallbacks = 0;

  while (fallbacks < FALLBACKS_TO_FINISH) {
    if (Date.now() > deadline) {
      return `Flag 14 never switched after ${failed} failed requests. Check its adaptive trigger is set up.`;
    }

    const ctx: LDContext = shopperContext();
    const product = pick(BEST_SELLERS);
    requests += 1;
    await LDObserve.runWithHeaders("recommendations.get", {}, async (span) => {
      const attributes: Attributes = {
        "service.name": RECOMMENDATIONS_SERVICE_NAME,
        "product.slug": product.slug,
        "shopper.key": ctx.key as string,
      };
      span.setAttributes(attributes);

      const served = await client.variation(RECOMMENDATION_FLAG_KEY, ctx, "personalized");
      if (served === "best-sellers") {
        fallbacks += 1;
        LDObserve.recordLog(
          `Served best sellers for ${product.slug}`,
          "info",
          undefined,
          undefined,
          { ...attributes, "recommendations.engine": "best-sellers" },
        );
        return;
      }

      await sleep(SERVICE_TIMEOUT_MS, signal);
      failed += 1;
      client.track(RECOMMENDATIONS_FAILED_KEY, ctx, { slug: product.slug }, 1);
      try {
        callPersonalizationService();
      } catch (error) {
        const failure = error as Error;
        const detail = { ...attributes, "recommendations.engine": "personalized" };
        LDObserve.recordError(failure, undefined, undefined, detail, { span });
        LDObserve.recordLog(
          `Recommended for you failed for ${product.slug}: ${failure.message}`,
          "error",
          undefined,
          undefined,
          detail,
        );
      }
    });

    run.update({
      sent: requests,
      detail:
        fallbacks > 0
          ? `Flag 14 switched to Best Sellers. ${fallbacks} pages served.`
          : `${failed} requests failed. Waiting for flag 14 to switch to Best Sellers.`,
    });
    await sleep(500, signal);
  }

  return `Flag 14 switched to Best Sellers after ${failed} failed requests, and the failures stopped.`;
};

export const SCENARIOS = {
  inventoryService,
  orderPipeline,
  stylistUpgrade: stylistUpgradeHealthy,
  stylistRegression: stylistUpgradeFailing,
  announcementOffer,
  upsellPicks,
  expressCheckout,
  referralOffer,
  cardTesting,
  recommendationsOutage,
} satisfies Record<string, Scenario>;
