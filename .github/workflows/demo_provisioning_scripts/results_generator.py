"""Synthetic demo traffic for ToggleWear's guarded releases and experiments.

ToggleWear has no backend, and a guarded release is a story about a service
degrading, so the metric data is generated here rather than produced by the
storefront.  This is how core-demo does it too: a server-side SDK client
invents shopper contexts, evaluates the flag for each one, and tracks the
metric events the release guardian watches.

Two guarded release scenarios, one per flag:

    06 Live Inventory Service  -> the new service is simply better, so the
                                  rollout advances to 100% untouched.
    07 Order Pipeline v2       -> the new pipeline degrades, slowly at first
                                  and then sharply, until LaunchDarkly detects
                                  the regression and rolls the flag back.

And one on an AI Config:

    Personal Stylist           -> Claude Opus 5.5's notes score better with
                                  the judges than Sonnet 4.6's, so the rollout
                                  advances to 100% untouched.

Each loop polls its flag and exits once its measured rollout is over, whether
that happened by completing or by being rolled back.

And the four experiments, 08 to 11, which need visitors rather than a
service: a fixed number each, walked through the purchase funnel with odds
set by the variation they were given.  Their events are the storefront's own,
so the results pages fill in before anyone has clicked through the store.

Flag 07 additionally reports real telemetry through the observability plugin,
so its Monitoring tab fills with the errors, logs and traces underneath the
regression instead of only the metric charts.  That plugin needs Python 3.10
or newer; on anything older the metrics and the rollback still happen, just
without the telemetry beside them.

The ToggleBank, Investment, Galaxy Marketplace and public-sector generators
that used to live here were removed with the rest of those resources; they
are in git history and in ld-core-demo.
"""

import contextlib
import logging
import math
import os
import random
import threading
import time
import uuid

import ldclient
import requests
from dotenv import load_dotenv
from ldclient.config import Config
from ldclient.context import Context

# The observability plugin is what fills in the Errors, Logs and Traces panels
# on flag 07's Monitoring tab.  It needs Python 3.10 or newer, so an older
# interpreter still produces every metric and both rollouts — it just does so
# without the telemetry that sits alongside them.
try:
    from ldobserve import ObservabilityConfig, ObservabilityPlugin, observe

    OBSERVABILITY_AVAILABLE = True
except ImportError:
    OBSERVABILITY_AVAILABLE = False

load_dotenv()

LD_API_KEY = os.getenv("LD_API_KEY")
PROJECT_KEY = os.getenv("LD_PROJECT_KEY")
LD_API_URL = os.getenv("LD_API_URL", "https://app.launchdarkly.com/api/v2")
DEMO_NAMESPACE = os.getenv("DEMO_NAMESPACE")
ENVIRONMENT_KEY = "production"

HEADERS = {
    "Authorization": LD_API_KEY,
    "Content-Type": "application/json",
}

# 06 — Live Inventory Service, the healthy scenario
INVENTORY_FLAG_KEY = "inventoryServiceV2"
INVENTORY_SUCCESS_KEY = "inventory-lookup-success"
INVENTORY_LATENCY_KEY = "inventory-lookup-latency"
INVENTORY_ERRORS_KEY = "inventory-lookup-errors"
INVENTORY_SERVED_KEY = "inventory-lookups-served"

# 07 — Order Pipeline v2, the failing scenario
ORDER_FLAG_KEY = "orderPipelineV2"
ORDER_SUCCESS_KEY = "order-pipeline-success-rate"
ORDER_LATENCY_KEY = "order-pipeline-latency"
ORDER_ERROR_KEY = "order-pipeline-error-rate"
ORDERS_PROCESSED_KEY = "orders-processed"
ORDER_SERVICE_NAME = "togglewear-order-pipeline"

# The Personal Stylist, the healthy AI Config scenario
STYLIST_CONFIG_KEY = "personal-stylist"
STYLIST_OPUS = "claude-opus-5-5"
STYLIST_JUDGES = (
    ("togglewear-accuracy-judge", "$ld:ai:judge:accuracy", 0.88),
    ("togglewear-relevance-judge", "$ld:ai:judge:relevance", 0.85),
)
# How often a shopper adds the stylist's suggestion, its size or its pairing,
# on Sonnet's notes: the same rate as the Cmd+K generator's
STYLIST_SUGGESTION_KEY = "stylist-suggestion-added"
STYLIST_TAKE_RATE = 0.2

# Cart Recovery, the AI Config experiment
CART_RECOVERY_CONFIG_KEY = "cart-recovery-agent"

# Every failure is reported.  An earlier version sampled 30% of them, on the
# assumption that the run would be long enough for that to still be hundreds
# of records; in practice the rollout is rolled back within minutes of the
# collapse starting, so sampling left the Errors panel with single digits and
# only half the failure modes represented at all.

# Healthy orders are logged sparingly, though.  The generator places roughly
# eight orders a second, and logging all of them would bury the failures that
# the Logs panel is there to show.
SUCCESS_LOG_SAMPLE_RATE = 0.05

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
# The SDK's event sender keeps a small connection pool to
# events.launchdarkly.com; concurrent flushes from the generator threads
# make urllib3 discard and reopen connections, which is harmless churn but
# floods the log with "Connection pool is full" warnings.
logging.getLogger("urllib3.connectionpool").setLevel(logging.ERROR)
# The SDK's startup chatter and a line for every observability upload, every
# few seconds for the whole run; warnings and errors from either still show.
logging.getLogger("ldclient").setLevel(logging.WARNING)
logging.getLogger("httpx").setLevel(logging.WARNING)


# -------------------------------------------------------- observability

class OrderPipelineError(Exception):
    """Base class for the synthetic Order Pipeline v2 failures.

    Each subclass is raised for real rather than merely described, so that the
    Errors panel gets a genuine stack trace and groups failures by type the
    way it would for a service that was actually breaking.
    """


