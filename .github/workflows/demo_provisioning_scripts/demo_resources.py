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
    # ---- 05 Live Inventory Service: healthy guarded release ----
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

    # ---- 06 Order Pipeline v2: failed guarded release ----
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
]

# Metric groups — funnels, passed to LDPlatform.create_metric_group(**spec)
METRIC_GROUPS = []

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
    # Gates the Swag Tier Status card on /account.  Exposure runs staff, then
    # testers, then a half-and-half rollout of everyone else.  Note that this
    # decides *whether* a shopper sees the card at all, while loyaltyTier
    # decides what the card then says — lib/shopper.ts keeps those two axes
    # separate on purpose, and this flag only touches the first one.
    #
    # Unlike core-demo, the segment rules live here in the table rather than in
    # a hand-written add_targeting_rules method, so the whole flag is one spec.
    {'flag': {'flag_key': 'swagTierProgram',
              'flag_name': '02 - Swag Tier Program - Targeting & Segmentation',
              'description': 'Shows the Swag Tier Status card on the account page. Released '
                             'to developers and beta testers first, then to half of all '
                             'other shoppers.',
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
    # The "Recommended for you" row on a product page — a new recommendation
    # engine being eased out rather than switched on, which is the realistic
    # shape for something that costs a call per page view.
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
    # The rollout starts at 1%, which is the point of the Beta Testers rule:
    # rules are evaluated before the default rule, so testers see the row
    # immediately while everyone else waits for the schedule. Without that rule
    # the feature would be invisible to everyone during a demo.
    {'flag': {'flag_key': 'swagRecommendations',
              'flag_name': '04 - Swag Recommendations - Progressive Rollout',
              'description': 'Shows the "Recommended for you" row on the product page. Beta '
                             'testers get it straight away; everyone else arrives through a '
                             'five-stage progressive rollout.',
              'variations': [{'value': True, 'name': 'Show Swag Recommendations'},
                             {'value': False, 'name': 'Hide Swag Recommendations'}],
              'tags': ['progressive-rollout', 'recommendations', 'togglewear'],
              'on_variation': 0},
     'post': [['add_segment_to_flag',
               ['swagRecommendations', 'beta-testers', 'production'],
               {}],
              ['add_progressive_rollout',
               ['swagRecommendations', 'production'],
               {'timeout': 432000000}]]},

    # ---- Capability 3: guarded releases, healthy and failed ----
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
              'flag_name': '05 - Live Inventory Service - Guarded Release (Healthy)',
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
              'flag_name': '06 - Order Pipeline v2 - Guarded Release (Failed)',
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
EXPERIMENTS = []
