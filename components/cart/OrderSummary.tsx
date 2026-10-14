import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useFlags } from "launchdarkly-react-client-sdk";

import { useCart } from "./CartProvider";
import SummaryLines from "./SummaryLines";
import { type PricingVariant } from "@/lib/products";
import {
  cartTotals,
  resolveLines,
  validatePromo,
  type PromoRejection,
} from "@/lib/cart";

// Said plainly rather than in red: a wrong code is not an error the shopper
// needs warning about, and the members-only case is good news told as a
// refusal.
const REJECTIONS: Record<PromoRejection, string> = {
  unknown: "That code is not recognised.",
  alreadyMember: "Member pricing is already applied — it beats this code.",
};

// Figma "summary-panel" (70:1448). The purple on the checkout button, the
// discount row and the FREE value is #A34FDE, which is not one of Jen's
// published colour variables — the cart is the only untokenized screen in her
// file. Kept as drawn pending her review.
//
// Only two things here are persona-driven: whether the discount row appears
// at all, and the figures it changes. The button is the same for everyone.
export default function OrderSummary({
  variant = "default",
}: {
  variant?: PricingVariant;
}) {
  const { lines, promo, applyPromo, removePromo } = useCart();
  const { announcementOffer } = useFlags();
  const totals = cartTotals(
    resolveLines(lines),
    variant,
    promo,
    announcementOffer,
  );

  const [draft, setDraft] = useState("");
  const [rejection, setRejection] = useState<PromoRejection | null>(null);

  function submitPromo(event: FormEvent) {
    event.preventDefault();
    const refused = validatePromo(draft, variant);
    setRejection(refused);
    if (refused) return;
    applyPromo(draft);
    setDraft("");
  }

  return (
    <section className="flex flex-col gap-6 rounded-[2px] border border-grays-hairline bg-grays-white p-8">
      <h2 className="font-sohne text-h6 font-medium text-grays-ld-black">
        Order Summary
      </h2>

      <SummaryLines totals={totals} />

      <div className="flex flex-col gap-2">
        <label
          htmlFor="cart-promo"
          className="font-sohne text-xsmall-caps font-medium uppercase text-grays-04"
        >
          Promo Code
        </label>

        {promo &&
        (totals.discountKind === "welcome" ||
          totals.discountKind === "comeback") ? (
          // The applied state replaces the field rather than sitting under
          // it, since there is nothing left to type. Remove is a word, not a
          // cross, for the same reason the search field's clear is.
          <div className="flex h-10 items-center justify-between gap-2 rounded-[4px] border border-grays-hairline px-3">
            <div className="flex min-w-0 items-center gap-2">
              <img
                src="/icons/check.svg"
                alt=""
                width={14}
                height={14}
                className="shrink-0 max-w-none"
              />
              <p className="min-w-0 truncate font-sohne text-small font-medium text-grays-ld-black">
                {promo}
              </p>
            </div>
            <button
              type="button"
              onClick={removePromo}
              className="shrink-0 font-sohne text-xsmall-caps font-medium uppercase text-grays-04 transition-colors hover:text-grays-ld-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-grays-ld-black"
            >
              Remove
            </button>
          </div>
        ) : (
          <form onSubmit={submitPromo} noValidate>
            <div className="flex h-10 items-center justify-between gap-2 rounded-[4px] border border-grays-hairline pl-3 pr-2 focus-within:border-grays-ld-black">
              <input
                id="cart-promo"
                value={draft}
                onChange={(event) => {
                  setDraft(event.target.value);
                  // The message is about the code that was submitted, so it
                  // stops being true the moment the code changes.
                  setRejection(null);
                }}
                placeholder="Enter code"
                className="min-w-0 flex-1 bg-transparent font-sohne text-small text-grays-ld-black placeholder:text-grays-04 focus-visible:outline-none"
              />
              <button
                type="submit"
                disabled={!draft.trim()}
                className="h-7 shrink-0 rounded-[2px] bg-grays-ld-black px-3 font-sohne text-xsmall-caps font-medium uppercase text-grays-white transition-opacity disabled:opacity-40"
              >
                Apply
              </button>
            </div>
          </form>
        )}

        {rejection && (
          <p role="status" className="font-sohne text-xsmall text-grays-04">
            {REJECTIONS[rejection]}
          </p>
        )}
      </div>

      <Link
        href="/checkout"
        className="w-full rounded-[2px] bg-accent-purple py-4 text-center font-sohne text-large-medium font-medium text-grays-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-purple focus-visible:ring-offset-2"
      >
        Continue to Checkout
      </Link>

      <div className="flex items-center justify-center gap-2">
        <img
          src="/icons/lock.svg"
          alt=""
          width={12}
          height={12}
          className="shrink-0 max-w-none"
        />
        <p className="font-sohne text-xsmall text-grays-04">
          Secure 256-bit SSL encrypted checkout
        </p>
      </div>
    </section>
  );
}
