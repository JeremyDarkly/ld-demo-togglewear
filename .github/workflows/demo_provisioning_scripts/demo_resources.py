"""Demo resource definitions for DemoBuilder-v2.

Each table below declares one family of LaunchDarkly resources created for
the demo environment.  To add or change a resource, edit the relevant table —
DemoBuilder.py contains the generic creation loops that consume them.

Tables:
    METRICS         -> LDPlatform.create_metric(**spec)
    METRIC_GROUPS   -> LDPlatform.create_metric_group(**spec)
    FLAGS           -> create_flag(**spec["flag"]) + optional "post" follow-up calls
    SEGMENTS        -> created per environment listed, with shared rules
    CONTEXT_KINDS   -> [context_key, for_experiment]
    EXPERIMENTS     -> toggled flag, metrics, create_experiment kwargs
    PROMPT_SNIPPETS -> LDPlatform.create_snippet(**spec)
    AI_TOOLS        -> LDPlatform.create_ai_tool(**spec)
    AI_CONFIGS      -> create_ai_config(**spec["config"]), its variations,
                       tools, judges, targeting, then switched on

Entries with {"custom": "<method name>"} defer to a hand-written method on
DemoBuilder for cases that don't fit the generic shape.

The tables started empty on purpose.  What was here described five products —
ToggleBank, Investment, Galaxy Marketplace, Public Sector and LaunchAirways —
and ToggleWear is one.  Rather than rename 49 flags and 41 metrics into retail
clothing, the resources are being rebuilt a capability at a time, so the flag
list in LaunchDarkly always says exactly which capabilities are covered.  The
originals are in git history and in ld-core-demo if any of them are wanted
back.

Flags are numbered rather than lettered: core-demo's A/B/D/P prefixes separate
its verticals, and ToggleWear has none to separate.  The number is the order a
demo walks through them, simplest first, and the name carries the capability,
so the flag list reads as the demo script.  A new flag goes where it belongs in
that script and the ones after it are renumbered, rather than being added at
the end.  The flag keys carry no number, so renumbering never touches the app.

PIPELINE_FLAGS is gone outright: LaunchDarkly has deprecated release
pipelines, so there is nothing for that table to build.
"""

# ==========================================================================
# Resource definition tables
# ==========================================================================

# Metrics — passed straight to LDPlatform.create_metric(**spec)
#
# Every event below is emitted by results_generator.py, not by the storefront.
# A guarded release needs a service that can measurably degrade, and ToggleWear
# has no backend, so the data is synthetic — which is also how core-demo does it.
#
# Note the deliberate split between the two sets. The inventory metrics are
# conversion metrics (one yes/no per context) because a healthy rollout only has
# to avoid regressing. The order-pipeline ones are numeric in percentage points
# because that flag has to show a regression building: the generator tracks 100
# or 0 per event so each chart bucket averages to a smooth mean. Core-demo
# learned this the hard way — as conversion metrics the same chart came out flat
# and stepped, and the detector never fired convincingly.
METRICS = [
    # ---- 06 Live Inventory Service: healthy guarded release ----
    {'metric_key': 'inventory-lookup-success',
     'metric_name': 'Inventory Lookup Success',
     'event_key': 'inventory-lookup-success',
     'metric_description': 'Stock-level lookups that returned a result. The headline metric for '
                           'the live inventory service rollout.',
     'numeric': False,
     'unit': '',
     'success_criteria': 'HigherThanBaseline',
     'tags': ['guarded-release', 'inventory', 'togglewear']},
    {'metric_key': 'inventory-lookup-latency',
     'metric_name': 'Inventory Lookup Latency',
     'event_key': 'inventory-lookup-latency',
     'metric_description': 'Time taken to return a stock level, in milliseconds.',
     'numeric': True,
     'unit': 'ms',
     'success_criteria': 'LowerThanBaseline',
     'tags': ['guarded-release', 'inventory', 'togglewear']},
    {'metric_key': 'inventory-lookup-errors',
     'metric_name': 'Inventory Lookup Errors',
     'event_key': 'inventory-lookup-errors',
     'metric_description': 'Stock-level lookups that failed outright.',
     'numeric': False,
     'unit': '',
     'success_criteria': 'LowerThanBaseline',
     'tags': ['guarded-release', 'inventory', 'togglewear']},
    {'metric_key': 'inventory-lookups-served',
     'metric_name': 'Inventory Lookups Served',
     'event_key': 'inventory-lookups-served',
     'metric_description': 'Total stock-level lookups handled. Attached to the flag for release '
                           'monitoring rather than monitored for regressions.',
     'numeric': True,
     'unit': 'lookups',
     'success_criteria': 'HigherThanBaseline',
     'tags': ['guarded-release', 'inventory', 'togglewear', 'business']},

    # ---- 07 Order Pipeline v2: failed guarded release ----
    {'metric_key': 'order-pipeline-success-rate',
     'metric_name': 'Order Pipeline Success Rate',
     'event_key': 'order-pipeline-success-rate',
     'metric_description': 'Share of orders the pipeline accepted, in percentage points. Falls '
                           'away as the v2 pipeline degrades.',
     'numeric': True,
     'unit': 'pp',
     'success_criteria': 'HigherThanBaseline',
     'tags': ['guarded-release', 'orders', 'togglewear']},
    {'metric_key': 'order-pipeline-latency',
     'metric_name': 'Order Pipeline Latency',
     'event_key': 'order-pipeline-latency',
     'metric_description': 'Time taken to accept an order, in milliseconds. Climbs steadily under '
                           'the v2 pipeline before the rollback fires.',
     'numeric': True,
     'unit': 'ms',
     'success_criteria': 'LowerThanBaseline',
     'tags': ['guarded-release', 'orders', 'togglewear']},
    {'metric_key': 'order-pipeline-error-rate',
     'metric_name': 'Order Pipeline Error Rate',
     'event_key': 'order-pipeline-error-rate',
     'metric_description': 'Share of orders the pipeline rejected, in percentage points. This is '
                           'the metric that trips the automatic rollback.',
     'numeric': True,
     'unit': 'pp',
     'success_criteria': 'LowerThanBaseline',
     'tags': ['guarded-release', 'orders', 'togglewear']},
    {'metric_key': 'orders-processed',
     'metric_name': 'Orders Processed',
     'event_key': 'orders-processed',
     'metric_description': 'Total orders through the pipeline. Attached to the flag for release '
                           'monitoring rather than monitored for regressions.',
     'numeric': True,
     'unit': 'orders',
     'success_criteria': 'HigherThanBaseline',
     'tags': ['guarded-release', 'orders', 'togglewear', 'business']},

    # ---- 08 to 11: the experiments ----
    #
    # Unlike everything above, these events are real: the storefront sends
    # them (lib/events.ts) as well as the generator, so a demo can click
    # through the store and watch its own visit arrive. The event keys have to
    # match EVENTS there exactly.
    {'metric_key': 'product-viewed',
     'metric_name': 'Product Viewed',
     'event_key': 'product-viewed',
     'metric_description': 'Opened a product page. The first step of the purchase funnel.',
     'numeric': False,
     'unit': '',
     'success_criteria': 'HigherThanBaseline',
     'tags': ['experiment', 'funnel', 'togglewear']},
    {'metric_key': 'add-to-cart',
     'metric_name': 'Added to Cart',
     'event_key': 'add-to-cart',
     'metric_description': 'Added anything to the cart, from any page.',
     'numeric': False,
     'unit': '',
     'success_criteria': 'HigherThanBaseline',
     'tags': ['experiment', 'funnel', 'togglewear']},
    {'metric_key': 'upsell-added',
     'metric_name': 'Complete Your Look Add',
     'event_key': 'upsell-added',
     'metric_description': 'Added one of the three "Complete your look" picks on the cart page. '
                           'Its own event so flag 09 can tell these apart from any other add.',
     'numeric': False,
     'unit': '',
     'success_criteria': 'HigherThanBaseline',
     'tags': ['experiment', 'upsell', 'togglewear']},
    {'metric_key': 'checkout-started',
     'metric_name': 'Checkout Started',
     'event_key': 'checkout-started',
     'metric_description': 'Reached checkout with something in the cart.',
     'numeric': False,
     'unit': '',
     'success_criteria': 'HigherThanBaseline',
     'tags': ['experiment', 'funnel', 'togglewear']},
    {'metric_key': 'order-placed',
     'metric_name': 'Order Placed',
     'event_key': 'order-placed',
     'metric_description': 'Placed an order the fraud agent approved. The last step of the '
                           'purchase funnel.',
     'numeric': False,
     'unit': '',
     'success_criteria': 'HigherThanBaseline',
     'tags': ['experiment', 'funnel', 'togglewear']},
    # The same event as Order Placed, read for the value it carries rather
    # than for whether it happened: the order total in dollars, after
    # discounts and with tax. This is the "average order value" in the story.
    {'metric_key': 'order-revenue',
     'metric_name': 'Order Revenue',
     'event_key': 'order-placed',
     'metric_description': 'Order total in US dollars, after discounts and with tax.',
     'numeric': True,
     'unit': '$',
     'success_criteria': 'HigherThanBaseline',
     'tags': ['experiment', 'revenue', 'togglewear']},
    {'metric_key': 'referral-link-copied',
     'metric_name': 'Referral Link Copied',
     'event_key': 'referral-link-copied',
     'metric_description': 'Copied their referral link on the account page. Flag 11\'s '
                           'experiment counts each shopper once, however often they copy it.',
     'numeric': False,
     'unit': '',
     'success_criteria': 'HigherThanBaseline',
     'tags': ['experiment', 'referral', 'togglewear']},

    # ---- 14 Recommendation Engine: adaptive trigger ----
    #
    # What flag 14's adaptive trigger watches. A running total rather than a
    # conversion: a conversion counts each shopper once, so one person
    # clicking through a demo could never cross a threshold of more than a
    # few. The demo generator (Cmd+K in the storefront) sends 1 per failed
    # request.
    {'metric_key': 'recommendations-failed',
     'metric_name': 'Recommendations Failed',
     'event_key': 'recommendations-failed',
     'metric_description': 'The personalized "Recommended for you" row failed to load. Flag '
                           '14\'s adaptive trigger switches to best sellers when this climbs.',
     'numeric': True,
     'unit': 'failures',
     'success_criteria': 'LowerThanBaseline',
     'unit_aggregation_type': 'sum',
     'tags': ['adaptive-trigger', 'recommendations', 'togglewear']},
]