class OrderPipelineTimeout(OrderPipelineError):
    """The pipeline did not return within its deadline."""


class StockReservationError(OrderPipelineError):
    """Stock could not be held for one or more line items."""


class AddressValidationError(OrderPipelineError):
    """The shipping address was rejected downstream."""


class TaxCalculationError(OrderPipelineError):
    """No tax rate came back for the destination."""


class ShippingRateError(OrderPipelineError):
    """No carrier returned a rate for the parcel."""


class PaymentAuthorisationError(OrderPipelineError):
    """The payment processor refused the authorisation."""


class OrderPersistenceError(OrderPipelineError):
    """The order could not be written to its store."""


class OrderConfirmationError(OrderPipelineError):
    """The order was taken but the confirmation could not be handed off."""


# Each failure is raised from its own function, so the Errors panel has a
# real stack trace and a distinct exception type for each one.
#
# Eight modes do not produce eight groups, and it is worth recording what was
# tried, because the obvious fixes all make it worse or do nothing.  Eight
# functions called straight from report_order_failure give five groups: the
# stock, tax and persistence failures get absorbed, and the group keeps the
# title of whichever instance landed first, so a group labelled for one
# failure shows instances of another.
#
# Rewording the absorbed messages so they share no vocabulary changed nothing,
# so the message is not part of the grouping.  Dispatching through a
# _raise_failure helper, to give each failure its own call site and make the
# traces differ in two frames instead of one, took it from five groups to two
# — the extra shared frame made the traces *more* alike by the measure that
# actually counts.  So grouping keys on the outer, shared frames and ignores
# both the message and the innermost frame, which leaves nothing the generator
# can reasonably do about it.  Calling straight through, as below, is the
# arrangement that produces the most groups.
#
# The messages are deliberately constant.  Interpolating an order id or a SKU
# would make every instance its own group and the list unreadable, so the
# per-order detail travels in the span attributes instead.

def _fail_submit():
    raise OrderPipelineTimeout("Order pipeline timed out after 30s")


def _fail_reserve_stock():
    raise StockReservationError("Inventory hold refused for one or more SKUs")


def _fail_validate_address():
    raise AddressValidationError("Shipping address failed validation")


def _fail_calculate_tax():
    raise TaxCalculationError("Tax jurisdiction lookup came back empty")


def _fail_rate_shipping():
    raise ShippingRateError("No shipping rates returned for the parcel")


def _fail_authorise_payment():
    raise PaymentAuthorisationError("Payment authorisation returned 500")


def _fail_persist():
    raise OrderPersistenceError("Database connection pool exhausted on write")


def _fail_confirm():
    raise OrderConfirmationError("Confirmation handoff rejected by the notifier")


# Pairing each failure with its step means the trace shows where an order died
# rather than only that it did.
ORDER_FAILURES = [
    ("order-pipeline.submit", _fail_submit),
    ("order-pipeline.reserve-stock", _fail_reserve_stock),
    ("order-pipeline.validate-address", _fail_validate_address),
    ("order-pipeline.calculate-tax", _fail_calculate_tax),
    ("order-pipeline.rate-shipping", _fail_rate_shipping),
    ("order-pipeline.authorise-payment", _fail_authorise_payment),
    ("order-pipeline.persist", _fail_persist),
    ("order-pipeline.confirm", _fail_confirm),
]


def observe_span(name, attributes=None):
    """A span when the plugin loaded, otherwise something that does nothing.

    Flag evaluations have to happen inside one of these.  The plugin records
    each evaluation onto whichever span is current, and that is the link that
    files the resulting telemetry under the flag in LaunchDarkly.

    The span deliberately does not record exceptions itself; observe_error
    does that, because it is the documented route to the Errors panel and
    doing both would report every failure twice.
    """
    if OBSERVABILITY_AVAILABLE:
        return observe.start_span(name, attributes or {}, record_exception=False)
    return contextlib.nullcontext()


def observe_error(error, attributes=None):
    if OBSERVABILITY_AVAILABLE:
        observe.record_exception(error, attributes or {})


def observe_log(message, level, attributes=None):
    if OBSERVABILITY_AVAILABLE:
        observe.record_log(message, level, attributes or {})


def report_order_failure(order_id, ctx, latency, version):
    """Raise, catch and report one order failure.

    The exception is raised rather than constructed so that the Errors panel
    gets a real stack trace.

    It is recorded against the caller's span rather than a child span of its
    own.  A child named for the failing step read better in the trace, but the
    flag evaluation lives on the parent span, and errors appear to be
    attributed to a flag per span rather than per trace — which left these
    showing under Observability while flag 07's own Errors tab stayed empty.
    The step still travels as an attribute.
    """
    step, raise_failure = random.choice(ORDER_FAILURES)
    attributes = {
        "order.id": order_id,
        "shopper.key": ctx.key,
        "service.name": ORDER_SERVICE_NAME,
        "pipeline.step": step,
        "pipeline.version": version,
        "order.latency_ms": latency,
    }

    try:
        raise_failure()
    except OrderPipelineError as error:
        observe_error(error, attributes)
        observe_log(f"{order_id} failed at {step}: {error}",
                    logging.ERROR, attributes)


def report_order_success(order_id, ctx, latency, version):
    """Log a completed order, sparsely.

    Slow orders are always logged, because rising latency is part of what the
    rollout is supposed to reveal; ordinary ones are sampled.
    """
    if latency > 300:
        level, message = logging.WARNING, f"{order_id} completed slowly in {latency}ms"
    elif random.random() < SUCCESS_LOG_SAMPLE_RATE:
        level, message = logging.INFO, f"{order_id} completed in {latency}ms"
    else:
        return

    observe_log(message, level, {
        "order.id": order_id,
        "shopper.key": ctx.key,
        "service.name": ORDER_SERVICE_NAME,
        "pipeline.version": version,
        "order.latency_ms": latency,
    })


