import ProfileIllustration from "@/components/ui/ProfileIllustration";
import { useShopper } from "@/components/ui/ShopperProvider";
import type { LoyaltyTier } from "@/lib/shopper";

// Figma "Profile Overview Card" (78:1512). This page uses a 12px radius
// throughout, not the 2px of the cart and checkout cards.

// Jen designed the gold badge only. Platinum takes the same shape in the
// store's blue, so the two tiers are told apart at a glance rather than by
// reading the words.
const BADGES: Partial<Record<LoyaltyTier, { label: string; surface: string }>> =
  {
    gold: {
      label: "Loyal Gold Member",
      surface: "bg-base-lime text-grays-ld-black",
    },
    platinum: {
      label: "Platinum Member",
      surface: "bg-base-blue text-grays-white",
    },
  };

export default function ProfileCard({ tier }: { tier: LoyaltyTier }) {
  // Read from whoever is signed in rather than taken as a prop, the same way
  // the header reads the cart: no page has to thread it through.
  const { person } = useShopper();
  const badge = BADGES[tier];

  return (
    <section className="flex flex-col gap-5 rounded-[12px] bg-grays-white p-6">
      <div className="flex items-center gap-4">
        <ProfileIllustration person={person} size={56} />
        <div className="flex min-w-0 flex-col gap-[11px]">
          <p className="font-sohne text-h6 font-medium text-grays-ld-black">
            {person.name}
          </p>
          <p className="truncate font-sohne text-xsmall text-grays-04">
            {person.email}
          </p>
        </div>
      </div>

      {/* The badge is the one entitlement-driven thing in this card. A
          shopper without a tier has nothing to put here, so it goes rather
          than greying out. */}
      {badge && (
        <div
          className={`flex items-center gap-2 rounded-[6px] border border-grays-ld-black px-3 py-2 ${badge.surface}`}
        >
          <img
            src="/icons/shield-check.svg"
            alt=""
            width={16}
            height={16}
            className="shrink-0 max-w-none"
          />
          <p className="font-sohne text-xsmall-caps font-medium uppercase">
            {badge.label}
          </p>
        </div>
      )}

      <div className="h-px w-full bg-grays-hairline" />

      <div className="flex flex-col gap-3">
        {[
          ["Joined", person.joined],
          ["Region", person.region],
        ].map(([label, value]) => (
          <div key={label} className="flex items-start justify-between gap-4">
            <p className="font-sohne text-xsmall-caps font-medium uppercase text-grays-04">
              {label}
            </p>
            <p className="font-sohne text-small font-medium text-grays-ld-black">
              {value}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
