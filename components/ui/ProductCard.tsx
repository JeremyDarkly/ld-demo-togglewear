import Image from "next/image";
import Link from "next/link";
import {
  formatPrice,
  hoverImageFor,
  memberPriceUsd,
  type Product,
} from "@/lib/products";

// Figma "product-card" (19:1447) plus its "Item info" instance (19:1726).
// The image container is 305x440 in the design; the aspect ratio is kept so
// the card can narrow without distorting the photography.
//
// onDark inverts the text for the "recommended for you" row, which sits on
// full-bleed LD Black instead of inside a white panel.
//
// badge replaces the NEW tag with one of the section's own, such as the early
// access drop's. It is drawn black rather than lime so it reads as a
// different kind of label from NEW, and so it holds up on that section's lime.
export default function ProductCard({
  product,
  memberPricing = false,
  onDark = false,
  badge,
}: {
  product: Product;
  memberPricing?: boolean;
  onDark?: boolean;
  badge?: string;
}) {
  const { slug, name, priceUsd, description, image, isNew } = product;
  const hoverShot = hoverImageFor(product);

  const nameColor = onDark ? "text-grays-white" : "text-grays-ld-black";
  const priceColor = onDark ? "text-grays-white" : "text-grays-ld-black";
  const mutedColor = onDark ? "text-grays-03" : "text-grays-04";

  return (
    <article>
      <Link
        href={`/products/${slug}`}
        className="group flex flex-col gap-4 focus-visible:outline-none"
      >
        <div className="relative aspect-[305/440] w-full overflow-hidden rounded-[2px] bg-grays-02 group-focus-visible:ring-2 group-focus-visible:ring-base-lime group-focus-visible:ring-offset-2">
          {/* Both shots share one wrapper so the slow push-in applies to
              whichever is showing, and so the NEW badge below stays outside it
              and does not drift while the photo moves. */}
          <div className="absolute inset-0 transition-transform duration-500 ease-out group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100">
            <Image
              src={image}
              alt={name}
              fill
              sizes="(min-width: 1280px) 305px, (min-width: 1024px) 33vw, 50vw"
              className="object-cover"
            />

            {/* The second angle, stacked on top and faded in rather than
                swapped, so there is no blank frame while it loads. Decorative
                alt because the image above already names the product. */}
            {hoverShot && (
              <Image
                src={hoverShot}
                alt=""
                fill
                sizes="(min-width: 1280px) 305px, (min-width: 1024px) 33vw, 50vw"
                className="object-cover opacity-0 transition-opacity duration-300 ease-out group-hover:opacity-100 motion-reduce:transition-none"
              />
            )}
          </div>

          {badge ? (
            <span className="absolute left-4 top-4 rounded-[2px] border border-grays-ld-black bg-grays-ld-black px-2.5 py-1.5 font-geist text-[10px] font-semibold uppercase tracking-[1px] text-base-lime">
              {badge}
            </span>
          ) : isNew && (
            <span className="absolute left-4 top-4 rounded-[2px] border border-grays-ld-black bg-base-lime px-2.5 py-1.5 font-geist text-[10px] font-semibold uppercase tracking-[1px] text-grays-ld-black">
              New
            </span>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex w-full items-start justify-between gap-3 text-small">
            <p className={`min-w-0 flex-1 truncate font-sohne font-medium ${nameColor}`}>
              {name}
            </p>

            {memberPricing ? (
              // Figma 67:4719 — original struck through in Gray 04, member
              // price in Sohne Dreiviertelfett (700), 4px apart.
              <div className="flex shrink-0 items-center gap-1">
                <p className={`font-sohne line-through ${mutedColor}`}>
                  {formatPrice(priceUsd)}
                </p>
                <p className={`font-sohne font-bold ${priceColor}`}>
                  {formatPrice(memberPriceUsd(priceUsd))}
                </p>
              </div>
            ) : (
              <p className={`shrink-0 font-sohne ${priceColor}`}>
                {formatPrice(priceUsd)}
              </p>
            )}
          </div>
          <p className={`font-sohne text-xsmall ${mutedColor}`}>{description}</p>
        </div>
      </Link>
    </article>
  );
}
