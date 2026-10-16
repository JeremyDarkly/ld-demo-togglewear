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

// About 30px a second at the desktop card width: slow enough to read a name
// and price as it passes, quick enough to be seen moving.
const SECONDS_PER_CARD = 9.5;

// The right padding stands in for a flex gap. A gap would leave no space
// after the last card, so the two copies would meet one gap short and the
// loop would hitch at the seam.
function CardSet({
  products,
  variant,
  className = "",
  duplicate = false,
}: {
  products: Product[];
  variant: PricingVariant;
  className?: string;
  duplicate?: boolean;
}) {
  return (
    <div
      className={`flex ${className}`}
      aria-hidden={duplicate || undefined}
      inert={duplicate || undefined}
    >
      {products.map((product) => (
        <div key={product.slug} className="w-[247px] shrink-0 pr-6 md:w-[284px]">
          <ProductCard
            product={product}
            memberPricing={variant === "loyaltyGold"}
            onDark
          />
        </div>
      ))}
    </div>
  );
}

// heading changes with flag 13: a fallback list of best sellers should not
// claim to be picked for you.
export default function RecommendedForYou({
  products,
  variant = "default",
  heading = "Recommended for you",
}: {
  products: Product[];
  variant?: PricingVariant;
  heading?: string;
}) {
  return (
    <section className="w-full bg-grays-ld-black">
      {/* Revealed as one piece rather than card by card like the best
          sellers grid: the row scrolls sideways, so cards off the right edge
          would otherwise rise into place in the middle of a swipe. */}
      <Reveal className="mx-auto max-w-[1440px] py-16 xl:py-[52px]">
        <header className="mb-8 flex items-end justify-between gap-6 px-6 md:px-10 xl:px-[52px]">
          <h2 className="font-sora text-[28px] font-semibold leading-[1.05] tracking-[-1.4px] text-grays-white md:text-h3">
            {heading}
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

        {/* A slow carousel that stops while the pointer or keyboard focus is
            on it, so nobody has to chase the card they are reading. The
            inset matches the header so the first card starts under the
            heading. With reduced motion it is the plain swipeable row. */}
        <div className="overflow-hidden pb-2 motion-reduce:overflow-x-auto">
          <div
            className="flex w-max animate-[marquee_1s_linear_infinite] pl-[var(--marquee-inset)] [--marquee-inset:24px] hover:[animation-play-state:paused] focus-within:[animation-play-state:paused] motion-reduce:animate-none md:[--marquee-inset:40px] xl:[--marquee-inset:52px]"
            style={{ animationDuration: `${products.length * SECONDS_PER_CARD}s` }}
          >
            <CardSet products={products} variant={variant} />
            {/* The copy that makes the loop seamless. Hidden from screen
                readers and the tab order so each product is only met once. */}
            <CardSet
              products={products}
              variant={variant}
              className="motion-reduce:hidden"
              duplicate
            />
          </div>
        </div>
      </Reveal>
    </section>
  );
}
