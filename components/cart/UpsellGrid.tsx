import Image from "next/image";
import Link from "next/link";
import { useFlags } from "launchdarkly-react-client-sdk";
import { useCart } from "./CartProvider";
import { formatPrice, type Product } from "@/lib/products";
import { UPSELL_SETS, upsellsFor } from "@/lib/cart";
import { EVENTS, useTrack } from "@/lib/events";

// Figma "upsell-section" (70:1414). Unlike the panels above it, the heading
// sits outside any card and the three cards are their own bordered boxes.
//
// Which three products appear is flag 08's experiment: cheap add-ons, pricier
// picks or best sellers, each measured on what gets added from here and what
// the order comes to.

function UpsellCard({ product, set }: { product: Product; set: string }) {
  const { add } = useCart();
  const track = useTrack();

  return (
    <article className="flex flex-col gap-4 rounded-[2px] border border-grays-hairline bg-grays-white p-4">
      <Link
        href={`/products/${product.slug}`}
        // The well is 1.33:1 against a 0.7:1 photo, the widest mismatch on
        // the site, so contain keeps the product whole.
        className="relative block h-[180px] w-full overflow-hidden rounded-[2px] bg-grays-01"
      >
        <Image
          src={product.image}
          alt={product.name}
          fill
          sizes="(min-width: 1280px) 239px, 50vw"
          className="object-contain"
        />
      </Link>

      <div className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-2 font-sohne text-small">
          <p className="min-w-0 flex-1 truncate font-medium text-grays-ld-black">
            {product.name}
          </p>
          <p className="shrink-0 text-grays-ld-black">
            {formatPrice(product.priceUsd)}
          </p>
        </div>
        <p className="font-sohne text-xsmall text-grays-04">
          {product.description}
        </p>
      </div>

      <button
        type="button"
        onClick={() => {
          add(product.slug, product.defaultSize);
          const data = { slug: product.slug, set, source: "upsell" };
          track(EVENTS.addToCart, data);
          track(EVENTS.upsellAdded, data, product.priceUsd);
        }}
        className="w-full rounded-[2px] bg-grays-ld-black py-2.5 font-sohne text-small font-medium text-grays-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-grays-ld-black focus-visible:ring-offset-2"
      >
        Add to cart
      </button>
    </article>
  );
}

export default function UpsellGrid() {
  const { lines } = useCart();
  const { upsellPicks } = useFlags();
  // Jen's add-ons until flags load, and for any value the app does not know.
  const set =
    typeof upsellPicks === "string" && UPSELL_SETS[upsellPicks]
      ? upsellPicks
      : "add-ons";
  const products = upsellsFor(
    lines.map((line) => line.slug),
    UPSELL_SETS[set],
  );

  return (
    <section className="flex flex-col gap-[38px]">
      <h2 className="font-sohne text-h6 font-medium text-grays-ld-black">
        Complete your look.
      </h2>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {products.map((product) => (
          <UpsellCard key={product.slug} product={product} set={set} />
        ))}
      </div>
    </section>
  );
}
