import Image from "next/image";

import { formatMoney, type ResolvedLine } from "@/lib/cart";
import type { Product } from "@/lib/products";

// Figma "items-ordered-card" (75:1579). Roomier than the cart's rows —
// 80x100 thumbnails and the quantity on its own line — because nothing here
// is editable any more.
// The free gift, when the order earned one, ships as an item of its own.
export default function ShipmentItems({
  lines,
  gift,
}: {
  lines: ResolvedLine[];
  gift?: Product;
}) {
  return (
    <section className="flex flex-col gap-6 rounded-[2px] border border-grays-hairline bg-grays-white p-8">
      <h2 className="font-sohne text-h6 font-medium text-grays-ld-black">
        Items in Shipment
      </h2>

      <div className="flex flex-col">
        {lines.map((line) => (
          <div
            key={`${line.slug}__${line.size}`}
            className="flex items-center gap-6 border-b border-grays-hairline py-4 first:pt-0 last:border-b-0 last:pb-0"
          >
            {/* 80x100 against a 620x880 photo, so contain rather than cover —
                same reason as the product detail gallery. */}
            <div className="relative h-[100px] w-20 shrink-0 overflow-hidden rounded-[2px] bg-grays-hairline">
              <Image
                src={line.product.image}
                alt={line.product.name}
                fill
                sizes="80px"
                className="object-contain"
              />
            </div>

            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <p className="font-sohne text-main font-medium text-grays-ld-black">
                {line.product.name}
              </p>
              <p className="font-sohne text-small text-grays-04">
                {line.product.description} • Size: {line.size}
              </p>
              <p className="font-sohne text-xsmall text-grays-04">
                Quantity: {line.quantity}
              </p>
            </div>

            <p className="shrink-0 font-sohne text-main font-medium text-grays-ld-black">
              {formatMoney(line.product.priceUsd * line.quantity)}
            </p>
          </div>
        ))}

        {gift && (
          <div className="flex items-center gap-6 border-b border-grays-hairline py-4 first:pt-0 last:border-b-0 last:pb-0">
            <div className="relative h-[100px] w-20 shrink-0 overflow-hidden rounded-[2px] bg-grays-hairline">
              <Image
                src={gift.image}
                alt={gift.name}
                fill
                sizes="80px"
                className="object-contain"
              />
            </div>

            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <p className="font-sohne text-main font-medium text-grays-ld-black">
                {gift.name}
              </p>
              <p className="font-sohne text-small text-grays-04">
                {gift.description} • Free gift
              </p>
              <p className="font-sohne text-xsmall text-grays-04">
                Quantity: 1
              </p>
            </div>

            <p className="shrink-0 font-sohne text-main font-medium text-accent-purple">
              FREE
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
