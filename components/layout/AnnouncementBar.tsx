import { useEffect, useState } from "react";
import { useFlags } from "launchdarkly-react-client-sdk";
import {
  COMEBACK_CODE,
  COMEBACK_DISCOUNT,
  WELCOME_CODE,
  WELCOME_DISCOUNT,
} from "@/lib/products";

// Figma component set "announcement-bar" (67:4838), one variant per persona.
// Jen's variant is spelled "Cart abondon"; the key here is corrected.
export type AnnouncementPersona =
  | "default"
  | "cartAbandon"
  | "newCustomer"
  | "loyaltyGold";

// The bar's own variants: every persona's, plus offers that only flag 08
// serves. Kept apart from AnnouncementPersona so a bar-only offer does not
// become a persona everything else keyed on one has to handle.
type BarVariant = AnnouncementPersona | "freeStickers";

type Variant = {
  surface: string;
  message: string;
};

const VARIANTS: Record<BarVariant, Variant> = {
  default: {
    surface: "bg-base-lime text-grays-ld-black",
    message: "Free shipping on swag orders over $75 USD",
  },
  // Jen's line, with an incentive after it: the reminder only reaches someone
  // who came back to a cart from an earlier visit, and a small offer is what
  // stores actually send at that moment. Built from the constants like the
  // welcome offer, so the bar cannot promise a rate the cart does not give.
  cartAbandon: {
    surface: "bg-base-orange text-grays-ld-black",
    message: `Good taste doesn't ship itself! Take ${Math.round(
      COMEBACK_DISCOUNT * 100,
    )}% off with code ${COMEBACK_CODE}`,
  },
  newCustomer: {
    surface: "bg-base-cyan text-grays-ld-black",
    // Built from the constants rather than written out, so the bar cannot
    // promise a rate the cart does not give.
    message: `New customer, new perks: ${Math.round(
      WELCOME_DISCOUNT * 100,
    )}% off your first order. Use code ${WELCOME_CODE}`,
  },
  loyaltyGold: {
    surface: "bg-base-blue text-grays-white",
    message: "Loyalty status: activated. Enjoy early access and member-only pricing.",
  },
  // Not one of Jen's: the third arm of flag 08's experiment, a free gift
  // against her shipping and discount offers. Purple because it is the one
  // accent the bar has not used, and the cart's own accent besides.
  freeStickers: {
    surface: "bg-accent-purple text-grays-white",
    message: "Buy any 2 items, get a free sticker pack",
  },
};

// Flag 08's variation values, which are what LaunchDarkly shows, mapped onto
// the bar's variants. Spelled for the flag list rather than reusing the keys
// above, so whoever is reading the experiment sees the offer, not the persona
// it was first drawn for.
const BY_FLAG_VALUE: Record<string, BarVariant> = {
  "free-shipping": "default",
  "first-order-discount": "newCustomer",
  "free-sticker-pack": "freeStickers",
  "cart-reminder": "cartAbandon",
  "member-message": "loyaltyGold",
};

// Which bar to show is flag 08's call. Members get theirs by segment, a
// signed-in shopper who came back to a cart gets the reminder, and guests are
// the experiment. The persona passed in is only the fallback for the frame
// before flags load, or a project without the flag.
export default function AnnouncementBar({
  persona = "default",
}: {
  persona?: AnnouncementPersona;
}) {
  const { announcementOffer } = useFlags();
  const shown =
    (typeof announcementOffer === "string" && BY_FLAG_VALUE[announcementOffer]) ||
    persona;
  const { surface, message } = VARIANTS[shown];

  // The colour eases from one bar to the next, and the message is keyed on
  // the variant so a new one remounts and fades in over it.
  return (
    <div
      className={`flex w-full items-center justify-center px-6 py-[10px] transition-colors duration-500 ease-out motion-reduce:transition-none ${surface}`}
      data-persona={shown}
    >
      <BannerMessage key={shown} shown={shown} message={message} />
    </div>
  );
}

// The last bar shown, kept outside the component because every page mounts
// its own header: without it, each navigation would look like a change and
// replay the fade. Null until the first bar, so a fresh load does not fade.
let lastShown: BarVariant | null = null;

// Fades only when the bar really changed — the cart emptying, someone signing
// in — which is the moment a demo wants the audience to notice.
function BannerMessage({
  shown,
  message,
}: {
  shown: BarVariant;
  message: string;
}) {
  const [changed] = useState(() => lastShown !== null && lastShown !== shown);
  useEffect(() => {
    lastShown = shown;
  }, [shown]);

  return (
    <p
      className={`text-center font-sohne-mono text-xsmall-mono ${
        changed
          ? "animate-[banner-swap_500ms_ease-out] motion-reduce:animate-none"
          : ""
      }`}
    >
      {message}
    </p>
  );
}