# Metric groups — funnels, passed to LDPlatform.create_metric_group(**spec)
#
# The four steps of a purchase, in order. Flag 10's experiment reads it as its
# primary metric, so the result says where the express checkout changes the
# drop-off rather than only whether more orders came out of the end.
METRIC_GROUPS = [
    {'group_key': 'purchase-funnel',
     'group_name': 'Purchase Funnel',
     'metrics': [{'key': 'product-viewed', 'nameInGroup': '1'},
                 {'key': 'add-to-cart', 'nameInGroup': '2'},
                 {'key': 'checkout-started', 'nameInGroup': '3'},
                 {'key': 'order-placed', 'nameInGroup': '4'}],
     'kind': 'funnel',
     'description': 'Product view to add to cart to checkout to placed order.'},
]

# Flags — create_flag(**spec["flag"]), plus any "post" follow-up calls
FLAGS = [
    # ---- Capability 0: a release toggle ----
    #
    # The Early Access section on the homepage, and the first thing a demo
    # shows: a whole feature that is on for some shoppers, absent for the rest,
    # and gone for everyone the moment the flag is switched off.  ToggleWear's
    # version of core-demo's A1 Wealth Management flag.
    #
    # on_variation is Hide, so with the flag on the default rule hides the
    # section and only the two segment rules show it — add_segment_to_flag
    # serves the first variation, which is Show.  Off serves Hide too, which
    # is what makes the toggle a kill switch.
    {'flag': {'flag_key': 'earlyAccessDrop',
              'flag_name': '01 - Early Access Drop - Release Toggle',
              'description': 'Shows the Early Access section on the homepage, previewing the '
                             'next drop. Released to beta testers and developers only; turn '
                             'it off to hide it from everyone.',
              'variations': [{'value': True, 'name': 'Show Early Access Drop'},
                             {'value': False, 'name': 'Hide Early Access Drop'}],
              'tags': ['release', 'segments', 'togglewear'],
              'on_variation': 1},
     'post': [['add_segment_to_flag',
               ['earlyAccessDrop', 'beta-testers', 'production'],
               {}],
              ['add_segment_to_flag',
               ['earlyAccessDrop', 'developers', 'production'],
               {}],
              ['toggle_flag',
               ['earlyAccessDrop', 'on', 'production'],
               {}]]},

    # ---- Capability 1: targeting, segmentation and flag prerequisites ----
    #
    # Gates the Swag Tier Status card on /account.  Exposure runs staff,
    # testers and both loyalty tiers, then a half-and-half rollout of everyone
    # else.  The tiers are in so every member sees the card that describes
    # their own membership, rather than half of them by chance.  Note that this
    # decides *whether* a shopper sees the card at all, while loyaltyTier
    # decides what the card then says — lib/shopper.ts keeps those two axes
    # separate on purpose, and this flag only touches the first one.
    #
    # Unlike core-demo, the segment rules live here in the table rather than in
    # a hand-written add_targeting_rules method, so the whole flag is one spec.
    {'flag': {'flag_key': 'swagTierProgram',
              'flag_name': '02 - Swag Tier Program - Targeting & Segmentation',
              'description': 'Shows the Swag Tier Status card on the account page. Released '
                             'to developers, beta testers and Gold and Platinum members, '
                             'then to half of all other shoppers.',
              'variations': [{'value': True, 'name': 'Show Swag Tier Program'},
                             {'value': False, 'name': 'Hide Swag Tier Program'}],
              'tags': ['targeting', 'segments', 'loyalty', 'togglewear'],
              'on_variation': 0},
     'post': [['add_segment_to_flag',
               ['swagTierProgram', 'developers', 'production'],
               {}],
              ['add_segment_to_flag',
               ['swagTierProgram', 'beta-testers', 'production'],
               {}],
              ['add_segment_to_flag',
               ['swagTierProgram', 'gold-members', 'production'],
               {}],
              ['add_segment_to_flag',
               ['swagTierProgram', 'platinum-members', 'production'],
               {}],
              ['set_default_percentage_rollout',
               ['swagTierProgram', 'production'],
               {'weights': {True: 50000, False: 50000}}],
              ['toggle_flag',
               ['swagTierProgram', 'on', 'production'],
               {}]]},

    # The gift strip inside that card.  Prerequisite-gated rather than given
    # its own copy of the targeting above, which is the point of the pair: it
    # cannot appear for a shopper who has no card to put it in, and turning 02
    # off makes it vanish while it still reads On in the flag list.
    {'flag': {'flag_key': 'giftUnlockTeaser',
              'flag_name': '03 - Gift Unlock Teaser - Flag Prerequisite',
              'description': 'The "points away from your next exclusive gift" strip inside '
                             'the Swag Tier Status card. Requires 02 to be serving Show, so '
                             'it inherits that rollout instead of repeating it.',
              'variations': [{'value': True, 'name': 'Show Gift Unlock Teaser'},
                             {'value': False, 'name': 'Hide Gift Unlock Teaser'}],
              'tags': ['prerequisite', 'loyalty', 'togglewear'],
              'on_variation': 0},
     'post': [['add_prerequisite_to_flag',
               ['giftUnlockTeaser', 'swagTierProgram', 0, 'production'],
               {}],
              ['toggle_flag',
               ['giftUnlockTeaser', 'on', 'production'],
               {}]]},

    # ---- Capability 2: progressive rollout ----
    #
    # Live order tracking on the account page: the parcel on a map, moving as
    # the carrier reports it. Eased out rather than switched on, which is the
    # realistic shape for it — every open panel polls the carrier, and a
    # carrier's tracking API is paid per call and rate-limited.
    #
    # add_progressive_rollout steps 1% -> 5% -> 10% -> 25% -> 50% and turns the
    # flag on itself, so no toggle_flag is needed here.
    #
    # timeout is the duration of each stage and has to be passed: LaunchDarkly
    # caps a progressive rollout at 30 days in total, and the helper's five
    # stages at its default of a week each come to 35, which fails the whole
    # patch with invalid_patch — including the turnFlagOn in the same request,
    # so the flag silently stays off. Five days gives 25 days in total.
    #
    # The rollout starts at 1%, which is the point of the segment rules: rules
    # are evaluated before the default rule, so beta testers and developers
    # see it immediately while everyone else waits for the schedule. Megan
    # and Chris each have a parcel on its way for it to show. Without the
    # rules the feature would be invisible to everyone during a demo.
    {'flag': {'flag_key': 'liveOrderTracking',
              'flag_name': '04 - Live Order Tracking - Progressive Rollout',
              'description': 'Shows live tracking for a parcel on its way, on the account page. '
                             'Beta testers and developers get it straight away; everyone else '
                             'arrives through a five-stage progressive rollout.',
              'variations': [{'value': True, 'name': 'Show Live Order Tracking'},
                             {'value': False, 'name': 'Hide Live Order Tracking'}],
              'tags': ['progressive-rollout', 'orders', 'togglewear'],
              'on_variation': 0},
     'post': [['add_segment_to_flag',
               ['liveOrderTracking', 'beta-testers', 'production'],
               {}],
              ['add_segment_to_flag',
               ['liveOrderTracking', 'developers', 'production'],
               {}],
              ['add_progressive_rollout',
               ['liveOrderTracking', 'production'],
               {'timeout': 432000000}]]},

    # ---- Capability 3: debugging a release with observability ----
    #
    # A release that breaks the way real ones do, and the evidence an engineer
    # follows to find out why. ToggleWear's answer to ToggleStore's A4, which
    # garbles the page and throws errors from a timer: here the code is
    # ordinary and the bug is a real one, so every signal points at it.
    #
    # Evaluated on the server, in pages/api/catalog/[slug].ts and
    # pages/api/stock/[slug].ts, which makes it the one flag a demo can show
    # running in the backend. v2 of the catalog changed its responses and the
    # product page, written against v1, was never told, so one release
    # causes five different errors, each with its own place in the store:
    #
    #   1. one-size items (both hats, every accessory) -> the page crashes:
    #      v2 sends sizes: null, a TypeError in ProductDetails
    #   2. Checkerboard Socks -> slow, then "taking too long to load": v2's
    #      sizing service times out, a SizingServiceTimeoutError on the server
    #   3. hoodie or tee badge -> "Stock unavailable": the inventory gateway
    #      answers with an HTML page, a SyntaxError parsing it
    #   4. hoodie or tee Size Guide -> "Size guide unavailable": v2 renamed
    #      the chart's columns, a TypeError in SizeGuideDialog
    #   5. hoodie or tee Add to Cart -> refused: v2 lowercased the SKU keys,
    #      an UnknownSkuError
    #
    # Each comes with what an engineer would follow: the error and its stack
    # trace, the routes' logs, the trace from the browser into the server with
    # the flag evaluation on it, and the session replay of the shopper.
    #
    # Created off, and off is its resting state: turning it on is the demo,
    # turning it off fixes all five at once.
    {'flag': {'flag_key': 'catalogApiV2',
              'flag_name': '05 - Catalog API v2 - Debugging with Observability',
              'description': 'Serves product pages from v2 of the catalog API, evaluated on the '
                             'server. One release, five different errors. Turn it on, then in the '
                             'store: (1) open a one-size item like the Bucket Hat and the page '
                             'crashes; (2) open the Checkerboard Socks and the page is slow, then '
                             'times out on the server; (3) open the ToggleWear Hoodie and the '
                             'badge says "Stock unavailable"; (4) on the hoodie, click Size Guide '
                             'and it fails; (5) on the hoodie, click Add to Cart and it is '
                             'refused. Then show all five in Observability (Errors, Logs, Traces, '
                             'Session Replay) and turn the flag off to fix them all. Resting '
                             'state: off.',
              'variations': [{'value': True, 'name': 'Use Catalog API v2'},
                             {'value': False, 'name': 'Use Catalog API v1'}],
              'tags': ['observability', 'release', 'catalog', 'togglewear'],
              'on_variation': 0,
              'off_variation': 1},
     'post': []},

    # ---- Capability 4: guarded releases, healthy and failed ----
    #
    # Neither of these has a surface in the storefront, and that is on purpose:
    # a guarded release is a story about a service degrading, and the evidence
    # lives in the metric charts rather than on the page. results_generator.py
    # supplies the traffic. core-demo's guarded releases work the same way.
    #
    # The healthy one keeps the default 1/5/10/25/50 ramp at two minutes a
    # stage, so it walks all the way to 100% in about ten minutes and never
    # trips. The generator simply makes the new service look better than the
    # old one.
    {'flag': {'flag_key': 'inventoryServiceV2',
              'flag_name': '06 - Live Inventory Service - Guarded Release (Healthy)',
              'description': 'Replaces nightly stock snapshots with live inventory lookups. The '
                             'rollout is monitored on lookup success, latency and errors, all of '
                             'which improve, so it advances to 100% on its own.',
              'variations': [{'value': True, 'name': 'Use Live Inventory Service'},
                             {'value': False, 'name': 'Use Nightly Stock Snapshot'}],
              'tags': ['guarded-release', 'inventory', 'togglewear', 'scenario'],
              'on_variation': 0},
     'post': [['attach_metric_to_flag',
               ['inventoryServiceV2',
                ['inventory-lookup-success',
                 'inventory-lookup-latency',
                 'inventory-lookup-errors',
                 'inventory-lookups-served']],
               {}],
              ['add_guarded_rollout',
               ['inventoryServiceV2', 'production'],
               {'metrics': ['inventory-lookup-success',
                            'inventory-lookup-latency',
                            'inventory-lookup-errors'],
                'days': 1}]]},

    # The failed one overrides the ramp with two stages at 25% and 50%, twenty
    # minutes each. Both halves of that matter: the default ramp opens at 1%,
    # which starves the treatment of events so the detector cannot reach
    # significance, and two-minute stages would finish the whole rollout before
    # the generator's degradation has had time to build. Forty minutes of
    # headroom against a regression that turns catastrophic around minute six
    # leaves the rollback plenty of room to fire.
    {'flag': {'flag_key': 'orderPipelineV2',
              'flag_name': '07 - Order Pipeline v2 - Guarded Release (Failed)',
              'description': 'Routes checkout through the rebuilt order pipeline. Error rate and '
                             'latency climb once traffic arrives and success rate falls away, so '
                             'LaunchDarkly detects the regression and rolls the flag back without '
                             'anyone intervening.',
              'variations': [{'value': True, 'name': 'Use Order Pipeline v2'},
                             {'value': False, 'name': 'Use Current Order Pipeline'}],
              'tags': ['guarded-release', 'orders', 'togglewear', 'scenario'],
              'on_variation': 0},
     'post': [['attach_metric_to_flag',
               ['orderPipelineV2',
                ['order-pipeline-success-rate',
                 'order-pipeline-latency',
                 'order-pipeline-error-rate',
                 'orders-processed']],
               {}],
              ['add_guarded_rollout',
               ['orderPipelineV2', 'production'],
               {'metrics': ['order-pipeline-success-rate',
                            'order-pipeline-latency',
                            'order-pipeline-error-rate'],
                'rollback': True,
                # 25% to open, not the usual 1% or even 10%. At 10% the
                # treatment arm had 36 users by the time the regression was
                # caught, which is too few to draw anything but a wide, jagged
                # band — the chart has to look like a measurement, not a
                # sketch, for the rollback to be convincing.
                'stages': [{'allocation': 25000, 'durationMillis': 1200000},
                           {'allocation': 50000, 'durationMillis': 1200000}]}]]},

    # ---- Capability 5: experimentation ----
    #
    # Four experiments, one of each kind a retail team runs most: an offer,
    # a merchandising choice, a checkout change and a referral reward. Each
    # flag is created off with no rollout; EXPERIMENTS below turns it on and
    # the experiment takes over its default rule. The first variation is the
    # control in each.

    # The announcement bar. Targeting decides the bar for anyone LaunchDarkly
    # knows something about, and only the default rule — guests, in practice
    # — is the experiment:
    #
    #   1. Gold or Platinum member             -> their member message
    #   2. signed in, came back to a cart      -> the cart reminder, with
    #                                             10% off as code COMEBACK
    #   3. signed in, otherwise                -> free shipping
    #   4. everyone else                       -> the experiment, three offers
    #
    # "Came back to a cart" is returningCart: the visit began with items left
    # on an earlier one. Items added during a visit never trigger it, so the
    # reminder does not chase someone mid-shop. It is a rule rather than app
    # logic so the definition of an abandoned cart belongs to whoever owns the
    # flag — tightening it to carts of three or more items is a clause on
    # cartItemCount, which is sent too.
    #
    # Rules 2 and 3 work because only signed-in contexts carry returningCart
    # (lib/ldContext.ts), so a guest matches neither and falls through. That is
    # also what keeps a guest in the experiment whatever is in their cart.
    # The cart reminder rule is the live-targeting beat of the demo: Refill
    # from the account menu stands in for a cart left yesterday, Empty clears
    # it, and the bar changes without a reload.
    {'flag': {'flag_key': 'announcementOffer',
              'flag_name': '08 - Announcement Banner Offer - Feature Experiment',
              'description': 'The offer in the bar across the top of every page. Members get '
                             'their own message and signed-in shoppers who came back to a cart '
                             'get a reminder with a comeback code; guests are split between free '
                             'shipping, 10% off a first order and a free sticker pack.',
              'variations': [{'value': 'free-shipping', 'name': 'Free Shipping'},
                             {'value': 'first-order-discount', 'name': '10% Off First Order'},
                             {'value': 'free-sticker-pack', 'name': 'Free Sticker Pack'},
                             {'value': 'cart-reminder', 'name': 'Cart Reminder'},
                             {'value': 'member-message', 'name': 'Member Message'}],
              'tags': ['experiment', 'targeting', 'togglewear'],
              'on_variation': 0,
              'off_variation': 0},
     'post': [['add_rule_to_flag',
               ['announcementOffer', 'production',
                [['', 'segmentMatch', 'segmentMatch', ['gold-members', 'platinum-members']]],
                'member-message'],
               {'description': 'Gold and Platinum members'}],
              ['add_rule_to_flag',
               ['announcementOffer', 'production',
                [['user', 'returningCart', 'in', [True]]],
                'cart-reminder'],
               {'description': 'Signed in, came back to a cart from an earlier visit'}],
              ['add_rule_to_flag',
               ['announcementOffer', 'production',
                [['user', 'returningCart', 'in', [False]]],
                'free-shipping'],
               {'description': 'Signed in, no abandoned cart'}]]},

    # "Complete your look" on the cart page. No rules: everyone with a cart
    # is fair game, signed in or not, so the whole default rule is the
    # experiment. The product sets are UPSELL_SETS in lib/cart.ts.
    {'flag': {'flag_key': 'upsellPicks',
              'flag_name': '09 - Complete Your Look Picks - Feature Experiment',
              'description': 'Which three products the cart suggests under "Complete your '
                             'look": cheap add-ons, pricier picks or best sellers. Measured on '
                             'order revenue, so the winner is the set that raises the order '
                             'total, not the one that gets clicked most.',
              'variations': [{'value': 'add-ons', 'name': 'Add-ons'},
                             {'value': 'premium-picks', 'name': 'Premium Picks'},
                             {'value': 'best-sellers', 'name': 'Best Sellers'}],
              'tags': ['experiment', 'upsell', 'togglewear'],
              'on_variation': 0,
              'off_variation': 0},
     'post': []},

    # Checkout. Two variations rather than three: every checkout version is
    # costly to build and risky to get wrong, which is why real teams test
    # them one change at a time, and it keeps the funnel chart readable.
    {'flag': {'flag_key': 'expressCheckout',
              'flag_name': '10 - Express Checkout - Funnel Experiment',
              'description': 'Adds one-tap PayPal and Apple Pay buttons above the checkout '
                             'form. Measured on the whole purchase funnel, from product view '
                             'to placed order.',
              'variations': [{'value': False, 'name': 'Current Checkout'},
                             {'value': True, 'name': 'Express Checkout'}],
              'tags': ['experiment', 'checkout', 'togglewear'],
              'on_variation': 0,
              'off_variation': 0},
     'post': []},

    # The referral card on the account page, each offer in its own Jen design
    # (ReferralCard.tsx). The account page is behind sign-in, so everyone in
    # it is a signed-in shopper, and the whole default rule is the
    # experiment.
    {'flag': {'flag_key': 'referralOffer',
              'flag_name': '11 - Referral Offer - Feature Experiment',
              'description': 'What the account page\'s referral card offers: $20 off for the '
                             'friend and $20 credit for the shopper, or a free ToggleWear Tee for '
                             'both. Measured on how many shoppers copy their referral link.',
              'variations': [{'value': 'store-credit', 'name': 'Give $20, Get $20'},
                             {'value': 'free-tee', 'name': 'Give a Tee, Get a Tee'}],
              'tags': ['experiment', 'referral', 'togglewear'],
              'on_variation': 0,
              'off_variation': 0},
     'post': []},

    # ---- Capability 6: kill switches ----
    #
    # Flags that an observability alert flips through a flag trigger, with no
    # one in the loop. ToggleWear's versions of core-demo's A9 and A10: one
    # turns a risky change off when it breaks, the other turns a protection
    # on when an attack starts.
    #
    # The chain is error -> observability alert -> trigger URL -> flag, and
    # DemoBuilder builds all of it: create_trigger_alert makes the trigger,
    # then an alert whose webhook is the trigger URL. The URL is a secret,
    # shown once at creation, passed straight to the alert and never printed.
    # The alert matches on type, which is the error's class name.
    #
    # Creating the alert sends its webhook a one-off "alert created" notice,
    # which calls the trigger. create_trigger_alert waits for that call, and
    # the toggle_flag after it puts the flag back in its resting state. Flag
    # 12 is turned on first so that the notice has something to turn off.
    #
    # Flag 12 is staged from the account menu's "Simulate an incident" controls
    # (IncidentProvider.tsx), and its errors come from the storefront through
    # the browser observability plugin. Flag 13 is a backend scenario with no
    # screen in the store: the demo generator (Cmd+K, lib/generator) plays the
    # payments service, and its errors come from there.

    # On, serving the new processor. During a staged payment outage every
    # approved order fails with a PaymentProcessorError; the alert on those
    # (more than 3 in 5 minutes) calls the trigger, the flag turns off,
    # and off serves the current processor, so the next order goes through.
    {'flag': {'flag_key': 'newPaymentProcessor',
              'flag_name': '12 - New Payment Processor - Kill Switch',
              'description': 'Charges orders through the new payment processor. A trigger turns '
                             'it off, back to the current processor, when an observability alert '
                             'on PaymentProcessorError fires (more than 3 in 5 minutes). Demo it '
                             'from the account menu: turn on Payment outage under Simulate an '
                             'incident, then place 4 orders. Each one fails, and the flag turns '
                             'itself off about two minutes after the last, since the alert checks '
                             'once a minute. The next order then goes through. Resting state: on '
                             '— turn it back on, and Payment outage off, after a demo.',
              'variations': [{'value': True, 'name': 'Use New Payment Processor'},
                             {'value': False, 'name': 'Use Current Payment Processor'}],
              'tags': ['kill-switch', 'trigger', 'checkout', 'togglewear'],
              'on_variation': 0,
              'off_variation': 1},
     'post': [['toggle_flag',
               ['newPaymentProcessor', 'on', 'production'],
               {}],
              ['create_trigger_alert',
               ['newPaymentProcessor', 'production', 'turnFlagOff'],
               {'alert_name': '12 - Payment Processor Errors',
                'product_type': 'Errors',
                'query': 'type=PaymentProcessorError',
                'threshold_value': 3,
                'threshold_window': 300,
                'trigger_comment': 'Created by DemoBuilder. Called by the observability alert on '
                                   'PaymentProcessorError to fall back to the current processor.'}],
              ['toggle_flag',
               ['newPaymentProcessor', 'on', 'production'],
               {'comment': 'Back to its resting state after the new alert\'s setup notice '
                           'called the trigger.'}]]},

    # Off. The demo generator's card-testing attack sends two $1 charges a
    # second, which the issuer declines as CardDeclinedErrors; the alert on
    # those (more than 10 in a minute) calls the trigger, the flag turns
    # on, and the payments service refuses unverified cards, so the declines
    # stop and the generator stops itself. Turning it back off once the attack
    # is over is a person's call, which is realistic.
    {'flag': {'flag_key': 'cardTestingProtection',
              'flag_name': '13 - Card Testing Protection - Auto-Enable Trigger',
              'description': 'Makes the payments service verify a card before charging it. A '
                             'trigger turns it on when an observability alert on CardDeclinedError '
                             'fires (more than 10 in a minute), the signature of bots testing '
                             'stolen cards. Demo it with the Card Testing generator (Cmd+K in the '
                             'store). The flag turns itself on about two minutes after the '
                             'generator starts, since the alert checks once a minute, and the '
                             'generator then stops. Resting state: off — turn it back off after a '
                             'demo.',
              'variations': [{'value': True, 'name': 'Require Card Verification'},
                             {'value': False, 'name': 'Standard Checkout'}],
              'tags': ['kill-switch', 'trigger', 'checkout', 'fraud', 'togglewear'],
              'on_variation': 0,
              'off_variation': 1},
     'post': [['create_trigger_alert',
               ['cardTestingProtection', 'production', 'turnFlagOn'],
               {'alert_name': '13 - Declined Card Spike',
                'product_type': 'Errors',
                'query': 'type=CardDeclinedError',
                'threshold_value': 10,
                'threshold_window': 60,
                'trigger_comment': 'Created by DemoBuilder. Called by the observability alert on '
                                   'CardDeclinedError to require card verification.'}],
              ['toggle_flag',
               ['cardTestingProtection', 'off', 'production'],
               {'comment': 'Back to its resting state after the new alert\'s setup notice '
                           'called the trigger.'}]]},

    # ---- Capability 7: adaptive triggers ----
    #
    # A kill switch turns a flag off or on; an adaptive trigger switches a rule
    # to a different variation. It is still driven by an alert, but one that
    # LaunchDarkly attaches to the flag itself, with no URL in between.
    #
    # On, serving personalized picks. A backend scenario with no screen in the
    # store: the demo generator (Cmd+K) plays the recommendation service,
    # which times out on every personalized request, recording the error and
    # sending recommendations-failed. The trigger on the default rule (more
    # than 3 in 5 minutes) switches it to best sellers, a list the store
    # already has, with nothing to fail, and the generator stops itself.
    #
    # create_adaptive_trigger makes the alert, then the adaptive trigger on the
    # default rule that points at it, as the LaunchDarkly UI does. The alert
    # counts Recommendations Failed events rather than reproducing the
    # metric, which averages per shopper: each made-up shopper fails once, so
    # that average sits at 1 and would never cross a threshold. An adaptive
    # trigger has no webhook, so nothing fires at setup. It does not switch
    # back on its own either, so restoring personalized picks after a demo is
    # done by hand.
    {'flag': {'flag_key': 'recommendationEngine',
              'flag_name': '14 - Recommendation Engine - Adaptive Trigger',
              'description': 'Which engine the recommendation service runs: personalized picks, '
                             'or best sellers. An adaptive trigger on Recommendations Failed (more '
                             'than 3 in 5 minutes) falls back to best sellers. Demo it with the '
                             'Recommendation Engine generator (Cmd+K in the store). The default '
                             'rule switches itself to Best Sellers about two minutes after the '
                             'generator starts, since the alert checks once a minute, and the '
                             'generator then stops. Resting state: Personalized Picks — '
                             'switch it back after a demo, since an adaptive trigger does not '
                             'restore the variation itself.',
              'variations': [{'value': 'personalized', 'name': 'Personalized Picks'},
                             {'value': 'best-sellers', 'name': 'Best Sellers'}],
              'tags': ['adaptive-trigger', 'recommendations', 'togglewear'],
              'on_variation': 0,
              'off_variation': 1},
     'post': [['toggle_flag',
               ['recommendationEngine', 'on', 'production'],
               {}],
              ['create_adaptive_trigger',
               ['recommendationEngine', 'production', 'best-sellers'],
               {'alert_name': '14 - Recommendations Failed',
                'product_type': 'LDCustomEvents',
                'query': 'environment_id={environment_id} key=recommendations-failed',
                'threshold_value': 3,
                'threshold_window': 300}]]},
]

