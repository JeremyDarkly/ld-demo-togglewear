import Image from "next/image";
import Link from "next/link";
import { useFlags } from "launchdarkly-react-client-sdk";
import { useCart } from "./CartProvider";
import { formatPrice, productBySlug, type Product } from "@/lib/products";
import {
  earnsFreeGift,
  GIFT_SLUG,
  resolveLines,
  type ResolvedLine,
} from "@/lib/cart";

// Figma "cart-list" (70:1359). Jen's cart panels are white cards on a white
// page, so the hairline border is the only thing separating them.

function CartItemRow({ line }: { line: ResolvedLine }) {
  const { setQuantity, remove } = useCart();
  const { product, size, quantity } = line;

  return (
    <div className="flex items-center gap-6 border-b border-grays-hairline py-6 last:border-b-0 last:pb-0">
      {/* 110x140 against a 620x880 photo, so contain rather than cover —
          same reason as the product detail gallery. */}
      <div className="relative h-[140px] w-[110px] shrink-0 overflow-hidden rounded-[4px] bg-grays-hairline">
        <Image
          src={product.image}
          alt={product.name}
          fill
          sizes="110px"
          className="object-contain"
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex items-start justify-between gap-4 font-sohne text-main font-medium text-grays-ld-black">
          <Link
            href={`/products/${product.slug}`}
            className="min-w-0 truncate hover:underline"
          >
            {product.name}
          </Link>
          {/* The line total, which is what Jen drew since both her rows are
              quantity 1. List price, not the member price — the summary takes
              the loyalty discount off once, further down. */}
          <p className="shrink-0">
            {formatPrice(product.priceUsd * quantity)}
          </p>
        </div>

        <p className="font-sohne text-small text-grays-04">
          {product.description}
        </p>

        <div className="flex items-center gap-4">
          <p className="rounded-[2px] border border-grays-hairline px-2 py-1 font-sohne text-xsmall text-grays-ld-black">
            Size: <span className="font-semibold">{size}</span>
          </p>

          <div className="flex h-7 items-center gap-3 rounded-[2px] border border-grays-hairline px-2">
            <button
              type="button"
              aria-label={`Reduce ${product.name} quantity`}
              onClick={() => setQuantity(product.slug, size, quantity - 1)}
              className="font-sohne text-xsmall text-grays-04"
            >
              &mdash;
            </button>
            <span className="min-w-[1ch] text-center font-sohne text-small font-medium text-grays-ld-black">
              {quantity}
            </span>
            <button
              type="button"
              aria-label={`Increase ${product.name} quantity`}
              onClick={() => setQuantity(product.slug, size, quantity + 1)}
              className="font-sohne text-xsmall text-grays-04"
            >
              +
            </button>
          </div>
        </div>
      </div>

      <button
        type="button"
        aria-label={`Remove ${product.name}`}
        onClick={() => remove(product.slug, size)}
        className="shrink-0 p-2"
      >
        <img src="/icons/trash.svg" alt="" width={18} height={18} className="max-w-none" />
      </button>
    </div>
  );
}

// The sticker pack a deal adds, drawn like an item but with nothing to
// change: it comes and goes with the offer or code that earned it.
function GiftRow({ product }: { product: Product }) {
  return (
    <div className="flex items-center gap-6 border-b border-grays-hairline py-6 last:border-b-0 last:pb-0">
      <div className="relative h-[140px] w-[110px] shrink-0 overflow-hidden rounded-[4px] bg-grays-hairline">
        <Image
          src={product.image}
          alt={product.name}
          fill
          sizes="110px"
          className="object-contain"
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex items-start justify-between gap-4 font-sohne text-main font-medium text-grays-ld-black">
          <Link
            href={`/products/${product.slug}`}
            className="min-w-0 truncate hover:underline"
          >
            {product.name}
          </Link>
          <p className="shrink-0 text-accent-purple">FREE</p>
        </div>

        <p className="font-sohne text-small text-grays-04">
          {product.description}
        </p>

        <p className="self-start rounded-[2px] border border-accent-purple px-2 py-1 font-sohne text-xsmall font-medium text-accent-purple">
          Free gift
        </p>
      </div>
    </div>
  );
}

export default function CartList() {
  const { lines, count, promo } = useCart();
  const { announcementOffer } = useFlags();
  const resolved = resolveLines(lines);
  const gift = earnsFreeGift(resolved, promo, announcementOffer)
    ? productBySlug(GIFT_SLUG)
    : undefined;

  return (
    <section className="rounded-[2px] border border-grays-hairline bg-grays-white p-8">
      <header className="flex items-start justify-between gap-4 border-b border-grays-hairline pb-4">
        <h2 className="font-sohne text-large-medium font-medium text-grays-ld-black">
          Items in Cart ({count})
        </h2>
        <p className="shrink-0 font-sohne text-small text-grays-04">
          Free shipping active
        </p>
      </header>

      {resolved.length === 0 ? (
        // Jen drew no empty state, but removing both of her items reaches one.
        <div className="flex flex-col items-start gap-4 pt-8">
          <p className="font-sohne text-small text-grays-04">
            Your cart is empty.
          </p>
          <Link
            href="/"
            className="rounded-[2px] bg-grays-ld-black px-5 py-3 font-sohne text-small font-medium text-grays-white"
          >
            Browse the drop
          </Link>
        </div>
      ) : (
        <>
          {resolved.map((line) => (
            <CartItemRow key={`${line.slug}-${line.size}`} line={line} />
          ))}
          {gift && <GiftRow product={gift} />}
        </>
      )}
    </section>
  );
}
