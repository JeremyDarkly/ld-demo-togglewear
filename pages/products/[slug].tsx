import { useEffect, useRef } from "react";
import { type GetStaticPaths, type GetStaticProps } from "next";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import ProductDetails from "@/components/sections/ProductDetails";
import RecommendedForYou from "@/components/sections/RecommendedForYou";
import DropPromo from "@/components/sections/DropPromo";
import SwagAssistant from "@/components/ui/SwagAssistant";
import { useShopper } from "@/components/ui/ShopperProvider";
import { useIncidents } from "@/components/ui/IncidentProvider";
import { useFlags } from "launchdarkly-react-client-sdk";
import { LDObserve } from "@launchdarkly/observability";
import { EVENTS, useTrack } from "@/lib/events";
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
  const { swagRecommendations, recommendationEngine } = useFlags();
  const { recommendationsOutage } = useIncidents();
  const track = useTrack();

  // Flag 04 decides whether there is a row at all; flag 12 decides what fills
  // it. Personalised picks come from a service that can fail, and while it is
  // down the row simply is not there, which is what a shopper would see. Best
  // sellers are a static list with nothing to fail, which is why flag 12's
  // adaptive trigger falls back to them.
  const bestSellersOnly = recommendationEngine === "best-sellers";
  const recommendationsFailed = !bestSellersOnly && recommendationsOutage;
  const showRecommendations = swagRecommendations && !recommendationsFailed;

  // Members-only products are absent from the default catalogue, so a
  // non-member landing here by URL should not see one.
  const hidden = product.membersOnly && variant !== "loyaltyGold";

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

  // One failure per product per visit, counted the same way as a view: the
  // row failed to load for this shopper on this page. It goes to two places,
  // the custom event that flag 12's adaptive trigger counts and the Errors
  // page an engineer would open to find out why.
  const failed = useRef<string | null>(null);
  useEffect(() => {
    if (
      !swagRecommendations ||
      !recommendationsFailed ||
      failed.current === product.slug
    ) {
      return;
    }
    if (track(EVENTS.recommendationsFailed, { slug: product.slug }, 1)) {
      failed.current = product.slug;
      const error = new Error("Recommendation service unavailable");
      error.name = "RecommendationServiceError";
      LDObserve.recordError(error, "Personalized recommendations failed to load", {
        flag: "recommendationEngine",
        slug: product.slug,
      });
    }
  }, [track, product.slug, swagRecommendations, recommendationsFailed]);

  // Recommendations are everything except what you are already looking at.
  // The personalised pool includes the members-only drop for a member; the
  // best sellers fallback is the same public list for everyone.
  const pool =
    !bestSellersOnly && variant === "loyaltyGold" ? ALL_PRODUCTS : BEST_SELLERS;
  const recommended = pool.filter((p) => p.slug !== product.slug);

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
        <ProductDetails
          product={product}
          variant={variant}
          flushBottom={showRecommendations}
        />
      )}

      {/* Eased out by a progressive rollout, so most shoppers do not have it
          yet. Beta testers and Gold and Platinum members see it regardless of
          the schedule — Megan, Alex or Diane. */}
      {showRecommendations && (
        <RecommendedForYou
          products={recommended}
          variant={variant}
          heading={bestSellersOnly ? "Popular right now" : undefined}
        />
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