# Segments — created in every environment listed, with shared rules
#
# The values are lowercase because that is what ShopperRole in lib/shopper.ts
# actually emits; core-demo's equivalents are capitalised and would never match.
SEGMENTS = [
    {'key': 'developers',
     'name': 'Developers',
     'description': 'ToggleWear engineers, who see storefront changes before anyone else',
     'environments': ['test', 'production', 'template-env'],
     'rules': [['user', 'role', 'in', ['developer']]]},
    {'key': 'beta-testers',
     'name': 'Beta Testers',
     'description': 'Shoppers who opted in to trying storefront features early',
     'environments': ['test', 'production', 'template-env'],
     'rules': [['user', 'role', 'in', ['beta']]]},
    # The two loyalty rungs, matched on the tier attribute rather than role:
    # being a member and being early to features are separate axes, so a gold
    # member is in Gold Members whatever their role says.
    {'key': 'gold-members',
     'name': 'Gold Members',
     'description': 'Shoppers on the Gold rung of the swag tier ladder',
     'environments': ['test', 'production', 'template-env'],
     'rules': [['user', 'tier', 'in', ['gold']]]},
    {'key': 'platinum-members',
     'name': 'Platinum Members',
     'description': 'Shoppers on the Platinum rung, the top of the swag tier ladder',
     'environments': ['test', 'production', 'template-env'],
     'rules': [['user', 'tier', 'in', ['platinum']]]},
]

