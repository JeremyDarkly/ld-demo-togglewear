import { useEffect, useRef, type ReactNode } from "react";
import Link from "next/link";

import { useCart } from "@/components/cart/CartProvider";
import { useIncidents } from "@/components/ui/IncidentProvider";
import ProfileIllustration from "@/components/ui/ProfileIllustration";
import { useShopper } from "@/components/ui/ShopperProvider";
import ShopperTags from "@/components/ui/ShopperTags";
import {
  GUEST,
  SHOPPERS,
  isGuest,
  isNewCustomer,
  type Person,
} from "@/lib/shopper";

// The account menu behind the header's person icon, and the stand-in for a
// real sign-in until there is an account system.
//
// It replaced a switcher that floated at the bottom of every page. Four people
// with two lines of detail each is more than a row of pills can hold without
// wrapping, and "who am I signed in as" belongs in the account menu rather
// than in a bar laid over the storefront.
//
// core-demo's quicklogindialog does the same job as a modal with a portrait
// per persona. This is a dropdown instead, because switching shopper
// mid-sentence in front of a prospect should not dim the page you are talking
// about, and it lists the attributes LaunchDarkly is about to receive rather
// than just a face.
//
// Every visit starts signed out, as a guest, so the menu has two states:
// signing in, which offers all four people, and signed in, which offers the
// other three and a way back out. Signing out is what lets a demo show the
// moment an anonymous visitor becomes a known customer more than once.

// Everyone shows the same generic figure until their row is pointed at, when
// it cross-fades to the pose of Albert they get once picked — so hovering
// previews who you are about to become. The circle goes black because Albert
// is white: on a white circle only his outlines showed and he all but vanished.
function Avatar({ person }: { person: Person }) {
  return (
    <span className="relative flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-grays-01 transition-colors duration-300 group-hover:bg-grays-ld-black group-focus-visible:bg-grays-ld-black">
      <img
        src="/images/illustrations/user.png"
        alt=""
        width={22}
        height={22}
        className="max-w-none transition-opacity duration-300 group-hover:opacity-0 group-focus-visible:opacity-0"
      />
      <img
        src={person.portrait}
        alt=""
        width={36}
        height={36}
        className="absolute inset-0 size-full max-w-none object-cover opacity-0 transition-opacity duration-300 group-hover:opacity-100 group-focus-visible:opacity-100"
      />
    </span>
  );
}

// The same small pill as Empty and Refill.
const PILL =
  "rounded-full border border-grays-02 px-2.5 py-1 font-sohne text-[11px] font-medium text-grays-ld-black transition-colors hover:bg-base-lime disabled:cursor-not-allowed disabled:border-grays-hairline disabled:text-grays-03 disabled:hover:bg-transparent";

function IncidentRow({
  label,
  title,
  children,
}: {
  label: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3" title={title}>
      <p className="font-sohne text-xsmall text-grays-ld-black">{label}</p>
      {children}
    </div>
  );
}

// Orange while on, the palette's warning colour, so a demo cannot forget an
// outage is still running when the next customer reaches checkout.
function OutageToggle({
  on,
  onChange,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => onChange(!on)}
      className={
        on
          ? "rounded-full border border-base-orange bg-base-orange px-2.5 py-1 font-sohne text-[11px] font-medium text-grays-ld-black"
          : PILL
      }
    >
      {on ? "On" : "Off"}
    </button>
  );
}