# ---------------------------------------------------------------- helpers

def _get_json(url, retries=3):
    for attempt in range(retries):
        try:
            res = requests.get(url, headers=HEADERS, timeout=10)
            if res.status_code == 200:
                return res.json()
            logging.warning(f"GET {url} returned {res.status_code}")
        except requests.RequestException as e:
            logging.warning(f"GET {url} failed ({attempt + 1}/{retries}): {e}")
        time.sleep(1)
    return None


def get_all_flags_by_tag(tag):
    data = _get_json(f"{LD_API_URL}/flags/{PROJECT_KEY}?tag={tag}")
    if not data:
        return []
    return [item["key"] for item in data.get("items", [])]


def get_flag_details(flag_key):
    return _get_json(f"{LD_API_URL}/flags/{PROJECT_KEY}/{flag_key}")


def is_measured_rollout(flag_details):
    """True while the flag still has a rollout on its default rule.

    This is how both generators know when to stop. A guarded release that
    completes, and one that gets rolled back, both end up without a
    fallthrough rollout — so either way the loop exits.
    """
    try:
        env = flag_details["environments"][ENVIRONMENT_KEY]
        return env.get("fallthrough", {}).get("rollout") is not None
    except Exception as e:
        logging.error(f"Error checking measured rollout: {e}")
        return False


def generate_shopper_context():
    """A plausible ToggleWear shopper.

    role and tier carry the same lowercase values, under the same names, as
    contextFor in lib/ldContext.ts sends, so these contexts match the
    Developers, Beta Testers, Gold Members and Platinum Members segments.
    Weighted so the overwhelming majority are ordinary shoppers.
    """
    key = f"shopper-{uuid.uuid4()}"
    builder = Context.builder(key)
    builder.set("role", random.choices(
        ["shopper", "beta", "developer"], weights=[94, 5, 1])[0])
    builder.set("tier", random.choices(
        ["none", "gold", "platinum"], weights=[80, 15, 5])[0])
    builder.set("device", random.choices(
        ["Mobile", "Desktop", "Tablet"], weights=[58, 36, 6])[0])
    builder.set("location", random.choice([
        "America/New_York", "America/Chicago", "America/Los_Angeles",
        "Europe/London", "Europe/Berlin",
    ]))
    builder.set("referrer", random.choice(
        ["google", "direct", "social", "email", "partner"]))
    return builder.build()


def generate_guest_context():
    """An anonymous visitor, the way the storefront sends one.

    Flag 08's experiment only runs on guests, so its traffic has to look like
    a guest: anonymous, and without cartItemCount, which is what keeps a
    context clear of the cart reminder and free shipping rules above the
    experiment. device and location are kept because the experiment slices
    results by them.
    """
    builder = Context.builder(f"guest-{uuid.uuid4()}")
    builder.anonymous(True)
    builder.set("device", random.choices(
        ["Mobile", "Desktop", "Tablet"], weights=[58, 36, 6])[0])
    builder.set("location", random.choice([
        "America/New_York", "America/Chicago", "America/Los_Angeles",
        "Europe/London", "Europe/Berlin",
    ]))
    return builder.build()


def evaluate_flags_by_tag(client, tag, evaluations=200):
    """Put evaluation traffic through every flag carrying a tag.

    Without this the flag list shows zero evaluations and looks untouched,
    which undersells a demo project more than it sounds like it would.

    200 each rather than 500: five flags at 500 produced events faster than
    the SDK could ship them even with a flush per flag, and the dropped ones
    came straight out of the warm-up this exists to provide.
    """
    flag_keys = get_all_flags_by_tag(tag)
    if not flag_keys:
        logging.warning(f"No flags found with tag '{tag}' to evaluate.")
        return

    logging.info(f"Evaluating {len(flag_keys)} '{tag}' flag(s)...")
    for flag_key in flag_keys:
        for _ in range(evaluations):
            try:
                client.variation(flag_key, generate_shopper_context(), False)
            except Exception as e:
                logging.error(f"Error evaluating {flag_key}: {e}")
                break
        # Flush per flag, not once at the end. Five flags at 500 evaluations
        # overflows the 2000-event queue before anything is sent, and the
        # dropped events come out of the warm-up the flag list depends on.
        client.flush()
    logging.info("Flag evaluation complete.")


def _wait_for_rollout(flag_key, label, max_retries=6):
    """Block until the flag's rollout is live.

    create_flag and the rollout patch land moments before this runs, and the
    rollout takes a beat to become visible on the API. Tracking events before
    then are attributed to no release at all and quietly do nothing.
    """
    logging.info(f"Waiting for the {label} rollout to be ready...")
    for attempt in range(1, max_retries + 1):
        time.sleep(5)
        details = get_flag_details(flag_key)
        if details and is_measured_rollout(details):
            logging.info(f"{label} rollout is ready.")
            return True
        logging.info(f"  not ready yet ({attempt}/{max_retries})")
    logging.error(f"{label} rollout never became ready. Giving up.")
    return False


# ------------------------------------------------- 05 healthy scenario