# Context kinds — [key, for_experiment]
#
# device and location survive the clear-out because ToggleWear targets on both;
# core-demo's 'audience' and 'experience' kinds do not apply here.  organization
# and account arrive with the capability that needs them.
CONTEXT_KINDS = [
    ['device', True],
    ['location', True],
]

# Experiments — toggled flag, metrics, and create_experiment kwargs
#
# flagConfigVersion is left out on purpose: create_experiment reads the
# flag's current version itself, because every rule and toggle above moves it.
#
# All four are started, so results_generator.py's traffic lands in a running
# iteration and the results pages are full when the demo opens.
EXPERIMENTS = [
    {'requires': 'metrics_created',
     'toggle_flag': ['announcementOffer', 'on', 'production', 'Turn on flag for experiment'],
     # A funnel group can only be an experiment's primary metric, so the
     # steps that show where an offer helps are listed singly.
     'metrics': [['order-placed', False], ['order-revenue', False],
                 ['add-to-cart', False], ['checkout-started', False]],
     'experiment': {'exp_key': 'announcement-offer',
                    'exp_name': '(Bayesian) Feature Experiment: Announcement Banner Offer',
                    'exp_env': 'production',
                    'flag_key': 'announcementOffer',
                    'hypothesis': 'A concrete saving on the first order will convert more new '
                                  'visitors than free shipping or a free gift.',
                    'primary_key': 'order-placed',
                    'attributes': ['device', 'location'],
                    'treatment_values': ['free-shipping', 'first-order-discount',
                                         'free-sticker-pack']},
     'start_iteration': True},
    {'requires': 'metrics_created',
     'toggle_flag': ['upsellPicks', 'on', 'production', 'Turn on flag for experiment'],
     # order-placed is the guardrail: pricier picks must not put people off
     # buying at all.
     'metrics': [['order-revenue', False], ['upsell-added', False],
                 ['order-placed', False]],
     'experiment': {'exp_key': 'upsell-picks',
                    'exp_name': '(Bayesian) Feature Experiment: Complete Your Look Picks',
                    'exp_env': 'production',
                    'flag_key': 'upsellPicks',
                    'hypothesis': 'Suggesting pricier pieces will be added less often but raise '
                                  'the average order value more than cheap add-ons.',
                    'primary_key': 'order-revenue',
                    'attributes': ['device', 'location']},
     'start_iteration': True},
    {'requires': 'metric_groups_created',
     'toggle_flag': ['expressCheckout', 'on', 'production', 'Turn on flag for experiment'],
     'metrics': [['purchase-funnel', True], ['order-revenue', False]],
     'experiment': {'exp_key': 'express-checkout',
                    'exp_name': '(Frequentist) Funnel Experiment: Express Checkout',
                    'exp_env': 'production',
                    'flag_key': 'expressCheckout',
                    'hypothesis': 'One-tap wallet buttons will cut the drop-off between starting '
                                  'checkout and placing the order.',
                    'primary_key': 'purchase-funnel',
                    'methodology': 'frequentist',
                    'analysisConfig': {'significanceThreshold': '5',
                                       'testDirection': 'two-sided'},
                    'attributes': ['device', 'location']},
     'start_iteration': True},
    {'requires': 'metrics_created',
     'toggle_flag': ['referralOffer', 'on', 'production', 'Turn on flag for experiment'],
     'metrics': [['referral-link-copied', False]],
     'experiment': {'exp_key': 'referral-offer',
                    'exp_name': '(Bayesian) Feature Experiment: Referral Offer',
                    'exp_env': 'production',
                    'flag_key': 'referralOffer',
                    'hypothesis': 'A free tee for both people is a more tangible reward than store '
                                  'credit, so more shoppers will share their referral link.',
                    'primary_key': 'referral-link-copied',
                    'attributes': ['device', 'location']},
     'start_iteration': True},
]

