import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useLDClient, type LDClient } from "launchdarkly-react-client-sdk";
import { LDObserve } from "@launchdarkly/observability";

import { useCart } from "@/components/cart/CartProvider";
import ThumbButton from "@/components/ui/ThumbButton";
import { useShopper } from "@/components/ui/ShopperProvider";
import { apiHeaders } from "@/lib/api";
import { EVENTS, useTrack } from "@/lib/events";
import { contextFor } from "@/lib/ldContext";
import { type StylistNote as Note, type StylistReply } from "@/lib/personalStylist";
import {
  formatPrice,
  memberPriceUsd,
  productBySlug,
  type PricingVariant,
  type Product,
} from "@/lib/products";
import { type FeedbackKind } from "@/lib/swagAssistant";

// Switching shopper re-identifies the LaunchDarkly client after this has
// already rendered for the new one, so the note waits until the client's
// context is the shopper's. Asking any sooner would write the new shopper a
// note as the old one, and put them on the old one's side of a rollout.
const CONTEXT_WAIT_MS = 100;
const CONTEXT_WAIT_TRIES = 30;

function isContextFor(client: LDClient, expected: { key?: string; anonymous?: boolean }) {
  const current = client.getContext() as { key?: string; anonymous?: boolean } | undefined;
  if (!current) return false;
  return expected.key ? current.key === expected.key : Boolean(current.anonymous);
}

type State =
  | { status: "loading" }
  | { status: "ready"; note: Note; feedback?: FeedbackKind }
  | { status: "none" };

// The stylist's pairing, small enough to sit inside the note: the photo, the
// name through to its page, the shopper's price, and an add in its default
// size, which is the size the upsell cards add in too.
function Pairing({
  product,
  forSlug,
  member,
}: {
  product: Product;
  forSlug: string;
  member: boolean;
}) {
  const { add } = useCart();
  const track = useTrack();
  const [added, setAdded] = useState(false);

  return (
    <div className="flex items-center gap-3 rounded-[8px] bg-grays-white p-2">
      <Link
        href={`/products/${product.slug}`}
        className="relative block size-14 shrink-0 overflow-hidden rounded-[4px] bg-[#e5e8e8]"
      >
        <Image src={product.image} alt={product.name} fill sizes="56px" className="object-contain" />
      </Link>
      <div className="flex min-w-0 flex-1 flex-col">
        <Link
          href={`/products/${product.slug}`}
          className="truncate font-sohne text-small font-medium text-grays-ld-black hover:underline"
        >
          {product.name}
        </Link>
        <p className="font-sohne text-xsmall text-grays-04">
          {formatPrice(member ? memberPriceUsd(product.priceUsd) : product.priceUsd)}
        </p>
      </div>
      <button
        type="button"
        disabled={added}
        onClick={() => {
          add(product.slug, product.defaultSize);
          const data = { slug: product.slug, size: product.defaultSize, source: "stylist" };
          track(EVENTS.addToCart, data);
          track(EVENTS.stylistSuggestionAdded, { ...data, kind: "pairing", product: forSlug });
          setAdded(true);
        }}
        className="shrink-0 rounded-[2px] bg-grays-ld-black px-4 py-2 font-sohne text-xsmall font-medium text-grays-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-grays-ld-black focus-visible:ring-offset-2 disabled:bg-grays-02 disabled:text-grays-04"
      >
        {added ? "Added" : "Add"}
      </button>
    </div>
  );
}