def inventory_service_healthy_generator(client, stop_event):
    """Live inventory beats nightly snapshots on every monitored metric.

    Nothing clever here on purpose — the treatment is given better numbers
    than the control and the release guardian finds no regression, so the
    rollout walks its full ramp and reaches 100% in about ten minutes.
    """
    if not client.is_initialized():
        logging.error("LaunchDarkly client is not initialized.")
        return

    if not _wait_for_rollout(INVENTORY_FLAG_KEY, "Live Inventory Service"):
        return

    logging.info("Live Inventory Service generator running.")
    status_check_counter = 0

    while True:
        # Polling every iteration would mean an API call per event, so the
        # check is amortised over a few hundred of them.
        if status_check_counter >= 100:
            details = get_flag_details(INVENTORY_FLAG_KEY)
            if not details or not is_measured_rollout(details):
                logging.info("Live Inventory Service rollout finished.")
                stop_event.set()
                break
            status_check_counter = 0

        try:
            ctx = generate_shopper_context()
            on_new_service = client.variation(INVENTORY_FLAG_KEY, ctx, False)

            if on_new_service:
                if random.random() < 0.04:
                    client.track(INVENTORY_ERRORS_KEY, ctx)
                if random.random() < 0.94:
                    client.track(INVENTORY_SUCCESS_KEY, ctx)
                client.track(INVENTORY_LATENCY_KEY, ctx, None, random.randint(40, 130))
            else:
                if random.random() < 0.14:
                    client.track(INVENTORY_ERRORS_KEY, ctx)
                if random.random() < 0.83:
                    client.track(INVENTORY_SUCCESS_KEY, ctx)
                client.track(INVENTORY_LATENCY_KEY, ctx, None, random.randint(210, 420))

            client.track(INVENTORY_SERVED_KEY, ctx, None, 1)

            status_check_counter += 1
            time.sleep(0.03)
        except Exception as e:
            logging.error(f"Error generating inventory metrics: {e}")
            continue

    logging.info("Live Inventory Service generator finished.")


# -------------------------------------------------- 06 failed scenario

