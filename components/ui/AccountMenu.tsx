import { useEffect, useRef } from "react";
import Link from "next/link";

import { useCart } from "@/components/cart/CartProvider";
import ProfileIllustration from "@/components/ui/ProfileIllustration";
import { useShopper } from "@/components/ui/ShopperProvider";
import {
  ROLES,
  SHOPPERS,
  TIER_LABELS,
  isNewCustomer,
  type Person,
} from "@/lib/shopper";

// The account menu behind the header's person icon, and the stand-in for a
// real sign-in until there is an account system.
//
// It replaced a switcher that floated at the bottom of every page. Five people
// with two lines of detail each is more than a row of pills can hold without
// wrapping, and "who am I signed in as" belongs in the account menu rather
// than in a bar laid over the storefront.
//
// core-demo's quicklogindialog does the same job as a modal with a portrait
// per persona. This is a dropdown instead, because switching shopper
// mid-sentence in front of a prospect should not dim the page you are talking
// about, and it lists the attributes LaunchDarkly is about to receive rather
// than just a face.

function roleLabel(person: Person) {
  return ROLES.find((r) => r.id === person.role)?.label ?? person.role;
}

// Everyone shows the same generic figure until their row is pointed at, when
// it cross-fades to the pose of Albert they get once picked — so hovering
// previews who you are about to become. The circle goes white rather than
// staying grey, because Albert is white and would sit muddy on grey against
// the row's lime.
function Avatar({ person }: { person: Person }) {
  return (
    <span className="relative flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-grays-01 transition-colors duration-300 group-hover:bg-grays-white group-focus-visible:bg-grays-white">
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

export default function AccountMenu({ onClose }: { onClose: () => void }) {
  const { person, setShopperId, role } = useShopper();
  const { count, clear, reset } = useCart();
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

  const others = SHOPPERS.filter((candidate) => candidate.id !== person.id);

  return (
    <div
      ref={panel}
      role="dialog"
      aria-label="Account"
      className="animate-drop-in absolute right-0 top-[calc(100%+12px)] z-50 flex w-[340px] flex-col overflow-hidden rounded-[20px] bg-grays-white shadow-[0_8px_24px_rgba(0,0,0,0.18)]"
    >
      <div className="flex items-center gap-3 px-5 py-4">
        <ProfileIllustration person={person} size={36} />
        <div className="flex min-w-0 flex-col">
          <p className="truncate font-sohne text-small font-medium text-grays-ld-black">
            {person.name}
          </p>
          <p className="truncate font-sohne text-xsmall text-grays-04">
            {person.email}
          </p>
        </div>
      </div>

      <div className="mx-5 h-px bg-grays-hairline" />

      <div className="flex flex-col py-2">
        <p className="px-5 py-2 font-sohne-mono text-xsmall-mono uppercase text-grays-04">
          Shop as
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
            <span className="flex min-w-0 flex-col">
              <span className="font-sohne text-small font-medium text-grays-ld-black">
                {candidate.name}
              </span>
              {/* Darkens on hover rather than staying Gray 04, which goes
                  muddy against the lime. */}
              <span className="font-sohne-mono text-[10px] uppercase text-grays-04 group-hover:text-grays-ld-black/70">
                {TIER_LABELS[candidate.tier]} &middot; {roleLabel(candidate)}
              </span>
            </span>
          </button>
        ))}
      </div>

      {/* The other half of the model. Everything above is chosen; everything
          here is read back off the person and the cart, and is spelled the way
          a segment rule spells it so the New Customers and Cart Abandoners
          rules are recognisable on screen. */}
      <div className="flex flex-col gap-1 bg-grays-01 px-5 py-4">
        <p className="font-sohne-mono text-xsmall-mono uppercase text-grays-04">
          Sent to LaunchDarkly
        </p>
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
        {/* The two controls sit against the number they move, because the old
            single "Reset cart" button looked broken: it restores the two
            seeded items, so pressing it with those two items already in the
            cart changed nothing and gave no feedback. Emptying and refilling
            are the two things you actually want, and the count above proves
            either one happened. */}
        <div className="flex items-center justify-between gap-3">
          <p className="font-sohne-mono text-xsmall-mono text-grays-ld-black">
            cartItemCount {count}
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
              className="rounded-full border border-grays-02 px-2.5 py-1 font-sohne text-[11px] font-medium text-grays-ld-black transition-colors hover:bg-base-lime"
            >
              Refill
            </button>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-grays-hairline px-5 py-3">
        <Link
          href="/account"
          onClick={onClose}
          className="font-sohne text-small font-medium text-base-blue hover:underline"
        >
          View account
        </Link>
      </div>
    </div>
  );
}