// The Personal Stylist on a product page, written for whoever is looking:
// it picks their size, which the page selects (onSize), and one other
// product to go with it, shown here to add, with a short note on both. One
// AI Config call per shopper and product (pages/api/personal-stylist). With
// the config off, or the call failing, there is simply no card; a product
// page was complete without one.
export default function StylistNote({
  slug,
  variant,
  onSize,
}: {
  slug: string;
  variant: PricingVariant;
  onSize?: (size: string) => void;
}) {
  const client = useLDClient();
  const { person, role } = useShopper();
  const [state, setState] = useState<State>({ status: "loading" });
  // The latest callback, so the page can pass a new one each render without
  // the note being asked for again.
  const onSizeRef = useRef(onSize);
  onSizeRef.current = onSize;

  useEffect(() => {
    setState({ status: "loading" });
    if (!client) return;

    let cancelled = false;
    const expected = contextFor(person, role) as { key?: string; anonymous?: boolean };

    async function load(ldClient: LDClient) {
      for (let i = 0; i < CONTEXT_WAIT_TRIES && !isContextFor(ldClient, expected); i += 1) {
        await new Promise((resolve) => setTimeout(resolve, CONTEXT_WAIT_MS));
        if (cancelled) return;
      }
      try {
        const res = await fetch("/api/personal-stylist", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...apiHeaders(ldClient) },
          body: JSON.stringify({ slug }),
        });
        if (!res.ok) throw new Error(`Personal stylist answered ${res.status}`);
        const { note } = (await res.json()) as StylistReply;
        if (cancelled) return;
        setState(note ? { status: "ready", note } : { status: "none" });
        if (note?.size) onSizeRef.current?.(note.size);
      } catch (err) {
        LDObserve.recordError(err as Error, "Personal stylist request failed");
        if (!cancelled) setState({ status: "none" });
      }
    }

    load(client);
    return () => {
      cancelled = true;
    };
  }, [client, slug, person, role]);

  function rate(kind: FeedbackKind) {
    if (state.status !== "ready" || state.feedback || !client) return;
    setState({ ...state, feedback: kind });
    fetch("/api/personal-stylist/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...apiHeaders(client) },
      body: JSON.stringify({ replyId: state.note.replyId, kind }),
    }).catch((err: Error) => LDObserve.recordError(err, "Personal stylist feedback failed"));
  }

  if (state.status === "none") return null;

  const pairing =
    state.status === "ready" && state.note.pairing ? productBySlug(state.note.pairing) : undefined;

  return (
    <section
      aria-label="Your stylist's take"
      aria-busy={state.status === "loading"}
      className="flex flex-col gap-3 rounded-[12px] bg-grays-01 p-5"
    >
      <p className="font-geist text-[12px] font-semibold uppercase tracking-[1.2px] text-grays-ld-black">
        Your stylist&apos;s take
      </p>

      {state.status === "loading" ? (
        // Three lines' worth of placeholder, about what a note runs to, and
        // the pairing's row, so the buttons below do not jump when it
        // arrives. A stronger model can take several seconds.
        <div className="flex animate-pulse flex-col gap-2" aria-hidden="true">
          <div className="h-3 w-full rounded-full bg-grays-02" />
          <div className="h-3 w-11/12 rounded-full bg-grays-02" />
          <div className="h-3 w-2/3 rounded-full bg-grays-02" />
          <div className="mt-1 h-[72px] w-full rounded-[8px] bg-grays-02" />
        </div>
      ) : (
        <>
          <p className="font-sohne text-small text-grays-ld-black">{state.note.text}</p>
          {pairing && (
            <Pairing product={pairing} forSlug={slug} member={variant === "loyaltyGold"} />
          )}
          {/* Which model wrote it, which is how a guarded rollout from one
              model to the other can be watched from the page itself. */}
          <div className="flex items-center gap-2 font-sohne text-xsmall text-grays-03">
            <span>{state.note.servedBy.model}</span>
            <span className="flex items-center gap-0.5">
              {(["positive", "negative"] as const).map((kind) => (
                <ThumbButton
                  key={kind}
                  kind={kind}
                  chosen={state.feedback === kind}
                  disabled={Boolean(state.feedback)}
                  onClick={() => rate(kind)}
                />
              ))}
            </span>
          </div>
        </>
      )}
    </section>
  );
}