def order_pipeline_failed_generator(client, stop_event):
    """Order Pipeline v2 degrades until LaunchDarkly rolls it back.

    The shape of the data matters as much as the direction of it. Three things
    are layered on top of each other so the chart reads as a real service
    rather than a step function:

      * a drifting random walk, so consecutive buckets are related
      * three sine waves at different periods, which gives organic wobble
        without any single visible rhythm
      * per-event gaussian noise

    Two phases. For the first four minutes v2 draws from the same distributions
    as the control, so there is genuinely nothing to find. Then orders start
    failing — without slowing down, so that the error rate is what ends the
    rollout rather than latency.

    That first phase used to be a mild regression instead — 11% errors against
    the control's 4%, latency 148ms against 110ms — on the theory that it was
    too small to be conclusive. It was not. LaunchDarkly rolled the flag back
    61 seconds in, on a sample of 36 users, because a 35% latency increase is
    so far outside the noise that sequential testing needs almost no data to
    be certain of it. Nothing about the story got a chance to happen.
    Sustained differences cannot merely be small, either: a small true gap
    still reaches significance once enough events pile up, and four minutes is
    plenty. So the phase has to be noise, and all the divergence has to live
    in the collapse.

    Success and error rates are tracked as 100 or 0 against numeric metrics
    rather than as conversions, so each chart bucket averages to a smooth mean.
    core-demo found that as conversion metrics the same data drew a flat
    stepped chart and the rollback never looked convincing.
    """
    if not client.is_initialized():
        logging.error("LaunchDarkly client is not initialized.")
        return

    if not _wait_for_rollout(ORDER_FLAG_KEY, "Order Pipeline v2"):
        return

    logging.info("Order Pipeline v2 generator running.")

    # Four minutes of healthy rather than six. The detector judges the
    # cumulative average over the whole rollout, so every extra healthy minute
    # dilutes the collapse and pushes the rollback further out. Four is still
    # plainly a flat, uneventful stretch on the chart.
    SUSTAIN_END = 240.0
    CATASTROPHE_END = 480.0

    status_check_counter = 0
    iteration = 0
    start_time = time.time()

    walk_lat = 0.0
    walk_err = 0.0
    walk_suc = 0.0

    while True:
        # Every 200 iterations is roughly every ten seconds at the loop's pace,
        # which keeps the polling on the flag to a sane rate.
        if status_check_counter >= 200:
            details = get_flag_details(ORDER_FLAG_KEY)
            if not details or not is_measured_rollout(details):
                logging.info("Order Pipeline v2 rollout is over — rolled back or completed.")
                stop_event.set()
                break
            status_check_counter = 0

        try:
            ctx = generate_shopper_context()
            elapsed = time.time() - start_time
            order_id = f"order-{iteration:06d}"

            # One walk and one set of oscillators, shared by both arms, so the
            # healthy phase has them drawing from the same distribution rather
            # than from two distributions that happen to be centred alike.
            #
            # They used to have one each, carefully matched in spread. That is
            # not good enough. Two independent walks drift apart and stay apart
            # for minutes at a time, and the detector judges the running
            # average, so the drift alone reads as a regression — it rolled the
            # flag back 33 seconds in once, while the sample was still small
            # enough for a couple of milliseconds of wander to look decisive.
            # Sharing them leaves per-event noise as the only difference
            # between the arms, and that cancels out instead of accumulating.
            walk_lat = max(-10, min(10, walk_lat + random.uniform(-3, 3)))
            walk_err = max(-3, min(3, walk_err + random.uniform(-0.8, 0.8)))
            walk_suc = max(-3, min(3, walk_suc + random.uniform(-0.8, 0.8)))

            osc_lat = (10 * math.sin(elapsed / 45)
                       + 7 * math.sin(elapsed / 19)
                       + 4 * math.sin(elapsed / 8))
            osc_err = (2.0 * math.sin(elapsed / 40)
                       + 1.5 * math.sin(elapsed / 17)
                       + 1.0 * math.sin(elapsed / 7))
            osc_suc = (2.0 * math.sin(elapsed / 36)
                       + 1.5 * math.sin(elapsed / 15)
                       + 1.0 * math.sin(elapsed / 6))

            # The healthy numbers. v2 adds its collapse on top of these once
            # the sustain window is over; until then both arms use them as they
            # are, clamps included, so neither can be biased relative to the
            # other by where the clamps fall.
            lat_mean = 110 + osc_lat + walk_lat
            err_mean = 6 + osc_err + walk_err
            suc_mean = 93 + osc_suc + walk_suc

            # The evaluation happens inside the span deliberately.  The plugin
            # attaches it to whichever span is current, and that is the link
            # that files this order's telemetry under flag 07.
            with observe_span("order-pipeline.submit", {
                "order.id": order_id,
                "shopper.key": ctx.key,
                "service.name": ORDER_SERVICE_NAME,
            }):
                on_v2 = client.variation(ORDER_FLAG_KEY, ctx, False)

                if on_v2:
                    # Latency sits outside the phase split on purpose: v2 is
                    # exactly as fast as the control for the entire rollout,
                    # collapse included, drawn from the same lat_mean. Orders
                    # fail, they do not slow down, which is what a pipeline
                    # rejecting work actually looks like — declined
                    # authorisations and validation failures come back as
                    # quickly as a success would.
                    #
                    # It has to be *no* gap rather than a small one. A version
                    # of this gave the collapse a 12ms bump, which averaged out
                    # to a cumulative 5.2ms, and LaunchDarkly rolled the flag
                    # back on latency a minute into the collapse — before the
                    # error rate had anything to say. The detector is far more
                    # sensitive than it looks; 5ms on a 110ms baseline is
                    # enough. Anything added here competes with the error rate
                    # to trigger the rollback, and the error rate is the one
                    # worth telling the story about.
                    latency = int(random.gauss(lat_mean, 25))
                    latency = max(55, min(200, latency))

                    if elapsed < SUSTAIN_END:
                        # The same two lines as the control arm below, drawn
                        # from the same means with the same clamps. Only the
                        # per-event noise differs.
                        error_pct = max(2, min(12, err_mean + random.uniform(-1.5, 1.5)))
                        success_pct = max(88, min(97, suc_mean + random.uniform(-1.2, 1.2)))
                    else:
                        # A near-linear ramp rather than the steep-then-flat
                        # one this started as. Counter-intuitively the gentler
                        # ramp puts *more* in the Errors panel: the rollback
                        # fires when the cumulative gap clears the detector's
                        # bar, and reaching that bar slowly means more orders
                        # have gone through the pipeline by the time it does.
                        #
                        # curve is 0 at the handover, so the numbers continue
                        # from the healthy phase with no step, and cat_progress
                        # clamps at 1 so the worst case is sustained rather
                        # than falling off a cliff if the rollback takes longer
                        # than the window.
                        cat_progress = min((elapsed - SUSTAIN_END) / (CATASTROPHE_END - SUSTAIN_END), 1.0)
                        curve = 1.0 - ((1.0 - cat_progress) ** 1.3)

                        error_pct = err_mean + (59 * curve) + random.uniform(-1.5, 1.5)
                        error_pct = max(2, min(80, error_pct))

                        success_pct = suc_mean - (68 * curve) + random.uniform(-1.5, 1.5)
                        success_pct = max(18, min(97, success_pct))

                    error_val = 100 if random.random() * 100 < error_pct else 0
                    success_val = 100 if random.random() * 100 < success_pct else 0

                    client.track(ORDER_ERROR_KEY, ctx, None, error_val)
                    client.track(ORDER_SUCCESS_KEY, ctx, None, success_val)
                    client.track(ORDER_LATENCY_KEY, ctx, None, latency)
                    client.track(ORDERS_PROCESSED_KEY, ctx, None, 1)

                    if error_val == 100:
                        report_order_failure(order_id, ctx, latency, "v2")
                    else:
                        report_order_success(order_id, ctx, latency, "v2")
                else:
                    # Identical to v2's healthy phase, down to the clamps,
                    # because it is drawn from the same three means. The
                    # control arm is the thing v2 is measured against, so any
                    # expression that is not literally shared between them is
                    # somewhere a difference can creep in.
                    #
                    # The 6% baseline is also the cheapest way to put more in
                    # the Errors panel: the healthy phase is most of the
                    # rollout, and moving both arms together changes the volume
                    # without touching the gap between them, so it cannot
                    # affect what triggers the rollback or when.
                    ctrl_latency = int(random.gauss(lat_mean, 25))
                    ctrl_latency = max(55, min(200, ctrl_latency))

                    ctrl_error_pct = max(2, min(12, err_mean + random.uniform(-1.5, 1.5)))
                    ctrl_success_pct = max(88, min(97, suc_mean + random.uniform(-1.2, 1.2)))

                    ctrl_error_val = 100 if random.random() * 100 < ctrl_error_pct else 0

                    client.track(ORDER_ERROR_KEY, ctx, None, ctrl_error_val)
                    client.track(ORDER_SUCCESS_KEY, ctx, None,
                                 100 if random.random() * 100 < ctrl_success_pct else 0)
                    client.track(ORDER_LATENCY_KEY, ctx, None, ctrl_latency)
                    client.track(ORDERS_PROCESSED_KEY, ctx, None, 1)

                    # The control arm reports too, so the panels have a quiet
                    # baseline to contrast v2's spike against rather than
                    # making it look as though only one pipeline is monitored.
                    if ctrl_error_val == 100:
                        report_order_failure(order_id, ctx, ctrl_latency, "v1")
                    else:
                        report_order_success(order_id, ctx, ctrl_latency, "v1")

            iteration += 1
            status_check_counter += 1
            # Twenty orders a second. The Errors panel is populated as a
            # by-product of this loop, so throughput is what decides how much
            # is in it; at the previous 0.12s the whole run produced 157
            # errors, which left some of the eight failure modes in single
            # figures. This is still only ~80 metric events a second against a
            # queue of 2000 flushed every second, so nothing is dropped.
            time.sleep(0.05)
        except Exception as e:
            logging.error(f"Error generating order pipeline metrics: {e}")
            continue

    logging.info("Order Pipeline v2 generator finished.")


