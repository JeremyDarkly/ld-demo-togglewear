import { useEffect, useState } from "react";
import { useLDClient, type LDClient } from "launchdarkly-react-client-sdk";
import { LDObserve } from "@launchdarkly/observability";

import { useCart } from "./CartProvider";
import { apiHeaders } from "@/lib/api";
import {
  recoveryText,
  type CartRecoveryReply,
  type CartRecoveryRequest,
} from "@/lib/cartRecovery";

// Every page draws its own announcement bar, so the line is kept here by
// shopper and cart: moving to another page shows the same line at once
// instead of asking again and fading it back in.
const lines = new Map<string, string | null>();

export type CartRecovery =
  | { status: "loading" }
  | { status: "ready"; text: string }
  | { status: "none" };

// The Cart Recovery agent's line for the bar (pages/api/cart-recovery),
// asked for only while active, which is when flag 08 serves the cart
// reminder. "none" is the agent being off or failing, and the bar's own
// reminder stands in.
export function useCartRecovery(active: boolean): CartRecovery {
  const client = useLDClient();
  const { lines: cart } = useCart();
  const contextKey = (client?.getContext() as { key?: string } | undefined)?.key ?? "";
  const cacheKey = `${contextKey}|${cart
    .map((l) => `${l.slug}:${l.size}:${l.quantity}`)
    .sort()
    .join(",")}`;

  const [state, setState] = useState<CartRecovery>(() => fromCache(cacheKey));

  useEffect(() => {
    if (!active || !client || cart.length === 0) return;
    if (lines.has(cacheKey)) {
      setState(fromCache(cacheKey));
      return;
    }

    let cancelled = false;
    setState({ status: "loading" });

    async function load(ldClient: LDClient) {
      try {
        const res = await fetch("/api/cart-recovery", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...apiHeaders(ldClient) },
          body: JSON.stringify({ lines: cart } satisfies CartRecoveryRequest),
        });
        if (!res.ok) throw new Error(`Cart recovery answered ${res.status}`);
        const { recovery } = (await res.json()) as CartRecoveryReply;
        lines.set(cacheKey, recovery ? recoveryText(recovery) : null);
      } catch (err) {
        LDObserve.recordError(err as Error, "Cart recovery request failed");
        lines.set(cacheKey, null);
      }
      if (!cancelled) setState(fromCache(cacheKey));
    }

    load(client);
    return () => {
      cancelled = true;
    };
    // cacheKey stands for the cart and the shopper, which is what a new line
    // is written for.
  }, [active, client, cacheKey]);

  return state;
}

function fromCache(cacheKey: string): CartRecovery {
  if (!lines.has(cacheKey)) return { status: "loading" };
  const text = lines.get(cacheKey);
  return text ? { status: "ready", text } : { status: "none" };
}
