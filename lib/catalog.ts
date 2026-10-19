import { useEffect, useState } from "react";
import { useLDClient } from "launchdarkly-react-client-sdk";
import { LDObserve } from "@launchdarkly/observability";
import { apiHeaders } from "@/lib/api";
import type { SizeChart } from "@/lib/sizeGuide";

// What the product page expects back from /api/catalog/[slug]. It was written
// against v1, where every product has at least one size, the size chart has
// columns and the SKUs are keyed by the sizes the picker shows, and nothing in
// the page has been told otherwise — which is the point of flag 05. The
// route's own type admits what v2 sends instead; this one does not.
export type LiveProduct = {
  slug: string;
  sizes: string[];
  sizeChart: SizeChart | null;
  skus: Record<string, string>;
};

export type LiveProductState = {
  // Null until it arrives, and null for good if it fails, in which case the
  // page keeps the sizes it was built with.
  live: LiveProduct | null;
  // The catalog gave up waiting on something behind it. Unlike any other
  // failure, the page cannot carry on with what it was built with, because
  // it has no way to know what is still on sale.
  timedOut: boolean;
};

// Fetches the live part of a product once the LaunchDarkly client is up, so
// the request can carry the context the server needs to evaluate flag 05 the
// same way the browser would.
export function useLiveProduct(slug: string): LiveProductState {
  const client = useLDClient();
  const [state, setState] = useState<LiveProductState>({ live: null, timedOut: false });

  useEffect(() => {
    setState({ live: null, timedOut: false });
    if (!client) return;

    let cancelled = false;
    fetch(`/api/catalog/${encodeURIComponent(slug)}`, {
      headers: apiHeaders(client),
    })
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 504) {
          setState({ live: null, timedOut: true });
          return;
        }
        if (res.ok) setState({ live: (await res.json()) as LiveProduct, timedOut: false });
      })
      .catch((err) => {
        console.warn(`Could not load live product data for ${slug}`, err);
      });

    return () => {
      cancelled = true;
    };
  }, [client, slug]);

  return state;
}

// The product page's corner badge, from /api/stock/[slug]. Undefined while it
// loads, so the page shows the badge it was built with until then.
//
// Written against v1, which only ever answered with JSON, so it parses
// whatever comes back without looking at the status first. Under flag 05's v2
// that is an HTML error page, and the parse is what throws.
export function useStockBadge(slug: string): string | undefined {
  const client = useLDClient();
  const [badge, setBadge] = useState<string | undefined>(undefined);

  useEffect(() => {
    setBadge(undefined);
    if (!client) return;

    let cancelled = false;
    fetch(`/api/stock/${encodeURIComponent(slug)}`, {
      headers: apiHeaders(client),
    })
      .then((res) => res.json() as Promise<{ badge: string }>)
      .then((body) => {
        if (!cancelled) setBadge(body.badge);
      })
      .catch((err: Error) => {
        LDObserve.recordError(err, "Stock lookup failed", { "product.slug": slug });
        if (!cancelled) setBadge("Stock unavailable");
      });

    return () => {
      cancelled = true;
    };
  }, [client, slug]);

  return badge;
}