# ------------------------------------------------------- 08 to 11 experiments
#
# Each visitor is evaluated once and then walks the purchase funnel, with the
# odds at each step set by the variation they got. The numbers are invented
# but chosen to tell a believable story, which is what a results page in a
# demo is for:
#
#   08  10% off wins on orders, but each order is smaller, so it is a closer
#       call on revenue. Free shipping and the sticker pack trail.
#   09  Premium picks are added least often and still raise revenue most.
#   10  Express checkout leaves the top of the funnel alone and wins at the
#       last step, which is where a wallet button can make a difference.
#   11  A free tee gets more shoppers copying their referral link than $20
#       credit does.
#
# The event keys are the storefront's (lib/events.ts), so generated visits
# and real clicks land in the same metrics.

PRODUCT_VIEWED_KEY = "product-viewed"
ADD_TO_CART_KEY = "add-to-cart"
UPSELL_ADDED_KEY = "upsell-added"
CHECKOUT_STARTED_KEY = "checkout-started"
ORDER_PLACED_KEY = "order-placed"
REFERRAL_LINK_COPIED_KEY = "referral-link-copied"

EXPERIMENT_VISITORS = 3000


def _order_total(low=50, high=110):
    """A plausible order total in dollars, before anything the arm changes."""
    return round(random.uniform(low, high), 2)


def _run_visitors(client, label, visit, visitors=EXPERIMENT_VISITORS):
    for i in range(visitors):
        try:
            visit()
        except Exception as e:
            logging.error(f"Error generating {label} traffic: {e}")
            continue
        if (i + 1) % 100 == 0:
            client.flush()
        # Spread over about fifteen seconds rather than one burst, so the
        # event queue stays well inside its capacity alongside the guarded
        # release threads sharing the client.
        time.sleep(0.005)
    logging.info(f"{label}: {visitors} visitors generated.")


def announcement_offer_experiment_generator(client):
    # (product viewed, added to cart, started checkout, placed order) odds,
    # each step given the one before, and what happens to the order total.
    arms = {
        "free-shipping":        ((0.70, 0.40, 0.55, 0.60), 1.00),
        "first-order-discount": ((0.72, 0.46, 0.62, 0.70), 0.90),
        # Two items to qualify, so its orders run a little larger.
        "free-sticker-pack":    ((0.70, 0.43, 0.56, 0.58), 1.12),
    }

    def visit():
        ctx = generate_guest_context()
        offer = client.variation("announcementOffer", ctx, "free-shipping")
        steps, total_factor = arms.get(offer, arms["free-shipping"])
        view, add, checkout, order = steps
        if random.random() >= view:
            return
        client.track(PRODUCT_VIEWED_KEY, ctx)
        if random.random() >= add:
            return
        client.track(ADD_TO_CART_KEY, ctx)
        if random.random() >= checkout:
            return
        client.track(CHECKOUT_STARTED_KEY, ctx)
        if random.random() >= order:
            return
        client.track(ORDER_PLACED_KEY, ctx, None,
                     round(_order_total() * total_factor, 2))

    _run_visitors(client, "08 Announcement Banner Offer", visit)


def upsell_picks_experiment_generator(client):
    # Everyone here has reached the cart. (odds of adding a pick, its price
    # range) per arm; the order odds are the same, so the result is about
    # what the picks add to the total.
    arms = {
        "add-ons":       (0.34, (12, 24)),
        "premium-picks": (0.18, (34, 68)),
        "best-sellers":  (0.24, (28, 34)),
    }

    def visit():
        ctx = generate_shopper_context()
        picks = client.variation("upsellPicks", ctx, "add-ons")
        add_rate, (low, high) = arms.get(picks, arms["add-ons"])
        total = _order_total()
        if random.random() < add_rate:
            client.track(ADD_TO_CART_KEY, ctx)
            client.track(UPSELL_ADDED_KEY, ctx)
            total += random.randint(low, high)
        if random.random() < 0.55:
            client.track(ORDER_PLACED_KEY, ctx, None, round(total, 2))

    _run_visitors(client, "09 Complete Your Look Picks", visit)


def express_checkout_experiment_generator(client):
    # Only the last step differs: the wallet buttons sit on the checkout
    # page, so they cannot change whether someone gets there.
    order_rate = {False: 0.55, True: 0.68}

    def visit():
        ctx = generate_shopper_context()
        express = client.variation("expressCheckout", ctx, False)
        client.track(PRODUCT_VIEWED_KEY, ctx)
        if random.random() >= 0.45:
            return
        client.track(ADD_TO_CART_KEY, ctx)
        if random.random() >= 0.70:
            return
        client.track(CHECKOUT_STARTED_KEY, ctx)
        if random.random() >= order_rate.get(express is True, 0.55):
            return
        client.track(ORDER_PLACED_KEY, ctx, None, _order_total())

    _run_visitors(client, "10 Express Checkout", visit)


def referral_offer_experiment_generator(client):
    # Signed-in shoppers on the account page, since that is the only place
    # the referral card is. Odds of copying the link, per offer.
    copy_rate = {"store-credit": 0.11, "free-tee": 0.16}

    def visit():
        ctx = generate_shopper_context()
        offer = client.variation("referralOffer", ctx, "store-credit")
        if random.random() < copy_rate.get(offer, 0.11):
            client.track(REFERRAL_LINK_COPIED_KEY, ctx, {"offer": offer})

    _run_visitors(client, "11 Referral Offer", visit)


