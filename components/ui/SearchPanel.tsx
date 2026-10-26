import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";

import ProductCard from "@/components/ui/ProductCard";
import SmartPicks from "@/components/ui/SmartPicks";
import { useDialog } from "@/components/ui/useDialog";
import { categoryHref, type PricingVariant } from "@/lib/products";
import { searchProducts } from "@/lib/search";

// Jen designed no search screen, so this is assembled from pieces she did
// design: the field drops out from under the header the way the mobile menu
// panel does, carrying the nav bar's own black and its 1440px gutters so it
// reads as part of the header rather than a window floating over the page.
// The results use the best sellers grid and card.
//
// It renders inside <header>, positioned against it, which is why the header
// is the thing that carries `relative`. Absolute rather than in the flow
// because the result grid can be tall and shoving the page down to make room
// would be worse than covering it.
export default function SearchPanel({
  variant,
  onClose,
}: {
  variant: PricingVariant;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useDialog(onClose);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const results = searchProducts(variant, query);
  const searching = query.trim().length > 0;

  return (
    <>
      {/* Dims the page but not the header, which is what keeps the panel
          looking attached rather than laid over the top. Portaled to the body
          so it lands outside the header's stacking context — rendered inside
          it, it would paint over the very bar it is meant to leave lit.
          45 sits above the chat launcher's 40 and below the persona
          switcher's 50, which has to stay reachable during a demo. */}
      {createPortal(
        <div
          onClick={onClose}
          aria-hidden
          className="animate-fade-in fixed inset-y-0 left-0 right-[var(--hood-width)] z-[45] bg-grays-ld-black/50"
        />,
        document.body,
      )}

      {/* No z-index: this is a child of the header, which carries z-50, so
          the whole panel is already above the dim and the page. */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search swag"
        className="animate-drop-in absolute inset-x-0 top-full"
      >
        {/* The nav bar's own black, divided by the same hairline the mobile
            menu panel uses, so the field looks like a continuation of the
            header rather than a thing sitting on top of it. */}
        <div className="w-full border-t border-grays-04 bg-grays-black-01">
          <div className="mx-auto flex h-16 max-w-[1440px] items-center gap-3 px-6 md:px-10 xl:px-16">
            <img
              src="/icons/magnify.svg"
              alt=""
              width={17}
              height={17}
              // The glyph ships in LD Black for use on white; inverting it
              // costs less than a second copy of the same icon.
              className="shrink-0 max-w-none brightness-0 invert"
            />

            <input
              ref={inputRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search swag"
              aria-label="Search swag"
              className="min-w-0 flex-1 bg-transparent font-sohne text-main text-grays-white placeholder:text-grays-03 focus-visible:outline-none"
            />

            {/* A word rather than a second glyph. Chrome's native clear
                button is suppressed in globals.css precisely because an X
                here next to an X there reads as one control drawn twice. */}
            {searching && (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  inputRef.current?.focus();
                }}
                className="shrink-0 font-sohne text-xsmall-caps font-medium uppercase text-grays-03 transition-colors hover:text-grays-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-grays-white"
              >
                Clear
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              aria-label="Close search"
              className="shrink-0 border-l border-grays-04 pl-3 text-grays-03 transition-colors hover:text-grays-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-grays-white"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                <path
                  d="M4 4l8 8M12 4l-8 8"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  fill="none"
                />
              </svg>
            </button>
          </div>
        </div>

        {/* Only once something has been typed, so opening search does not
            drop an empty white slab over the page. */}
        {searching && (
          <div className="w-full bg-grays-white shadow-[0_12px_24px_rgba(0,0,0,0.12)]">
            {/* The page behind cannot scroll while this is open, so the
                results scroll within themselves. */}
            <div className="mx-auto max-h-[70vh] max-w-[1440px] overflow-y-auto px-6 py-8 md:px-10 xl:px-16">
              {results.length > 0 ? (
                <>
                  <p className="mb-8 font-sohne text-small text-grays-04">
                    {results.length === 1 ? "1 item" : `${results.length} items`}
                  </p>

                  <div className="grid grid-cols-2 gap-x-6 gap-y-12 lg:grid-cols-3 xl:grid-cols-4">
                    {results.map((product) => (
                      <ProductCard
                        key={product.slug}
                        product={product}
                        memberPricing={variant === "loyaltyGold"}
                      />
                    ))}
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-start gap-4">
                  <p className="font-sora text-h6 font-semibold text-grays-ld-black">
                    No swag matches “{query.trim()}”
                  </p>
                  <Link
                    href={categoryHref()}
                    onClick={onClose}
                    className="font-sohne text-small font-medium text-grays-ld-black underline"
                  >
                    Browse all swag
                  </Link>
                </div>
              )}

              {/* Under the word match whether it found anything or not,
                  since what the shopper meant matters most when it did not. */}
              <SmartPicks query={query} variant={variant} />
            </div>
          </div>
        )}
      </div>
    </>
  );
}
