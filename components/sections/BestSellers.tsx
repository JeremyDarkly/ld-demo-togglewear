import Link from "next/link";

import SectionPanel from "@/components/layout/SectionPanel";
import ProductCard from "@/components/ui/ProductCard";
import Reveal from "@/components/ui/Reveal";
import {
  bestSellersFor,
  categoryHref,
  type PricingVariant,
} from "@/lib/products";

// Figma "item block" (63:3644 default, 67:4402 loyalty). Inside the panel the
// design uses 64px side padding, 75px top, 100px bottom, a 48px gap below the
// header, and a 4-column grid of 305px cards with 24px gutters
// (4*305 + 3*24 = 1292).
//
// Jen splits the eight cards across two frames with 48px between them; they
// render as one grid. The two variants differ only in card order and in
// whether member pricing is shown.
export default function BestSellers({
  variant = "default",
}: {
  variant?: PricingVariant;
}) {
  const products = bestSellersFor(variant);

  return (
    <SectionPanel>
      <div className="px-6 pb-16 pt-12 md:px-10 md:pb-20 md:pt-16 xl:px-16 xl:pb-[100px] xl:pt-[75px]">
        <Reveal className="mb-12">
          <header className="flex items-end justify-between gap-6">
            <h2 className="font-sora text-h3 font-semibold text-grays-ld-black">
              Best sellers
            </h2>

            <Link
              href={categoryHref()}
              className="flex shrink-0 items-center gap-2 font-sohne text-small font-medium text-grays-ld-black"
            >
              View All Swag
              <img
                src="/icons/arrow-link.svg"
                alt=""
                width={15.619}
                height={11.714}
                className="max-w-none"
              />
            </Link>
          </header>
        </Reveal>

        <div className="grid grid-cols-2 gap-x-6 gap-y-12 lg:grid-cols-3 xl:grid-cols-4">
          {/* Staggered across a row of four, the widest the grid gets. On
              narrower rows the delays repeat out of step with the columns,
              which at 80ms apart reads as the same ripple. */}
          {products.map((product, index) => (
            <Reveal key={product.slug} delay={(index % 4) * 80}>
              <ProductCard
                product={product}
                memberPricing={variant === "loyaltyGold"}
              />
            </Reveal>
          ))}
        </div>
      </div>
    </SectionPanel>
  );
}