def generate_returning_cart_context():
    """A signed-in shopper back at a cart they left, the only kind the Cart
    Recovery agent writes for: returningCart is what its experiment's rule
    matches, and members are left out because flag 08 gives them their
    member message instead of the reminder."""
    builder = Context.builder(f"shopper-{uuid.uuid4()}")
    builder.set("role", random.choices(["shopper", "beta"], weights=[95, 5])[0])
    builder.set("tier", "none")
    builder.set("returningCart", True)
    builder.set("cartItemCount", random.randint(1, 4))
    builder.set("device", random.choices(
        ["Mobile", "Desktop", "Tablet"], weights=[58, 36, 6])[0])
    builder.set("location", random.choice([
        "America/New_York", "America/Chicago", "America/Los_Angeles",
        "Europe/London", "Europe/Berlin",
    ]))
    return builder.build()


def cart_recovery_experiment_generator(client):
    """The Cart Recovery Offer experiment, on the agent's four variations.

    Like the Personal Stylist's generator, each line is an evaluation of the
    AI Config and the events pages/api/cart-recovery's tracker sends, tracked
    by hand; no model is called. Then the shopper does or does not come back
    to checkout. The agent's pick brings back as many orders as 10% off,
    but only gives the discount to the large carts that need it, so it comes
    out ahead on revenue, for a few more tokens a line. Twice the visitors
    of the other experiments, since four arms split them.
    """
    # (odds of ordering, share of the cart's value paid, input and output
    # token ranges)
    arms = {
        "reminder-only":   (0.18, 1.00, (430, 470), (30, 45)),
        "sticker-pack":    (0.23, 1.00, (440, 480), (30, 45)),
        "ten-percent-off": (0.28, 0.90, (440, 480), (30, 45)),
        "agent-choice":    (0.28, 0.98, (530, 590), (45, 70)),
    }
    disabled = {"_ldMeta": {"enabled": False}}

    def visit():
        ctx = generate_returning_cart_context()
        value = client.variation(CART_RECOVERY_CONFIG_KEY, ctx, disabled)
        meta = value.get("_ldMeta", {})
        if not meta.get("enabled"):
            return
        variation = meta.get("variationKey", "")
        order_rate, paid, (in_low, in_high), (out_low, out_high) = arms.get(
            variation, arms["reminder-only"])
        data = {
            "runId": str(uuid.uuid4()),
            "configKey": CART_RECOVERY_CONFIG_KEY,
            "variationKey": variation,
            "version": meta.get("version", 1),
            "modelName": value.get("model", {}).get("name", ""),
            "providerName": value.get("provider", {}).get("name", ""),
            "modelVersion": meta.get("modelVersion"),
            "modelKey": meta.get("modelKey"),
        }
        client.track("$ld:ai:duration:total", ctx, data,
                     int(min(2500, max(600, random.gauss(1200, 250)))))
        client.track("$ld:ai:generation:success", ctx, data, 1)
        tokens_in = random.randint(in_low, in_high)
        tokens_out = random.randint(out_low, out_high)
        client.track("$ld:ai:tokens:input", ctx, data, tokens_in)
        client.track("$ld:ai:tokens:output", ctx, data, tokens_out)
        client.track("$ld:ai:tokens:total", ctx, data, tokens_in + tokens_out)
        score = min(1.0, max(0.0, random.gauss(0.9, 0.06)))
        client.track("$ld:ai:judge:accuracy", ctx,
                     {**data, "judgeConfigKey": "togglewear-accuracy-judge"}, score)
        if random.random() < order_rate:
            client.track(ORDER_PLACED_KEY, ctx, None,
                         round(_order_total(60, 140) * paid, 2))

    _run_visitors(client, "Cart Recovery Offer", visit, EXPERIMENT_VISITORS * 2)


# --------------------------------- Personal Stylist, healthy AI Config

def personal_stylist_healthy_generator(client, stop_event):
    """Claude Opus 5.5 writes better stylist notes than Sonnet 4.6.

    The AI Config is a flag underneath, so each note is a plain evaluation
    for a made-up shopper, and the guarded rollout decides which model they
    get. What a real note records is then tracked by hand, with the event
    names and data the Node AI SDK's tracker sends from
    pages/api/personal-stylist, because the Python AI SDK is unpinned and its
    API moves between versions. No model is called.

    The numbers are the Cmd+K panel's "Succeeds" generator's
    (lib/generator/scenarios.ts): the same duration and error rate on both
    models, Opus's judge scores a few points higher, shoppers adding its
    suggestions a little more often, and Opus billing about five times the
    output tokens. So the rollout finds no regression and walks to 100%.
    """
    if not client.is_initialized():
        logging.error("LaunchDarkly client is not initialized.")
        return

    if not _wait_for_rollout(STYLIST_CONFIG_KEY, "Personal Stylist"):
        return

    logging.info("Personal Stylist generator running.")
    disabled = {"_ldMeta": {"enabled": False}}
    status_check_counter = 0
    notes = 0

    while True:
        if status_check_counter >= 100:
            details = get_flag_details(STYLIST_CONFIG_KEY)
            if not details or not is_measured_rollout(details):
                logging.info(f"Personal Stylist rollout finished after {notes} notes.")
                stop_event.set()
                break
            status_check_counter = 0

        try:
            ctx = generate_shopper_context()
            value = client.variation(STYLIST_CONFIG_KEY, ctx, disabled)
            status_check_counter += 1
            meta = value.get("_ldMeta", {})
            if not meta.get("enabled"):
                time.sleep(0.05)
                continue

            data = {
                "runId": str(uuid.uuid4()),
                "configKey": STYLIST_CONFIG_KEY,
                "variationKey": meta.get("variationKey", ""),
                "version": meta.get("version", 1),
                "modelName": value.get("model", {}).get("name", ""),
                "providerName": value.get("provider", {}).get("name", ""),
                "modelVersion": meta.get("modelVersion"),
                "modelKey": meta.get("modelKey"),
            }
            on_opus = data["variationKey"] == STYLIST_OPUS
            lift = 0.05 if on_opus else 0.0

            duration = int(min(4500, max(1200, random.gauss(2600, 450))))
            client.track("$ld:ai:duration:total", ctx, data, duration)
            if random.random() < 0.01:
                client.track("$ld:ai:generation:error", ctx, data, 1)
            else:
                client.track("$ld:ai:generation:success", ctx, data, 1)
                tokens_in = random.randint(2050, 2450) if on_opus else random.randint(1450, 1750)
                tokens_out = random.randint(380, 500) if on_opus else random.randint(60, 110)
                client.track("$ld:ai:tokens:input", ctx, data, tokens_in)
                client.track("$ld:ai:tokens:output", ctx, data, tokens_out)
                client.track("$ld:ai:tokens:total", ctx, data, tokens_in + tokens_out)
                for judge_key, metric_key, mean in STYLIST_JUDGES:
                    score = min(1.0, max(0.0, random.gauss(mean + lift, 0.06)))
                    client.track(metric_key, ctx, {**data, "judgeConfigKey": judge_key}, score)
                if random.random() < 0.1:
                    down = random.random() < 0.15 - lift
                    kind = "negative" if down else "positive"
                    client.track(f"$ld:ai:feedback:user:{kind}", ctx, data, 1)
                if random.random() < STYLIST_TAKE_RATE + 0.6 * lift:
                    kind = "size" if random.random() < 0.6 else "pairing"
                    client.track(STYLIST_SUGGESTION_KEY, ctx, {"kind": kind})
            notes += 1
            time.sleep(0.05)
        except Exception as e:
            logging.error(f"Error generating Personal Stylist metrics: {e}")
            continue

    logging.info("Personal Stylist generator finished.")


