import ProfileIllustration from "@/components/ui/ProfileIllustration";
import { useShopper } from "@/components/ui/ShopperProvider";
import { ROLES, SHOPPERS, TIER_LABELS } from "@/lib/shopper";

// What /account shows a guest. Everything else on that page is about a known
// shopper — their orders, saved items, tier — so a guest gets the same five
// people the account menu offers, and picking one fills the page in place.
//
// The same card as the rest of the account page rather than a page of its own,
// so signing in here and signing in from the header are visibly one action.
export default function SignInPrompt() {
  const { setShopperId } = useShopper();

  return (
    <section className="mx-auto flex w-full max-w-[520px] flex-col gap-6 rounded-[12px] bg-grays-white p-6 md:p-8">
      <div className="flex flex-col gap-2">
        <h1 className="font-sohne text-h6 font-medium text-grays-ld-black">
          Sign in to see your account
        </h1>
        <p className="font-sohne text-small text-grays-04">
          Your orders, saved items and swag tier live here. Pick who to sign in
          as.
        </p>
      </div>

      <ul className="flex flex-col">
        {SHOPPERS.map((candidate) => (
          <li key={candidate.id}>
            <button
              type="button"
              onClick={() => setShopperId(candidate.id)}
              title={candidate.demonstrates}
              className="flex w-full items-center gap-3 rounded-[8px] px-3 py-2.5 text-left transition-colors hover:bg-base-lime focus-visible:bg-base-lime focus-visible:outline-none"
            >
              <ProfileIllustration person={candidate} size={36} />
              <span className="flex min-w-0 flex-col">
                <span className="font-sohne text-small font-medium text-grays-ld-black">
                  {candidate.name}
                </span>
                <span className="font-sohne-mono text-[10px] uppercase text-grays-04">
                  {TIER_LABELS[candidate.tier]} &middot;{" "}
                  {ROLES.find((r) => r.id === candidate.role)?.label}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