# ==========================================================================
# AI Configs
# ==========================================================================
#
# The swag assistant, the chat panel at the bottom right of every page. It is
# a completion-mode AI Config, answering one question at a time from a
# prompt; the fraud agent is where agent mode and a multi-agent pipeline come
# in. The storefront's side is pages/api/swag-assistant.
#
# Everything about a reply that someone tuning it would want to change lives
# here rather than in the app: the model and its parameters, the prompt, the
# tools it may call and the judges that score it.

# Prompt snippets — LDPlatform.create_snippet(**spec)
#
# Prompt text more than one variation needs, kept once in LaunchDarkly's
# Library instead of copied into each. A variation writes
# {{snippet.<key>#<version>}} where the text belongs and LaunchDarkly swaps it
# in when the variation is served, so the storefront only ever sees the whole
# prompt. Editing a snippet makes a new version and leaves every variation on
# the one it names until someone moves it, which is the demo: change the
# returns window, see which variations use the snippet, update them on
# purpose.
PROMPT_SNIPPETS = [
    {'key': 'togglewear-store-policies',
     'name': 'ToggleWear Store Policies',
     'description': 'Shipping and returns, as the Swag Assistant and Personal Stylist quote '
                    'them and the Accuracy Judge checks them.',
     'text': (
         "ToggleWear store policies:\n"
         "- Shipping is free on every order and arrives in 3 to 5 business days.\n"
         "- Unworn items can be returned within 30 days."),
     'tags': ['policies', 'togglewear', 'shared']},
    {'key': 'togglewear-brand-voice',
     'name': 'ToggleWear Brand Voice',
     'description': 'How anything that talks to ToggleWear shoppers should sound: the Swag '
                    'Assistant and the Personal Stylist.',
     'text': (
         "ToggleWear brand voice:\n"
         "- Friendly and upbeat, like a teammate who knows the merch well.\n"
         "- Plain, everyday words, with no hype and no emojis.\n"
         "- Speak to the shopper directly, and use their first name at most once.\n"
         "- When something is not available, say so and suggest the closest thing that is."),
     'tags': ['brand', 'togglewear', 'shared']},
]


def _snippet(key):
    return '{{snippet.' + key + '#1}}'


# Shared by both variations, so the two differ only where they are meant to:
# the model, its length and the style it asks for.
_SWAG_ASSISTANT_GROUNDING = (
    "Use your tools rather than memory for anything about the catalog or this shopper: "
    "search-products to find items, get-product-details for sizes, fit and materials, "
    "get-member-perks for this shopper's discounts, points and rewards, and get-order-status "
    "for their recent orders and deliveries. Only mention products and orders a tool returned, "
    "and never make up a price, size, color, stock level, date or tracking number. When you "
    "talk about an order, give its order number.\n\n"
    + _snippet('togglewear-store-policies') + "\n\n"
    + _snippet('togglewear-brand-voice') + "\n\n"
    "Questions about this shopper's own orders, account and perks are part of shopping here. "
    "If a question has nothing to do with ToggleWear, say in one sentence that you can only "
    "help with shopping at ToggleWear."
)

