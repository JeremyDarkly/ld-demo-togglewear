import Link from "next/link";

import ProductCard from "@/components/ui/ProductCard";
import Reveal from "@/components/ui/Reveal";
import {
  categoryHref,
  type PricingVariant,
  type Product,
} from "@/lib/products";

// Figma "recommended for you" (63:3691). Like the quote break this sits
// directly on the full-bleed LD Black with no inset panel, so the card text
// inverts to white.
//
// Jen lets the row run off the right edge of the frame rather than wrapping,
// which is a horizontal scroller. The fifth card is deliberately clipped as
// an affordance that there is more to the right.
//
// This is where the recommendation agent plugs in — the third AgentControl
// surface. Until then the products are passed in.
export default function RecommendedForYou({
  products,
  variant = "default",
}: {
  products: Product[];
  variant?: PricingVariant;
}) {
  return (
    <section className="w-full bg-grays-ld-black">
      {/* Revealed as one piece rather than card by card like the best
          sellers grid: the row scrolls sideways, so cards off the right edge
          would otherwise rise into place in the middle of a swipe. */}
      <Reveal className="mx-auto max-w-[1440px] py-16 xl:py-[52px]">
        <header className="mb-8 flex items-end justify-between gap-6 px-6 md:px-10 xl:px-[52px]">
          <h2 className="font-sora text-[28px] font-semibold leading-[1.05] tracking-[-1.4px] text-grays-white md:text-h3">
            Recommended for you
          </h2>

          <Link
            href={categoryHref()}
            className="flex shrink-0 items-center gap-2 font-sohne text-small font-medium text-grays-white"
          >
            View All Swag
            <img
              src="/icons/arrow-link.svg"
              alt=""
              width={15.619}
              height={11.714}
              // The arrow asset is LD Black; inverting it to white costs less
              // than shipping a second copy of the same glyph.
              className="max-w-none brightness-0 invert"
            />
          </Link>
        </header>

        {/* Scroll padding matches the header inset so the first card lines up
            with the heading and the last one can still reach the edge. */}
        <div className="flex gap-6 overflow-x-auto px-6 pb-2 md:px-10 xl:px-[52px]">
          {products.map((product) => (
            <div key={product.slug} className="w-[223px] shrink-0 md:w-[260px]">
              <ProductCard
                product={product}
                memberPricing={variant === "loyaltyGold"}
                onDark
              />
            </div>
          ))}
        </div>
      </Reveal>
    </section>
  );
}