export default function AccountMenu({ onClose }: { onClose: () => void }) {
  const { person, setShopperId, role } = useShopper();
  const { count, returning, clear, reset } = useCart();
  const { paymentOutage, setPaymentOutage } = useIncidents();
  const panel = useRef<HTMLDivElement>(null);

  // Escape and a click outside, but deliberately not the scroll lock and focus
  // trap useDialog applies: this hangs off the header rather than covering the
  // page, so taking the page's scroll away would be wrong.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    function onPointerDown(event: MouseEvent) {
      const target = event.target as HTMLElement;
      // The header's icon is outside this panel, so without exempting it a
      // click there would close the menu on mousedown and the button's own
      // click would reopen it, leaving it stuck open.
      if (target.closest("[data-account-trigger]")) return;
      if (!panel.current?.contains(target)) onClose();
    }

    window.addEventListener("keydown", onKey);
    // Deferred a tick so the click that opened the menu does not immediately
    // close it again.
    const id = window.setTimeout(
      () => document.addEventListener("mousedown", onPointerDown),
      0,
    );

    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointerDown);
      window.clearTimeout(id);
    };
  }, [onClose]);

  const guest = isGuest(person);
  const others = SHOPPERS.filter((candidate) => candidate.id !== person.id);

  return (
    <div
      ref={panel}
      role="dialog"
      aria-label="Account"
      // Scrolls rather than running off a short laptop screen now that the
      // incident controls sit at the foot; any overflow other than visible
      // still clips the children to the rounded corners.
      className="animate-drop-in absolute right-0 top-[calc(100%+12px)] z-50 flex max-h-[calc(100vh-96px)] w-[340px] flex-col overflow-y-auto rounded-[20px] bg-grays-white shadow-[0_8px_24px_rgba(0,0,0,0.18)]"
    >
      {/* Black like the header it drops from, so who you are reads apart
          from the list of who you could switch to. */}
      <div className="flex items-center gap-3 bg-grays-ld-black px-5 py-4">
        <ProfileIllustration person={person} size={36} />
        <div className="flex min-w-0 flex-col">
          <p className="truncate font-sohne text-small font-medium text-grays-white">
            {person.name}
          </p>
          <p className="truncate font-sohne text-xsmall text-grays-03">
            {guest ? "Not signed in" : person.email}
          </p>
        </div>
      </div>

      <div className="flex flex-col py-2">
        <p className="px-5 py-2 font-sohne-mono text-xsmall-mono uppercase text-grays-04">
          {guest ? "Sign in as" : "Shop as"}
        </p>

        {others.map((candidate) => (
          <button
            key={candidate.id}
            type="button"
            onClick={() => {
              setShopperId(candidate.id);
              onClose();
            }}
            // Why this person is in the roster, for whoever is driving the
            // demo. It was a third line under each name, which made the menu
            // tall enough to run most of the window; it is not needed to wire
            // anything in LaunchDarkly, since the attributes that matter for
            // that are listed at the foot of the menu.
            title={candidate.demonstrates}
            className="group flex items-center gap-3 px-5 py-2.5 text-left transition-colors hover:bg-base-lime focus-visible:bg-base-lime focus-visible:outline-none"
          >
            <Avatar person={candidate} />
            <span className="flex min-w-0 flex-col gap-1">
              <span className="font-sohne text-small font-medium text-grays-ld-black">
                {candidate.name}
              </span>
              <ShopperTags person={candidate} />
            </span>
          </button>
        ))}
      </div>

      {/* The other half of the model. Everything above is chosen; everything
          here is read back off the person and the cart, and is spelled the way
          a targeting rule spells it so flag 08's cart reminder rule
          (returningCart is true) is recognisable on screen. */}
      <div className="flex flex-col gap-1 bg-grays-01 px-5 py-4">
        <p className="font-sohne-mono text-xsmall-mono uppercase text-grays-04">
          Sent to LaunchDarkly
        </p>
        {guest ? (
          // All a guest's context carries. The key is the SDK's, made up in
          // this browser, which is why it is described rather than shown.
          <>
            <p className="font-sohne-mono text-xsmall-mono text-grays-ld-black">
              anonymous true
            </p>
            <p className="font-sohne-mono text-xsmall-mono text-grays-04">
              key generated in this browser
            </p>
          </>
        ) : (
          <>
            <p className="font-sohne-mono text-xsmall-mono text-grays-ld-black">
              tier {person.tier} &middot; role {role}
              {role !== person.role && (
                <span className="text-base-orange"> (overridden)</span>
              )}
            </p>
            <p className="font-sohne-mono text-xsmall-mono text-grays-ld-black">
              orderCount {person.orderCount}
              {isNewCustomer(person) && (
                <span className="text-base-blue"> &middot; new customer</span>
              )}
            </p>
          </>
        )}
        {/* The two controls sit against the number they move, because the old
            single "Reset cart" button looked broken: it restores the two
            seeded items, so pressing it with those two items already in the
            cart changed nothing and gave no feedback. Emptying and refilling
            are the two things you actually want, and the count above proves
            either one happened. */}
        <div className="flex items-center justify-between gap-3">
          {/* Greyed for a guest because it is not sent: see contextFor. */}
          <p
            className={`font-sohne-mono text-xsmall-mono ${
              guest ? "text-grays-04" : "text-grays-ld-black"
            }`}
          >
            cartItemCount {count}
            {guest && " · not sent"}
          </p>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={clear}
              disabled={count === 0}
              className="rounded-full border border-grays-02 px-2.5 py-1 font-sohne text-[11px] font-medium text-grays-ld-black transition-colors hover:bg-base-lime disabled:cursor-not-allowed disabled:border-grays-hairline disabled:text-grays-03 disabled:hover:bg-transparent"
            >
              Empty
            </button>
            <button
              type="button"
              onClick={reset}
              title="Puts two items back as if left on an earlier visit"
              className="rounded-full border border-grays-02 px-2.5 py-1 font-sohne text-[11px] font-medium text-grays-ld-black transition-colors hover:bg-base-lime"
            >
              Refill
            </button>
          </div>
        </div>
        <p
          className={`font-sohne-mono text-xsmall-mono ${
            guest ? "text-grays-04" : "text-grays-ld-black"
          }`}
        >
          returningCart {String(returning)}
          {guest && " · not sent"}
        </p>
      </div>

      {/* The trouble flag 12 reacts to. This only causes the problem; the
          fix arrives from LaunchDarkly, which is the demo. Flags 13 and 14
          are backend scenarios, started from the demo generator (Cmd+K). */}
      <div className="flex flex-col gap-2 border-t border-grays-hairline px-5 py-4">
        <p className="font-sohne-mono text-xsmall-mono uppercase text-grays-04">
          Simulate an incident
        </p>
        <IncidentRow
          label="Payment outage"
          title="The new payment processor fails every charge until flag 12 is turned off"
        >
          <OutageToggle on={paymentOutage} onChange={setPaymentOutage} />
        </IncidentRow>
      </div>

      {/* A guest has no account to view and nothing to sign out of, so the
          foot only appears once someone is signed in. */}
      {!guest && (
        <div className="flex items-center justify-between gap-3 border-t border-grays-hairline px-5 py-3">
          <Link
            href="/account"
            onClick={onClose}
            className="font-sohne text-small font-medium text-base-blue hover:underline"
          >
            View account
          </Link>
          <button
            type="button"
            onClick={() => {
              setShopperId(GUEST.id);
              onClose();
            }}
            className="font-sohne text-small font-medium text-grays-04 hover:text-grays-ld-black"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
