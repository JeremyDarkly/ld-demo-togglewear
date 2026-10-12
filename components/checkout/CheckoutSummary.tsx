import Image from "next/image";
import { useFlags } from "launchdarkly-react-client-sdk";

import { useCart } from "@/components/cart/CartProvider";
import SummaryLines from "@/components/cart/SummaryLines";
import FraudReview from "./FraudReview";
import { formatPrice, type PricingVariant } from "@/lib/products";
import { cartTotals, resolveLines } from "@/lib/cart";
import type { FraudAssessment } from "@/lib/fraudAgent";

// Figma "summary-panel" (75:1471). Same panel as the cart's, with the item
// previews Jen adds here and Place Order in place of the promo code.
export default function CheckoutSummary({
  variant,
  assessing,
  assessment,
  orderRef,
}: {
  variant: PricingVariant;
  assessing: boolean;
  assessment: FraudAssessment | null;
  orderRef: string;
}) {
  const { lines, promo } = useCart();
  const { announcementOffer } = useFlags();
  const resolved = resolveLines(lines);
  const totals = cartTotals(resolved, variant, promo, announcementOffer);

  return (
    <section className="flex flex-col gap-6 rounded-[2px] border border-grays-hairline bg-grays-white p-8">
      <h2 className="font-sohne text-h6 font-medium text-grays-ld-black">
        Order Summary
      </h2>

      <div className="flex flex-col gap-4">
        {resolved.map((line) => (
          <div
            key={`${line.slug}__${line.size}`}
            className="flex items-center gap-4"
          >
            {/* 50x64 against a 620x880 photo, so contain rather than cover —
                same reason as the product detail gallery. */}
            <div className="relative h-16 w-[50px] shrink-0 overflow-hidden rounded-[2px] bg-grays-hairline">
              <Image
                src={line.product.image}
                alt={line.product.name}
                fill
                sizes="50px"
                className="object-contain"
              />
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <p className="truncate font-sohne text-small font-medium text-grays-ld-black">
                {line.product.name}
              </p>
              <p className="font-sohne text-xsmall text-grays-04">
                Size: {line.size} • Qty: {line.quantity}
              </p>
            </div>
            <p className="shrink-0 font-sohne text-small font-medium text-grays-ld-black">
              {formatPrice(line.product.priceUsd * line.quantity)}
            </p>
          </div>
        ))}
      </div>

      <div className="h-px w-full bg-grays-hairline" />

      <SummaryLines totals={totals} />

      {/* Hidden once a decision is in, so the same order cannot be placed
          twice by clicking through the result panel. */}
      {!assessment && (
        <button
          type="submit"
          disabled={assessing}
          className="w-full rounded-[2px] bg-accent-purple py-4 font-sohne text-large-medium font-medium text-grays-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-purple focus-visible:ring-offset-2 disabled:opacity-60"
        >
          {assessing ? "Reviewing your order…" : "Place Order"}
        </button>
      )}

      {assessment && <FraudReview assessment={assessment} orderRef={orderRef} />}
    </section>
  );
}