# {{shopper_name}} and {{loyalty_tier}} are filled in by the storefront for
# each request (pages/api/swag-assistant/index.ts).
_SWAG_ASSISTANT_OPENING = (
    "You are the Swag Assistant for ToggleWear, LaunchDarkly's merch store. You are talking "
    "with {{shopper_name}}, whose loyalty tier is {{loyalty_tier}}.\n\n"
)

# The Personal Stylist's prompt: how to write a note, then the facts it is
# written from. The facts go in a user message because Bedrock's Claude
# models refuse a conversation that is only a system message.
# {{product_facts}} and {{order_history}} are the swag assistant's
# get-product-details and get-order-status results, filled in by the
# storefront (pages/api/personal-stylist/index.ts), so the two features
# describe a product and an order the same way.
_PERSONAL_STYLIST_MESSAGES = [
    {'role': 'system',
     'content': "You are the Personal Stylist for ToggleWear, LaunchDarkly's merch store. You "
                "write the short note shown on a product page for the shopper looking at it.\n\n"
                "Write two or three sentences. Recommend a size from the size chart, using a "
                "size they have ordered before when there is one, and say how it fits. Then "
                "suggest one thing to wear it with: an item from their orders if one goes with "
                "it, otherwise something general, such as dark jeans. For a one-size item, skip "
                "the size and say who it suits instead. Only name ToggleWear products you are "
                "given, and never make up a measurement, price or perk. Write plain text with no "
                "markdown, and do not greet the shopper or sign off.\n\n"
                + _snippet('togglewear-brand-voice') + "\n\n"
                + _snippet('togglewear-store-policies')},
    {'role': 'user',
     'content': "Shopper: {{shopper_name}}, loyalty tier {{loyalty_tier}}\n\n"
                "The product, as JSON:\n{{product_facts}}\n\n"
                "Their recent orders, as JSON:\n{{order_history}}\n\n"
                "Write my stylist note for this product."},
]

# What the judges are told about the store, so a reply quoting the shipping
# policy is checked against the same policy the assistant was given. One pair
# of judges scores both AI features, so the Swag Assistant and the Personal
# Stylist are held to the same rubric.
_JUDGE_OPENING = (
    "You evaluate replies from ToggleWear's AI features in LaunchDarkly's merch store: the "
    "Swag Assistant, a shopping chat, and the Personal Stylist, a short note on a product "
    "page about size, fit and what to wear it with. The message history shows what the "
    "reply was written from: for the chat, the conversation and, on lines starting "
    "\"tool:\", the catalog and account data its tools returned; for a stylist note, the "
    "request and, on lines starting \"data:\", the product and order data it was given.\n\n"
)

# The models, all on Bedrock, through the US cross-region inference profiles
# (the us. prefix) that Bedrock requires for them. Each is LaunchDarkly's own
# built-in model config for that profile, which carries Bedrock's US price, so
# the Monitoring tab's cost is right without our keeping prices up to date.
# A variation names its model config by key; the id is the model name the AI
# SDK hands Bedrock. LaunchDarkly derives Haiku's key from an id with a colon
# in it, hence the suffix.
_HAIKU = 'Bedrock.us.anthropic.claude-haiku-4-5-20251001-v1-0-f23b6a28'
_HAIKU_ID = 'us.anthropic.claude-haiku-4-5-20251001-v1:0'
_SONNET = 'Bedrock.us.anthropic.claude-sonnet-4-6'
_SONNET_ID = 'us.anthropic.claude-sonnet-4-6'
_GPT = 'Bedrock.us.openai.gpt-6-luna'
_GPT_ID = 'us.openai.gpt-6-luna'
_OPUS = 'Bedrock.us.anthropic.claude-opus-5-5'
_OPUS_ID = 'us.anthropic.claude-opus-5-5'

# Tools — LDPlatform.create_ai_tool(**spec)
#
# What the swag assistant can look up. LaunchDarkly holds each tool's name,
# description and arguments, which is what the model is shown; the storefront
# holds what it does (lib/swagAssistantTools.ts), and the keys have to match.
# All three read the catalogue as the shopper sees it, so the assistant can
# never tell a non-member about the members-only crewneck.
AI_TOOLS = [
    {'tool_key': 'search-products',
     'description': 'Searches the ToggleWear catalog and returns matching products with their '
                    'prices, sizes and whether they are new. Call it with no arguments to list '
                    'everything.',
     'schema': {'type': 'object',
                'properties': {
                    'query': {'type': 'string',
                              'description': 'Words describing what the shopper wants, such as '
                                             '"warm hoodie" or "gift for a coworker".'},
                    'category': {'type': 'string', 'enum': ['Apparel', 'Accessories'],
                                 'description': 'Only products in this category.'},
                    'max_price_usd': {'type': 'number',
                                      'description': 'Only products at or under this price.'},
                    'new_only': {'type': 'boolean',
                                 'description': 'Only products from the latest drop.'}},
                'additionalProperties': False,
                'required': []}},
    {'tool_key': 'get-product-details',
     'description': 'Returns one product\'s full description, features, colors, sizes and size '
                    'chart. Use it to recommend a size or explain the fit.',
     'schema': {'type': 'object',
                'properties': {
                    'slug': {'type': 'string',
                             'description': 'The product\'s slug, as returned by '
                                            'search-products.'}},
                'additionalProperties': False,
                'required': ['slug']}},
    {'tool_key': 'get-member-perks',
     'description': 'Returns what this shopper gets: their loyalty tier, member discount, the '
                    'codes they can use, loyalty points and the next reward, and shipping.',
     'schema': {'type': 'object',
                'properties': {},
                'additionalProperties': False,
                'required': []}},
    {'tool_key': 'get-order-status',
     'description': 'Returns this shopper\'s recent orders: what was in each, its status, the '
                    'carrier and tracking number, the latest delivery update and when it '
                    'arrives or arrived. Guests have no orders.',
     'schema': {'type': 'object',
                'properties': {},
                'additionalProperties': False,
                'required': []}},

    # The Order Review agents' tools (lib/orderReviewTools.ts). None takes an
    # argument: each reads the order being reviewed, which the storefront
    # binds to the tool for that one review. The rules and points they apply
    # are fixed in code, so every lever at checkout works the same way every
    # time and the agents reason from the same facts.
    {'tool_key': 'get-order-details',
     'description': 'Returns the order under review: its items and quantities, the total, the '
                    'payment method, the shipping address and who placed it.',
     'schema': {'type': 'object',
                'properties': {},
                'additionalProperties': False,
                'required': []}},
    {'tool_key': 'check-payment-risk',
     'description': 'Checks the order\'s value and quantities against the store\'s payment '
                    'rules and returns any risk signals with their points.',
     'schema': {'type': 'object',
                'properties': {},
                'additionalProperties': False,
                'required': []}},
    {'tool_key': 'check-shipping-address',
     'description': 'Checks the shipping address against known reshipping addresses and returns '
                    'any risk signal with its points.',
     'schema': {'type': 'object',
                'properties': {},
                'additionalProperties': False,
                'required': []}},
    {'tool_key': 'get-account-history',
     'description': 'Returns the account that placed the order: whether they are signed in, '
                    'their loyalty tier, when they joined and their past orders.',
     'schema': {'type': 'object',
                'properties': {},
                'additionalProperties': False,
                'required': []}},
]

