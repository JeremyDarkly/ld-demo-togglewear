import { useCallback } from "react";
import { useLDClient } from "launchdarkly-react-client-sdk";

// What a shopper does, as LaunchDarkly custom events. These are what
// experiment metrics count: a metric is created against an event key, so the
// keys here have to match the event_key of the metrics in demo_resources.py,
// and the ones results_generator.py sends to fill in experiment results.
//
// One event per action rather than one per page: "added to cart" is the same
// action whichever page it happens on, and an experiment wants to count it
// once however the shopper got there.
export const EVENTS = {
  productViewed: "product-viewed",
  addToCart: "add-to-cart",
  // The exception to one event per action, because flag 09's experiment has
  // to tell an add from its own three slots apart from any other add, and a
  // metric counts an event key, not what the event's data says. An add from
  // the slots sends both this and add-to-cart, so the funnel still sees it.
  upsellAdded: "upsell-added",
  checkoutStarted: "checkout-started",
  // Carries the order total as its metric value, so a metric can measure
  // revenue per visitor rather than only whether an order happened.
  orderPlaced: "order-placed",
  // Not a shopper action but the recommendation service failing them. Flag
  // 13's adaptive trigger counts it, and a trigger can watch a custom metric
  // directly, which is why this one is an event and not an observability
  // error like the kill switches'.
  recommendationsFailed: "recommendations-failed",
} as const;

export type ShopperEvent = (typeof EVENTS)[keyof typeof EVENTS];

// Returns whether the event was handed to the client. The client is built
// after the first paint, so on a page someone lands on directly it can be
// missing for a moment; callers that fire on arrival use the answer to try
// again once it is there, rather than losing the event or sending it twice.
export function useTrack() {
  const client = useLDClient();

  return useCallback(
    (event: ShopperEvent, data?: Record<string, unknown>, value?: number) => {
      if (!client) return false;
      client.track(event, data, value);
      return true;
    },
    [client],
  );
}
