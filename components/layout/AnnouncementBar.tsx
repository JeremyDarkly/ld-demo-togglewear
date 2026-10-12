import { useFlags } from "launchdarkly-react-client-sdk";
import { WELCOME_CODE, WELCOME_DISCOUNT } from "@/lib/products";

// Figma component set "announcement-bar" (67:4838), one variant per persona.
// Jen's variant is spelled "Cart abondon"; the key here is corrected.
export type AnnouncementPersona =
  | "default"
  | "cartAbandon"
  | "newCustomer"
  | "loyaltyGold";

// The bar's own variants: every persona's, plus offers that only flag 07
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
  cartAbandon: {
    surface: "bg-base-orange text-grays-ld-black",
    message: "Good taste doesn't ship itself! Finish checking out.",
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
  // Not one of Jen's: the third arm of flag 07's experiment, a free gift
  // against her shipping and discount offers. Purple because it is the one
  // accent the bar has not used, and the cart's own accent besides.
  freeStickers: {
    surface: "bg-accent-purple text-grays-white",
    message: "Buy any 2 items, get a free sticker pack",
  },
};

// Flag 07's variation values, which are what LaunchDarkly shows, mapped onto
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

// Which bar to show is flag 07's call. Members get theirs by segment, a
// signed-in shopper with items in the cart gets the reminder, and guests are
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

  return (
    <div
      className={`flex w-full items-center justify-center px-6 py-[10px] ${surface}`}
      data-persona={shown}
    >
      <p className="text-center font-sohne-mono text-xsmall-mono">{message}</p>
    </div>
  );
}
