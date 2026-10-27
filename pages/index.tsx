import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import Hero from "@/components/sections/Hero";
import { useFlags } from "launchdarkly-react-client-sdk";
import EarlyAccessDrop from "@/components/sections/EarlyAccessDrop";
import BestSellers from "@/components/sections/BestSellers";
import QuoteBreak from "@/components/sections/QuoteBreak";
import DropPromo from "@/components/sections/DropPromo";
import SwagAssistant from "@/components/ui/SwagAssistant";
import { useShopper } from "@/components/ui/ShopperProvider";

export default function Home() {
  // Jen designed two variants of the hero and the item block: default and
  // Loyalty Gold Member. Cart Abandoner and New Customer have no art of their
  // own yet, so they fall back to default while keeping their own
  // announcement bar.
  const { persona, variant, tier, role } = useShopper();
  // Flag 01, the release toggle: on for beta testers and developers by
  // segment, off for everyone else, and off for all when the flag is.
  const { earlyAccessDrop } = useFlags();

  return (
    <>
      <Header persona={persona} />
      <Hero tier={tier} role={role} />
      {earlyAccessDrop && <EarlyAccessDrop variant={variant} />}
      <BestSellers variant={variant} />
      <QuoteBreak />
      {/* Flush, because the quote break above it is a full-bleed black
          section that already brings its own padding. */}
      <DropPromo flushTop />
      <Footer />

      <SwagAssistant />
    </>
  );
}