# AI Configs — each one is created, then its variations, then the tools and
# judges on every variation, then its targeting, and finally switched on.
#
#   tools        tool keys from AI_TOOLS, attached to every variation
#   judges       judge configs to score every variation's replies; they have
#                to be created first, which is why they lead the table
#   rules        [variation key, clauses] targeting rules, in order
#   fallthrough  the variation everyone else gets
AI_CONFIGS = [
    # ---- The judges ----
    #
    # Judge-mode configs that score each Swag Assistant reply and Personal
    # Stylist note from 0 to 1. Ours rather than LaunchDarkly's built-in
    # judges so they run on Bedrock like the features do, and know
    # ToggleWear's policies. The AI SDK
    # hands each one the conversation and the reply, asks for a score and a
    # reason, and records the score on the variation that wrote the reply;
    # the metric keys are LaunchDarkly's own judge metrics, which is what puts
    # the scores on the Monitoring tab.
    {'config': {'config_key': 'togglewear-accuracy-judge',
                'config_name': 'ToggleWear Accuracy Judge',
                'description': 'Scores every Swag Assistant reply and Personal Stylist note from '
                               '0 to 1 for whether its facts match the catalog and order data it '
                               'was given and the store\'s policies. Runs on Claude Haiku 4.5; '
                               'the scores appear on each config\'s Monitoring tab.',
                'tags': ['ai-config', 'judge', 'togglewear'],
                'mode': 'judge',
                'evaluation_metric_key': '$ld:ai:judge:accuracy',
                'is_inverted': False},
     'variations': [
         {'ai_config_version_key': 'accuracy-judge',
          'ai_model_config_key': _HAIKU,
          'ai_config_version_name': 'Claude Haiku 4.5',
          'model': {'modelName': _HAIKU_ID,
                    'parameters': {'maxTokens': 500, 'temperature': 0.0}},
          'messages': [{'role': 'system', 'content': (
              _JUDGE_OPENING
              + _snippet('togglewear-store-policies') + "\n\n"
              + "Score how accurate the response is against that data and those policies.\n\n"
                "1.0: every product, price, size, material, discount and policy it states "
                "matches.\n"
                "0.7: accurate, with a small imprecision that would not mislead the shopper.\n"
                "0.4: one fact is wrong, such as a price, size or discount.\n"
                "0.0: it invents products or perks, or gets several facts wrong.\n\n"
                "A reply that states no facts, such as a polite refusal of an off-topic "
                "question, scores 1.0. Explain your score in one or two sentences.")}]}],
     'environment': 'production',
     'fallthrough': 'accuracy-judge'},
    {'config': {'config_key': 'togglewear-relevance-judge',
                'config_name': 'ToggleWear Relevance Judge',
                'description': 'Scores every Swag Assistant reply and Personal Stylist note from '
                               '0 to 1 for how directly it serves the shopper: answering what '
                               'they asked, or helping them decide on the product. Runs on '
                               'Claude Haiku 4.5; the scores appear on each config\'s Monitoring '
                               'tab.',
                'tags': ['ai-config', 'judge', 'togglewear'],
                'mode': 'judge',
                'evaluation_metric_key': '$ld:ai:judge:relevance',
                'is_inverted': False},
     'variations': [
         {'ai_config_version_key': 'relevance-judge',
          'ai_model_config_key': _HAIKU,
          'ai_config_version_name': 'Claude Haiku 4.5',
          'model': {'modelName': _HAIKU_ID,
                    'parameters': {'maxTokens': 500, 'temperature': 0.0}},
          'messages': [{'role': 'system', 'content': (
              _JUDGE_OPENING
              + "Score how directly the response answers the shopper's latest message, given "
                "the conversation before it. For a stylist note, score how well it helps this "
                "shopper decide on this product: a size, the fit and what to wear it with.\n\n"
                "1.0: answers exactly what was asked, with nothing the shopper has to dig past.\n"
                "0.7: answers it, with some padding or a detail that was not asked for.\n"
                "0.4: only partly answers it, or answers a different question.\n"
                "0.0: ignores the question.\n\n"
                "Declining a question that has nothing to do with shopping at ToggleWear counts "
                "as relevant. Explain your score in one or two sentences.")}]}],
     'environment': 'production',
     'fallthrough': 'relevance-judge'},

    # ---- The Swag Assistant ----
    #
    # Two variations that differ in a way a demo can see from across the
    # room: a small, fast OpenAI model giving short answers, and a stronger
    # Claude model giving the kind of answer a good store concierge would.
    # Members get the second, matched on the same Gold and Platinum segments
    # the rest of the store targets, so switching shopper in the account menu
    # switches variation, and the chat header says which one is serving.
    {'config': {'config_key': 'swag-assistant',
                'config_name': 'Swag Assistant',
                'description': 'The chat assistant in the storefront (the button at the bottom '
                               'right). Everyone gets Standard (OpenAI GPT-6 Luna, one to three '
                               'sentences); Gold and Platinum members get Member Concierge '
                               '(Claude Sonnet 4.6, fuller answers that compare options and '
                               'explain fit). Both run on Bedrock, call four tools against the '
                               'live catalog and the shopper\'s orders, and share the store '
                               'policies and brand voice snippets from the Library. The Accuracy '
                               'and Relevance judges score every reply. Duration, tokens, cost, '
                               'tool calls, judge scores and shoppers\' thumbs up or down appear '
                               'per variation on the Monitoring tab. Demo it: open the chat as '
                               'Alex Rivera (Gold), ask "Help me pick a hoodie", then change the '
                               'Gold and Platinum rule to Standard here — the chat header switches '
                               'to GPT-6 Luna within a second. Switch the config off and the '
                               'assistant falls back to scripted replies.',
                'tags': ['ai-config', 'swag-assistant', 'togglewear']},
     'variations': [
         {'ai_config_version_key': 'standard',
          'ai_model_config_key': _GPT,
          'ai_config_version_name': 'Standard',
          'description': 'OpenAI GPT-6 Luna with a short, to-the-point prompt. Everyone\'s '
                         'default.',
          # No temperature: Bedrock refuses the whole request if a GPT-6
          # model is sent one.
          'model': {'modelName': _GPT_ID,
                    'parameters': {'maxTokens': 300}},
          'messages': [{'role': 'system', 'content': (
              _SWAG_ASSISTANT_OPENING
              + "Keep every answer to one to three short sentences, and recommend at most two "
                "products. Write plain text with no markdown, headings or bullet points.\n\n"
              + _SWAG_ASSISTANT_GROUNDING)}]},
         {'ai_config_version_key': 'member-concierge',
          'ai_model_config_key': _SONNET,
          'ai_config_version_name': 'Member Concierge',
          'description': 'Claude Sonnet 4.6 with a fuller prompt that compares options and '
                         'explains fit. Served to Gold and Platinum members.',
          'model': {'modelName': _SONNET_ID,
                    'parameters': {'maxTokens': 900, 'temperature': 0.6}},
          'messages': [{'role': 'system', 'content': (
              _SWAG_ASSISTANT_OPENING
              + "Answer like a knowledgeable store concierge, in up to two short paragraphs. When "
                "the shopper is choosing, compare two or three options and say who each one "
                "suits. When size matters, use the size chart from get-product-details to "
                "recommend a size and explain the fit. When the shopper is a member, quote their "
                "member price and mention any perk that applies. Write plain text with no "
                "markdown, headings or bullet points, and separate paragraphs with a blank "
                "line.\n\n"
              + _SWAG_ASSISTANT_GROUNDING)}]}],
     'tools': ['search-products', 'get-product-details', 'get-member-perks', 'get-order-status'],
     'judges': [{'judgeConfigKey': 'togglewear-accuracy-judge', 'samplingRate': 1.0},
                {'judgeConfigKey': 'togglewear-relevance-judge', 'samplingRate': 1.0}],
     # The chat header reads this config's flag in the browser to show which
     # variation is serving, live.
     'client_side': True,
     'environment': 'production',
     'rules': [['member-concierge',
                [{'contextKind': 'user', 'attribute': 'segmentMatch', 'op': 'segmentMatch',
                  'negate': False, 'values': ['gold-members', 'platinum-members']}]]],
     'fallthrough': 'standard'},

    # ---- The Personal Stylist ----
    #
    # The note on every product page (pages/api/personal-stylist). Nobody
    # asks it anything: the prompt is filled in with the product and the
    # shopper's orders, and one call writes the note. Its two variations are
    # the same prompt on two models, which is a model upgrade, and a model
    # upgrade is what a guarded rollout is for. Everyone starts on Sonnet, and
    # the build starts a guarded rollout to Opus on the default rule that
    # results_generator.py walks to 100%, so a new environment already has a
    # finished one to show. An SE who wants to run one live puts the rule
    # back on Sonnet and uses the Personal Stylist generators in Cmd+K.
    {'config': {'config_key': 'personal-stylist',
                'config_name': 'Personal Stylist',
                'description': 'The "Your stylist\'s take" note on every product page: a size, how '
                               'it fits and what to wear it with, written for the shopper looking '
                               'at it from the product and their past orders. Two variations, '
                               'the same prompt on Claude Sonnet 4.6 (everyone today) and Claude '
                               'Opus 5.5 (the upgrade). The build already ran a guarded rollout '
                               'from Sonnet to Opus, finished at 100%, to show as it is. To run '
                               'one live: set the default rule back to Claude Sonnet 4.6, start '
                               'a guarded rollout to Claude Opus 5.5 with Accuracy, Relevance and '
                               'Completion error count as metrics and automatic rollback on, '
                               'then start a Personal Stylist generator in the Cmd+K panel. The '
                               'Succeeds one walks the rollout to 100%; the Rolls back one has '
                               'Opus\'s judge scores slip until LaunchDarkly rolls it back. The '
                               'model under each note says which one wrote it.',
                'tags': ['ai-config', 'personal-stylist', 'togglewear']},
     'variations': [
         {'ai_config_version_key': 'claude-sonnet-4-6',
          'ai_model_config_key': _SONNET,
          'ai_config_version_name': 'Claude Sonnet 4.6',
          'description': 'What every shopper gets today.',
          # No temperature on either model, so the rollout compares the
          # models alone: Bedrock refuses a request that sends Opus 5.5 one.
          'model': {'modelName': _SONNET_ID,
                    'parameters': {'maxTokens': 400}},
          'messages': _PERSONAL_STYLIST_MESSAGES},
         {'ai_config_version_key': 'claude-opus-5-5',
          'ai_model_config_key': _OPUS,
          'ai_config_version_name': 'Claude Opus 5.5',
          'description': 'The upgrade, released with a guarded rollout.',
          'model': {'modelName': _OPUS_ID,
                    'parameters': {'maxTokens': 400}},
          'messages': _PERSONAL_STYLIST_MESSAGES}],
     'judges': [{'judgeConfigKey': 'togglewear-accuracy-judge', 'samplingRate': 1.0},
                {'judgeConfigKey': 'togglewear-relevance-judge', 'samplingRate': 1.0}],
     'environment': 'production',
     'fallthrough': 'claude-sonnet-4-6',
     # Four even steps rather than LDPlatform's 1/5/10/25/50, which keeps Opus
     # on 1% for a fifth of the rollout, too few notes for the judge charts
     # to read as anything. Ten minutes in all, like flag 06's, so the build
     # waits no longer for it; the UI's shortest is an hour. Completion time
     # is not a metric because LaunchDarkly measures it per request, not per
     # user, and a guarded rollout's metrics have to share a context kind.
     'guarded_rollout': {'control': 'claude-sonnet-4-6',
                         'target': 'claude-opus-5-5',
                         'metrics': ['ld_autogen__ai-judge-accuracy',
                                     'ld_autogen__ai-judge-relevance',
                                     'ld_autogen__ai-completion-error'],
                         'stages': [{'allocation': 5000, 'durationMillis': 150000},
                                    {'allocation': 10000, 'durationMillis': 150000},
                                    {'allocation': 25000, 'durationMillis': 150000},
                                    {'allocation': 50000, 'durationMillis': 150000}]}},
]