def experiments_generator(client):
    """The five experiments one after another, on their own thread."""
    if not client.is_initialized():
        logging.error("LaunchDarkly client is not initialized.")
        return
    announcement_offer_experiment_generator(client)
    upsell_picks_experiment_generator(client)
    express_checkout_experiment_generator(client)
    referral_offer_experiment_generator(client)
    cart_recovery_experiment_generator(client)
    client.flush()


# ------------------------------------------------------------ entrypoint

def generate_results(project_key, api_key):
    sdk_key = os.getenv("LD_SDK_KEY")
    if not sdk_key:
        print("LD_SDK_KEY not set in environment. Skipping result generation.")
        return

    # Both generator threads track events on this one client, so the queue has
    # to absorb their combined burst rate between flushes or the SDK drops
    # events ("Exceeded event queue capacity") and thins the demo data.
    #
    # But keep events_max_pending modest: the SDK posts the ENTIRE queue as one
    # request, and if the events endpoint rejects it as too large (HTTP 413) the
    # SDK permanently disables event delivery — which also leaves the guarded
    # rollout generators looping forever, because the release guardian never
    # receives the metric events it needs to finish the rollout. Compression
    # shrinks payloads around tenfold; the small queue caps the worst case on
    # older SDKs that lack it.
    config_kwargs = dict(sdk_key=sdk_key, events_max_pending=2000, flush_interval=1)

    if OBSERVABILITY_AVAILABLE:
        config_kwargs["plugins"] = [ObservabilityPlugin(ObservabilityConfig(
            service_name=ORDER_SERVICE_NAME,
            service_version=os.getenv("GITHUB_SHA", "local"),
            environment=ENVIRONMENT_KEY,
        ))]
    else:
        logging.warning(
            "Observability plugin unavailable, so flag 07's Monitoring tab will "
            "have no errors, logs or traces. It needs Python 3.10 or newer.")

    try:
        ldclient.set_config(Config(enable_event_compression=True, **config_kwargs))
    except TypeError:
        ldclient.set_config(Config(**config_kwargs))

    client = ldclient.get()

    evaluate_flags_by_tag(client, "togglewear")

    inventory_stop = threading.Event()
    order_stop = threading.Event()

    inventory_thread = threading.Thread(
        target=inventory_service_healthy_generator, args=(client, inventory_stop))
    order_thread = threading.Thread(
        target=order_pipeline_failed_generator, args=(client, order_stop))
    stylist_stop = threading.Event()
    stylist_thread = threading.Thread(
        target=personal_stylist_healthy_generator, args=(client, stylist_stop))
    # Alongside the guarded releases rather than before them, which would hold
    # their traffic back while their rollout stages ran on regardless.
    experiments_thread = threading.Thread(
        target=experiments_generator, args=(client,))

    inventory_thread.start()
    order_thread.start()
    stylist_thread.start()
    experiments_thread.start()

    logging.info("Guarded release generators running.")
    logging.info("  06 Live Inventory Service should reach 100% in about 10 minutes.")
    logging.info("  07 Order Pipeline v2 should be rolled back around minute 5 to 7.")
    logging.info("  Personal Stylist should reach Claude Opus 5.5 at 100% in about 10 minutes.")

    # Safety cap. The healthy scenario is the slower of the two at about ten
    # minutes, so this has to comfortably exceed that or provisioning would
    # abandon the thread mid-story.
    MAX_GENERATOR_WAIT = 1200

    inventory_thread.join(timeout=MAX_GENERATOR_WAIT)
    order_thread.join(timeout=MAX_GENERATOR_WAIT)
    stylist_thread.join(timeout=MAX_GENERATOR_WAIT)
    experiments_thread.join(timeout=MAX_GENERATOR_WAIT)

    threads = (inventory_thread, order_thread, stylist_thread, experiments_thread)
    still_running = [t for t in threads if t.is_alive()]
    if still_running:
        logging.warning(
            f"{len(still_running)} generator(s) still running after the cap — proceeding anyway.")
    else:
        logging.info("All guarded release and experiment generators completed.")

    client.flush()
    client.close()
