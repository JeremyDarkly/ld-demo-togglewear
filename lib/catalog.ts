import { useEffect, useState } from "react";
import { useLDClient } from "launchdarkly-react-client-sdk";

// What the product page expects back from /api/catalog/[slug]. It was written
// against v1, where every product has at least one size, and nothing in the
// page has been told otherwise — which is the point of flag 05. The route's
// own type admits that v2 can send null here; this one does not.
export type LiveProduct = {
  slug: string;
  sizes: string[];
};

// Fetches the live part of a product once the LaunchDarkly client is up, so
// the request can carry the context the server needs to evaluate flag 05 the
// same way the browser would. Null until it arrives, and null for good if it
// fails, in which case the page keeps the sizes it was built with.
export function useLiveProduct(slug: string): LiveProduct | null {
  const client = useLDClient();
  const [live, setLive] = useState<LiveProduct | null>(null);

  useEffect(() => {
    setLive(null);
    if (!client) return;

    let cancelled = false;
    fetch(`/api/catalog/${encodeURIComponent(slug)}`, {
      headers: { "x-ld-context": JSON.stringify(client.getContext()) },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: LiveProduct | null) => {
        if (!cancelled && body) setLive(body);
      })
      .catch((err) => {
        console.warn(`Could not load live product data for ${slug}`, err);
      });

    return () => {
      cancelled = true;
    };
  }, [client, slug]);

  return live;
}