# ---- The Order Review agents ----
#
# Six agent-mode AI Configs that review every order placed at checkout,
# joined up by the Order Review agent graph below and run by
# pages/api/order-review. Order Intake reads the order and hands it to three
# specialists, who work at the same time; the Decision agent weighs their
# findings and approves, holds or declines it; and the Case Note agent writes
# the note for the review team, only for an order that was not approved.
#
# The specialists' tools apply fixed rules (lib/orderReviewTools.ts), so the
# levers at checkout always land: a total over $250 or five of one item is
# held, ZIP 99999 is declined. What the models own is reading the facts and
# saying what they mean, and the Decision agent's thresholds, which are in its
# instructions so an SE can change them here and watch an ordinary order get
# held. The storefront refuses to approve a blocked ZIP whatever the agents
# say.
#
# Switching any one of them off switches the whole graph off, and checkout
# falls back to its scripted review.

# variation key, variation name, model ID
_AGENT_MODELS = {_HAIKU: ('claude-haiku-4-5', 'Claude Haiku 4.5', _HAIKU_ID),
                 _SONNET: ('claude-sonnet-4-6', 'Claude Sonnet 4.6', _SONNET_ID)}


# Temperature 0 because the same order should get the same review every time
# it is placed in a demo.
def _agent(key, name, description, model, max_tokens, instructions, tools=()):
    variation_key, variation_name, model_id = _AGENT_MODELS[model]
    return {'config': {'config_key': key,
                       'config_name': name,
                       'description': description,
                       'mode': 'agent',
                       'tags': ['ai-config', 'agent', 'order-review', 'togglewear']},
            'variations': [
                {'ai_config_version_key': variation_key,
                 'ai_model_config_key': model,
                 'ai_config_version_name': variation_name,
                 'description': 'Reviews every order today.',
                 'model': {'modelName': model_id,
                           'parameters': {'maxTokens': max_tokens, 'temperature': 0}},
                 'instructions': instructions}],
            'tools': list(tools),
            'environment': 'production',
            'fallthrough': variation_key}

_ORDER_REVIEW_OPENING = (
    "You are part of ToggleWear's Order Review team, a set of agents that checks every order "
    "placed in LaunchDarkly's merch store before it is charged. "
)

AGENT_CONFIGS = [
    _agent('order-intake-agent', 'Order Intake',
           'The first of the six Order Review agents. Reads the order with get-order-details and '
           'writes the short case summary the three specialists start from. Demo it: open the '
           'Order Review agent graph to see where it sits.',
           _HAIKU, 300,
           _ORDER_REVIEW_OPENING
           + "You take each new order first. Call get-order-details, then write a case summary "
             "of two or three sentences for the specialists who check it next: what was "
             "ordered, the total, the payment method, where it ships and whether a signed-in "
             "member or a guest placed it. State facts only; judging the risk is the "
             "specialists' job. Plain text, no markdown.",
           tools=['get-order-details']),
    _agent('payment-risk-agent', 'Payment Risk',
           'Order Review specialist. Checks the order\'s value and quantities with '
           'check-payment-risk. Demo it: put more than $250 in the cart, or five of one item, '
           'and this is the agent that flags it.',
           _HAIKU, 200,
           _ORDER_REVIEW_OPENING
           + "You are the payment risk specialist. Call check-payment-risk and report what it "
             "found in one or two sentences, giving each signal with its points. If it found "
             "nothing, say the value and quantities look like an ordinary order. Report the "
             "points exactly as the tool gives them. Plain text, no markdown.",
           tools=['check-payment-risk']),
    _agent('shipping-check-agent', 'Shipping Check',
           'Order Review specialist. Checks the shipping address with check-shipping-address. '
           'Demo it: change the ZIP code at checkout to 99999, a known reshipping address, and '
           'this is the agent that flags it.',
           _HAIKU, 200,
           _ORDER_REVIEW_OPENING
           + "You are the shipping specialist. Call check-shipping-address and report what it "
             "found in one or two sentences, giving the signal with its points. If it found "
             "nothing, say the address looks ordinary. Report the points exactly as the tool "
             "gives them. Plain text, no markdown.",
           tools=['check-shipping-address']),
    _agent('account-history-agent', 'Account History',
           'Order Review specialist. Compares the order with the account that placed it, using '
           'get-account-history. It adds context rather than risk points: a returning Gold '
           'member reads differently from a first-time guest.',
           _HAIKU, 200,
           _ORDER_REVIEW_OPENING
           + "You are the account history specialist. Call get-account-history and say in one "
             "or two sentences what the account tells the team about this order: how long "
             "they have been a customer, their tier, and how this order compares with their "
             "past ones. A guest has no history, which is ordinary in itself. You add context "
             "only and never add risk points. Plain text, no markdown.",
           tools=['get-account-history']),
    _agent('fraud-decision-agent', 'Order Decision',
           'Weighs the three specialists\' findings and approves, holds or declines the order, '
           'with the explanation the shopper sees at checkout. Demo it: lower the review '
           'threshold in these instructions from 40 to 30 and an ordinary order with any signal '
           'at all starts getting held, with no deploy.',
           _SONNET, 400,
           _ORDER_REVIEW_OPENING
           + "You make the call on each order once the three specialists have reported. Add "
             "up the risk points they report; the account history specialist adds none. Then "
             "apply these thresholds exactly, as strict rules, checking them in this order:\n"
             "- 70 points or more: decline\n"
             "- 40 points or more: review, which holds the order for a person on the team\n"
             "- under 40: approve\n\n"
             "The points alone decide. Nothing else about the order moves a decision either "
             "way: a loyal member, a familiar address, a long history or a small total never "
             "softens a decline into a review, and nothing makes an order under the thresholds "
             "look worse than its points.\n\n"
             "Record the decision with record_decision: the decision, the total points (at "
             "most 100) and a summary of one or two sentences to the shopper. The summary is "
             "shown to the shopper at checkout: "
             "say what happens to their order next, and for a held or declined order what "
             "caught it, in plain words, without naming the agents or the points. Nobody is "
             "charged for an order that is held or declined.\n\n"
             + _snippet('togglewear-brand-voice')),
    _agent('case-note-agent', 'Case Note',
           'The last Order Review agent, which only runs when an order is held or declined. '
           'Writes the note a person on the review team picks the order up from.',
           _HAIKU, 300,
           _ORDER_REVIEW_OPENING
           + "An order has just been held or declined, and you write the case note a person on "
             "the review team will pick it up from. In three or four sentences: the decision, "
             "each signal that drove it and its points, what the account history adds, and the "
             "one thing the reviewer should check first. Write for a colleague, not the "
             "shopper. Plain text, no markdown."),
]


# Agent graphs — LDPlatform.create_agent_graph, after AGENT_CONFIGS, since
# every node has to exist first. root is where a review starts; each edge
# is [key, source config, target config].
AGENT_GRAPHS = [
    {'graph_key': 'order-review',
     'graph_name': 'Order Review',
     'description': 'Reviews every order placed at checkout. Order Intake hands the order to '
                    'three specialists at once, Payment Risk, Shipping Check and Account '
                    'History; the Order Decision agent weighs their findings; and Case Note '
                    'writes up any order that was held or declined. Its Monitoring tab shows '
                    'each agent\'s speed, errors and handoffs, and how many orders took the '
                    'case note path.',
     'root': 'order-intake-agent',
     'edges': [['intake-to-payment', 'order-intake-agent', 'payment-risk-agent'],
               ['intake-to-shipping', 'order-intake-agent', 'shipping-check-agent'],
               ['intake-to-account', 'order-intake-agent', 'account-history-agent'],
               ['payment-to-decision', 'payment-risk-agent', 'fraud-decision-agent'],
               ['shipping-to-decision', 'shipping-check-agent', 'fraud-decision-agent'],
               ['account-to-decision', 'account-history-agent', 'fraud-decision-agent'],
               ['decision-to-case-note', 'fraud-decision-agent', 'case-note-agent']]},
]
