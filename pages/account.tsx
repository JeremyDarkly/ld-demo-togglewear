import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import ProfileCard from "@/components/account/ProfileCard";
import TierStatusCard from "@/components/account/TierStatusCard";
import OrderHistory from "@/components/account/OrderHistory";
import LiveTracking from "@/components/account/LiveTracking";
import SavedItems from "@/components/account/SavedItems";
import ReferralCard from "@/components/account/ReferralCard";
import Preferences from "@/components/account/Preferences";
import SignInPrompt from "@/components/account/SignInPrompt";
import SwagAssistant from "@/components/ui/SwagAssistant";
import { useShopper } from "@/components/ui/ShopperProvider";
import { useFlags } from "launchdarkly-react-client-sdk";
import { isGuest } from "@/lib/shopper";
import { activeShipmentFor } from "@/lib/account";

// Figma "account-profile" (78:1485). Jen drew it for a gold member, which is
// the only variant that exists — but it is one page rather than one page per
// kind of shopper. The two entitlement-driven pieces are the tier badge and
// the tier status card; order history, saved items, referrals and preferences
// belong to everyone.
//
// At 1440 the sidebar is 380 and the main column 884, with a 48px gutter
// inside 64px page padding. Below xl they stack, sidebar first.
//
// A guest has none of that, so they get the sign-in list instead, on the same
// grey page — this is the one place in the store that is behind sign-in.
export default function AccountPage() {
  const { person, persona, shopper } = useShopper();
  const { swagTierProgram, liveOrderTracking } = useFlags();
  const shipment = activeShipmentFor(person);

  return (
    <>
      <Header persona={persona} />

      <div className="bg-grays-01">
        {isGuest(person) ? (
          <main className="mx-auto max-w-[1440px] px-6 py-16 md:px-10 xl:px-16 xl:py-24">
            <SignInPrompt />
          </main>
        ) : (
          <main className="mx-auto flex max-w-[1440px] flex-col gap-12 px-6 py-12 md:px-10 xl:flex-row xl:px-16">
            <div className="flex flex-col gap-6 xl:w-[380px] xl:shrink-0">
              <ProfileCard tier={shopper.loyaltyTier} />
              {/* Was gated on the gold tier; LaunchDarkly owns it now. The
                  flag is the rollout — developers, beta testers and both
                  loyalty tiers by segment, then half of everyone else —
                  rather than the entitlement, so the card appears for
                  whoever the rollout reaches. */}
              {swagTierProgram && <TierStatusCard />}
            </div>

            <div className="flex min-w-0 flex-1 flex-col gap-12">
              {/* Flag 04, a progressive rollout: beta testers and developers
                  first, then everyone else on the schedule. Only when there
                  is a parcel on its way to follow. */}
              {liveOrderTracking && shipment && (
                <LiveTracking order={shipment} />
              )}
              <OrderHistory />
              <SavedItems />
              <ReferralCard />
              <Preferences />
            </div>
          </main>
        )}
      </div>

      <Footer />

      <SwagAssistant />
    </>
  );
}
