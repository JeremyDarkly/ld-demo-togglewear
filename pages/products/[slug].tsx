import { useEffect, useRef } from "react";
import { type GetStaticPaths, type GetStaticProps } from "next";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import ProductDetails from "@/components/sections/ProductDetails";
import ProductDetailsBoundary from "@/components/sections/ProductDetailsBoundary";
import RecommendedForYou from "@/components/sections/RecommendedForYou";
import DropPromo from "@/components/sections/DropPromo";
import SwagAssistant from "@/components/ui/SwagAssistant";
import { useShopper } from "@/components/ui/ShopperProvider";
import { EVENTS, useTrack } from "@/lib/events";
import { useLiveProduct } from "@/lib/catalog";
import {
  ALL_PRODUCTS,
  BEST_SELLERS,
  productBySlug,
  type Product,
} from "@/lib/products";

// Jen's product detail page reuses the top nav, the Fresh drops promo and the
// footer unchanged from the homepage. Only the details block and the
// recommendation row are specific to it.
export default function ProductPage({ product }: { product: Product }) {
  const { persona, variant } = useShopper();
  const track = useTrack();

  // The sizes on sale come from the catalog API once it answers, over the
  // ones the page was built with. Which catalog answers is flag 05's call,
  // made on the server.
  const live = useLiveProduct(product.slug);
  const shown = live ? { ...product, sizes: live.sizes } : product;

  // Members-only products are absent from the default catalogue, so a
  // non-member landing here by URL should not see one.
  const hidden = product.membersOnly && variant !== "loyaltyGold";

  // A plain part of the store, with no flag on it: flag 14's recommendation
  // engine is a backend scenario the generator plays out in LaunchDarkly, not
  // something this row shows. Recommendations are everything except what you
  // are already looking at, and a member's include the members-only drop.
  const pool = variant === "loyaltyGold" ? ALL_PRODUCTS : BEST_SELLERS;
  const recommended = pool.filter((p) => p.slug !== product.slug);
  const showRecommendations = recommended.length > 0;

  // Once per product per visit to the page. The ref, rather than an empty
  // dependency list, is what lets it wait for a client that is not built yet
  // and still count a move from one product straight to another, which reuses
  // this page without remounting it. A members-only notice is not a view.
  const viewed = useRef<string | null>(null);
  useEffect(() => {
    if (hidden || viewed.current === product.slug) return;
    if (track(EVENTS.productViewed, { slug: product.slug })) {
      viewed.current = product.slug;
    }
  }, [track, product.slug, hidden]);

  return (
    <>
      <Header persona={persona} />

      {hidden ? (
        <section className="w-full bg-grays-ld-black">
          <div className="mx-auto flex max-w-[1440px] flex-col items-start gap-4 px-6 py-32 md:px-10 xl:px-16">
            <h1 className="font-sora text-h3 font-semibold text-grays-white">
              Members only
            </h1>
            <p className="font-sohne text-main text-grays-02">
              This drop is open to Loyalty Gold members first. Switch persona to
              take a look.
            </p>
          </div>
        </section>
      ) : (
        // Flush only when the recommendation row follows, since that section
        // brings its own padding. Otherwise the panel keeps its own 10px
        // frame, and so does the drop promo below, which is what separates
        // the two cards.
        <ProductDetailsBoundary
          key={product.slug}
          product={product}
          flushBottom={showRecommendations}
        >
          <ProductDetails
            product={shown}
            variant={variant}
            flushBottom={showRecommendations}
          />
        </ProductDetailsBoundary>
      )}

      {showRecommendations && (
        <RecommendedForYou products={recommended} variant={variant} />
      )}

      {/* Flush against either of the black sections that can precede it — the
          members-only notice or the recommendation row — and inset when the
          product panel is what sits above. */}
      <DropPromo flushTop={hidden || showRecommendations} />
      <Footer />

      <SwagAssistant />
    </>
  );
}

export const getStaticPaths: GetStaticPaths = () => ({
  // Members-only products get a route too, so the page itself can decide
  // whether the current persona is allowed to see them.
  paths: ALL_PRODUCTS.map((p) => ({ params: { slug: p.slug } })),
  fallback: false,
});

export const getStaticProps: GetStaticProps = ({ params }) => {
  const product = productBySlug(String(params?.slug));
  if (!product) return { notFound: true };
  return { props: { product } };
};
