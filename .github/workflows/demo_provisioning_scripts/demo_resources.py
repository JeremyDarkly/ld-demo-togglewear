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

    # ---- 07 to 09: the experiments ----
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
                           'Its own event so flag 08 can tell these apart from any other add.',
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

    # ---- 12 Recommendation Engine: adaptive trigger ----
    #
    # What flag 12's adaptive trigger watches. A running total rather than a
    # conversion: a conversion counts each shopper once, so one person
    # clicking through a demo could never cross a threshold of more than a
    # few. The storefront sends 1 per failed row (lib/events.ts).
    {'metric_key': 'recommendations-failed',
     'metric_name': 'Recommendations Failed',
     'event_key': 'recommendations-failed',
     'metric_description': 'The personalized "Recommended for you" row failed to load. Flag '
                           '12\'s adaptive trigger switches to best sellers when this climbs.',
     'numeric': True,
     'unit': 'failures',
     'success_criteria': 'LowerThanBaseline',
     'unit_aggregation_type': 'sum',
     'tags': ['adaptive-trigger', 'recommendations', 'togglewear']},
]

# Metric groups — funnels, passed to LDPlatform.create_metric_group(**spec)
#
# The four steps of a purchase, in order. Flag 09's experiment reads it as its
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
    # The rollout starts at 1%, which is the point of the segment rules: rules
    # are evaluated before the default rule, so beta testers and Gold and
    # Platinum members see the row immediately while everyone else waits for
    # the schedule. Without them the feature would be invisible to everyone
    # during a demo.
    {'flag': {'flag_key': 'swagRecommendations',
              'flag_name': '04 - Swag Recommendations - Progressive Rollout',
              'description': 'Shows the "Recommended for you" row on the product page. Beta '
                             'testers and Gold and Platinum members get it straight away; '
                             'everyone else arrives through a five-stage progressive rollout.',
              'variations': [{'value': True, 'name': 'Show Swag Recommendations'},
                             {'value': False, 'name': 'Hide Swag Recommendations'}],
              'tags': ['progressive-rollout', 'recommendations', 'togglewear'],
              'on_variation': 0},
     'post': [['add_segment_to_flag',
               ['swagRecommendations', 'beta-testers', 'production'],
               {}],
              ['add_segment_to_flag',
               ['swagRecommendations', 'gold-members', 'production'],
               {}],
              ['add_segment_to_flag',
               ['swagRecommendations', 'platinum-members', 'production'],
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

    # ---- Capability 4: experimentation ----
    #
    # Three experiments, one of each kind a retail team runs most: an offer,
    # a merchandising choice and a checkout change. Each flag is created off
    # with no rollout; EXPERIMENTS below turns it on and the experiment takes
    # over its default rule. The first variation is the control in each.

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
              'flag_name': '07 - Announcement Banner Offer - Feature Experiment',
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
              'flag_name': '08 - Complete Your Look Picks - Feature Experiment',
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
              'flag_name': '09 - Express Checkout - Funnel Experiment',
              'description': 'Adds one-tap PayPal and Apple Pay buttons above the checkout '
                             'form. Measured on the whole purchase funnel, from product view '
                             'to placed order.',
              'variations': [{'value': False, 'name': 'Current Checkout'},
                             {'value': True, 'name': 'Express Checkout'}],
              'tags': ['experiment', 'checkout', 'togglewear'],
              'on_variation': 0,
              'off_variation': 0},
     'post': []},

    # ---- Capability 5: kill switches ----
    #
    # Flags that an observability alert flips through a flag trigger, with no
    # one in the loop. ToggleWear's versions of core-demo's A9 and A10: one
    # turns a risky change off when it breaks, the other turns a protection
    # on when an attack starts.
    #
    # The chain is storefront error -> observability alert -> trigger URL ->
    # flag. DemoBuilder creates the flag and its trigger; the alert is still
    # made by hand, because LaunchDarkly has no public API for creating
    # alerts. Its webhook notification is the trigger URL, which is a secret,
    # shown once at creation and never printed here — reset the trigger in
    # the flag's settings to get a fresh one.
    #
    # The errors come from the storefront through the observability plugin
    # (LaunchDarklyProvider.tsx), staged from the account menu's "Simulate an
    # incident" controls (IncidentProvider.tsx).

    # On, serving the new processor. During a staged payment outage every
    # approved order fails with a PaymentProcessorError; an alert on those
    # (say, more than 3 in 5 minutes) calls the trigger, the flag turns off,
    # and off serves the current processor, so the next order goes through.
    {'flag': {'flag_key': 'newPaymentProcessor',
              'flag_name': '10 - New Payment Processor - Kill Switch',
              'description': 'Charges orders through the new payment processor. A trigger turns '
                             'it off, back to the current processor, when an observability alert '
                             'on PaymentProcessorError fires.',
              'variations': [{'value': True, 'name': 'Use New Payment Processor'},
                             {'value': False, 'name': 'Use Current Payment Processor'}],
              'tags': ['kill-switch', 'trigger', 'checkout', 'togglewear'],
              'on_variation': 0,
              'off_variation': 1},
     'post': [['create_flag_trigger',
               ['newPaymentProcessor', 'production'],
               {'action': 'turnFlagOff',
                'comment': 'Created by DemoBuilder. Called by the observability alert on '
                           'PaymentProcessorError to fall back to the current processor.'}],
              ['toggle_flag',
               ['newPaymentProcessor', 'on', 'production'],
               {}]]},

    # Off, so checkout is the usual one. A staged card-testing attack sends
    # fifteen CardDeclinedErrors in six seconds; an alert on those (say, more
    # than 10 in a minute) calls the trigger, the flag turns on, and card
    # payments ask for a texted code before the order is placed. Turning it
    # back off once the attack is over is a person's call, which is realistic.
    {'flag': {'flag_key': 'cardTestingProtection',
              'flag_name': '11 - Card Testing Protection - Kill Switch',
              'description': 'Asks for a texted verification code before a card payment. A '
                             'trigger turns it on when an observability alert on CardDeclinedError '
                             'fires, the signature of bots testing stolen cards.',
              'variations': [{'value': True, 'name': 'Require Card Verification'},
                             {'value': False, 'name': 'Standard Checkout'}],
              'tags': ['kill-switch', 'trigger', 'checkout', 'fraud', 'togglewear'],
              'on_variation': 0,
              'off_variation': 1},
     'post': [['create_flag_trigger',
               ['cardTestingProtection', 'production'],
               {'action': 'turnFlagOn',
                'comment': 'Created by DemoBuilder. Called by the observability alert on '
                           'CardDeclinedError to require card verification.'}]]},

    # ---- Capability 6: adaptive triggers ----
    #
    # A kill switch turns a flag off or on; an adaptive trigger switches a rule
    # to a different variation, and it watches a LaunchDarkly metric itself
    # rather than waiting for an alert to call it.
    #
    # On, serving personalized picks. During a staged recommendations outage
    # the row fails to load and the storefront sends recommendations-failed;
    # the trigger on the default rule (say, above 3 in 5 minutes) switches it
    # to best sellers, a static list with nothing to fail.
    #
    # The trigger itself is added by hand on the default rule, for the same
    # reason as the kill switches' alerts: the adaptive triggers API needs the
    # ID of an alert, and alerts cannot be created through the public API.
    # Adaptive triggers do not switch back on their own either, so restoring
    # personalized picks after a demo is done by hand too.
    {'flag': {'flag_key': 'recommendationEngine',
              'flag_name': '12 - Recommendation Engine - Adaptive Trigger',
              'description': 'What fills the "Recommended for you" row: personalized picks from '
                             'the recommendation service, or best sellers. An adaptive trigger on '
                             'Recommendations Failed falls back to best sellers.',
              'variations': [{'value': 'personalized', 'name': 'Personalized Picks'},
                             {'value': 'best-sellers', 'name': 'Best Sellers'}],
              'tags': ['adaptive-trigger', 'recommendations', 'togglewear'],
              'on_variation': 0,
              'off_variation': 1},
     'post': [['toggle_flag',
               ['recommendationEngine', 'on', 'production'],
               {}]]},
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
# All three are started, so results_generator.py's traffic lands in a running
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
]
