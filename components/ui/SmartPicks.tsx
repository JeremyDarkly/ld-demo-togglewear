import { useEffect, useState } from "react";
import { useLDClient } from "launchdarkly-react-client-sdk";
import { LDObserve } from "@launchdarkly/observability";

import { useIncidents } from "@/components/ui/IncidentProvider";
import ProductCard from "@/components/ui/ProductCard";
import { apiHeaders } from "@/lib/api";
import { productsFor, type PricingVariant, type Product } from "@/lib/products";
import { type SmartSearchReply } from "@/lib/smartSearch";
import { type ServedBy } from "@/lib/swagAssistant";

// Long enough that typing a word is one call rather than one per letter.
const DEBOUNCE_MS = 600;
// "VR" is a real search, but one letter is not.
const MIN_QUERY_LENGTH = 2;

type Pick = { product: Product; reason?: string };

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; picks: Pick[]; servedBy: ServedBy }
  | { status: "failed" };

// Smart Search's row under the search panel's word-match results: up to
// three products that fit what the shopper meant, each with the model's
// reason. One AI Config call per pause in typing (pages/api/smart-search).
// With the config off, or nothing fitting, there is no row; a failure says
// so in one quiet line, because the failures are what the adaptive trigger
// counts and a demo should be able to see them land.
export default function SmartPicks({
  query,
  variant,
}: {
  query: string;
  variant: PricingVariant;
}) {
  const client = useLDClient();
  const { searchOutage } = useIncidents();
  const [state, setState] = useState<State>({ status: "idle" });
  const search = query.trim();

  useEffect(() => {
    if (!client || search.length < MIN_QUERY_LENGTH) {
      setState({ status: "idle" });
      return;
    }

    setState({ status: "loading" });
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch("/api/smart-search", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...apiHeaders(client) },
          body: JSON.stringify({ query: search, outage: searchOutage }),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`Smart search answered ${res.status}`);
        const { picks, servedBy } = (await res.json()) as SmartSearchReply;

        // The server picks from the same catalogue, so a slug missing here
        // is a shopper switch mid-request; the pick is dropped, not guessed.
        const catalogue = productsFor(variant);
        const shown = (picks ?? []).flatMap(({ slug, reason }) => {
          const product = catalogue.find((p) => p.slug === slug);
          return product ? [{ product, reason }] : [];
        });
        setState(
          shown.length > 0 && servedBy
            ? { status: "ready", picks: shown, servedBy }
            : { status: "idle" },
        );
      } catch (err) {
        if (controller.signal.aborted) return;
        LDObserve.recordError(err as Error, "Smart search request failed");
        setState({ status: "failed" });
      }
    }, DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [client, search, variant, searchOutage]);

  if (state.status === "idle") return null;

  return (
    <section
      aria-label="Picks for your search"
      aria-busy={state.status === "loading"}
      className="mt-12 flex flex-col gap-6 border-t border-grays-hairline pt-8"
    >
      <p className="font-geist text-[12px] font-semibold uppercase tracking-[1.2px] text-grays-ld-black">
        Picks for your search
      </p>

      {state.status === "loading" && (
        // Three cards' worth of placeholder, the most the row can hold, so
        // the panel does not jump when the picks arrive.
        <div
          className="grid animate-pulse grid-cols-2 gap-x-6 gap-y-12 lg:grid-cols-3 xl:grid-cols-4"
          aria-hidden="true"
        >
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex flex-col gap-3">
              <div className="aspect-square w-full rounded-[12px] bg-grays-01" />
              <div className="h-3 w-2/3 rounded-full bg-grays-01" />
            </div>
          ))}
        </div>
      )}

      {state.status === "failed" && (
        <p className="font-sohne text-small text-grays-04">
          Picks are unavailable right now.
        </p>
      )}

      {state.status === "ready" && (
        <>
          <div className="grid grid-cols-2 gap-x-6 gap-y-12 lg:grid-cols-3 xl:grid-cols-4">
            {state.picks.map(({ product, reason }) => (
              <div key={product.slug} className="flex flex-col gap-3">
                <ProductCard product={product} memberPricing={variant === "loyaltyGold"} />
                {reason && (
                  <p className="font-sohne text-small text-grays-04">{reason}</p>
                )}
              </div>
            ))}
          </div>
          {/* Which model chose them, which is how the adaptive trigger's
              switch to the fallback can be watched from the panel itself. */}
          <p className="font-sohne text-xsmall text-grays-03">{state.servedBy.model}</p>
        </>
      )}
    </section>
  );
}
