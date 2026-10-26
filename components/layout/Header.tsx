import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { useCart } from "@/components/cart/CartProvider";
import { useUnderTheHood } from "@/components/hood/UnderTheHood";
import AccountMenu from "@/components/ui/AccountMenu";
import SearchPanel from "@/components/ui/SearchPanel";
import { useShopper } from "@/components/ui/ShopperProvider";
import { categoryHref, type ProductFilter } from "@/lib/products";
import AnnouncementBar, { type AnnouncementPersona } from "./AnnouncementBar";

// Figma component "Top nav" (19:1783), instanced on all eight screens. The
// announcement bar is nested inside it in the design, so it composes here too.
// Jen designed desktop only; below lg the links move into a menu panel.
//
// Accessories is not in her header, though it is in her footer's Shop column
// alongside the other three. Having a category a shopper can reach from the
// bottom of the page but not the top was the odder of the two, so it is here.
const NAV_LINKS: { label: string; filter: ProductFilter }[] = [
  { label: "New Drops", filter: "new" },
  { label: "Apparel", filter: "apparel" },
  { label: "Accessories", filter: "accessories" },
  { label: "Tech", filter: "tech" },
];

export default function Header({
  persona = "default",
}: {
  persona?: AnnouncementPersona;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  // Read straight from the cart rather than taking a count prop, so no page
  // has to remember to thread it through.
  const { count: cartCount } = useCart();
  // Search results obey the persona the same way every other list does, so
  // the variant is read here rather than passed down from each page.
  const { variant } = useShopper();
  const { open: hoodOpen, toggle: toggleHood } = useUnderTheHood();

  // Which link is lit follows the URL rather than being fixed in the list,
  // which had New Drops highlighted on every page including the cart.
  const { pathname, query } = useRouter();
  const current = pathname === "/products" ? query.category : undefined;

  return (
    // relative positions the search panel against the bar, and z-50 keeps the
    // whole header above the dim that panel lays over the page, so the bar and
    // the field below it read as one piece of chrome.
    <header className="relative z-50 w-full">
      <AnnouncementBar persona={persona} />

      <div className="w-full bg-grays-black-01">
        <div className="mx-auto flex h-20 max-w-[1440px] items-center justify-between px-6 md:px-10 xl:px-16">
          <div className="flex items-center gap-4">
            <button
              type="button"
              aria-label="Menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
              className="text-grays-white lg:hidden"
            >
              {/* The design has no menu icon, since it stops at desktop width. */}
              <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
                <path
                  d={menuOpen ? "M4 4l12 12M16 4L4 16" : "M3 6h14M3 10h14M3 14h14"}
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  fill="none"
                />
              </svg>
            </button>

            <Link
              href="/"
              className="flex items-center gap-2 font-sora text-[24px] font-bold leading-[1.1] tracking-[-0.48px] text-grays-white"
            >
              {/* Mark first, as in LaunchDarkly's own lockup. Sized to the
                  wordmark's tallest letters rather than its capitals: the
                  mark is all thin strokes and looked lost beside the bold
                  type at cap height. */}
              <img src="/icons/ld-logo-white.svg" alt="" width={22} height={22} />
              ToggleWear
            </Link>
          </div>

          <nav className="hidden items-center gap-8 font-sohne text-small font-medium lg:flex">
            {NAV_LINKS.map(({ label, filter }) => (
              <Link
                key={label}
                href={categoryHref(filter)}
                aria-current={filter === current ? "page" : undefined}
                className={filter === current ? "text-grays-white" : "text-grays-02"}
              >
                {label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-5 self-stretch md:gap-[25px]">
            <button
              type="button"
              aria-label="Search"
              onClick={() => setSearchOpen(true)}
            >
              <img src="/icons/magnify.svg" alt="" width={17.2632} height={17.2632} />
            </button>
            {/* The icon opens the account menu rather than navigating, which
                is where the shopper is switched. The account page itself is a
                link inside that menu. Stretched to the bar's full height so
                the menu hangs from the bar's bottom edge rather than the
                icon's: the menu's black top would otherwise run into the bar. */}
            <div className="relative flex items-center self-stretch">
              <button
                type="button"
                data-account-trigger
                aria-label="Account"
                aria-expanded={accountOpen}
                onClick={() => setAccountOpen((open) => !open)}
              >
                <img src="/icons/person.svg" alt="" width={19.8947} height={19.8947} />
              </button>

              {accountOpen && (
                <AccountMenu onClose={() => setAccountOpen(false)} />
              )}
            </div>
            <Link
              href="/cart"
              aria-label={`Cart, ${cartCount} items`}
              className="flex items-center"
            >
              <img
                src="/icons/shopping-cart.svg"
                alt=""
                width={19.8947}
                height={19.8947}
              />
              <span className="font-sohne text-small font-medium text-grays-white">
                ({cartCount})
              </span>
            </Link>
            {/* For whoever is driving the demo rather than the shopper, so it
                sits apart from the shop's own controls, past a divider at the
                end of the bar. Hidden on phones, where it pushed into the logo
                and the panel would cover the whole store anyway. */}
            <span aria-hidden="true" className="ml-3 hidden h-5 w-px bg-grays-05 sm:block md:ml-5" />
            <button
              type="button"
              aria-label="Under the hood"
              aria-pressed={hoodOpen}
              title="Under the hood: live backend, code, architecture and demo tools"
              onClick={toggleHood}
              className={`hidden items-center rounded-full px-2 py-1 sm:flex font-sohne-mono text-xsmall-mono transition-colors ${
                hoodOpen ? "bg-base-lime text-grays-ld-black" : "text-grays-02 hover:text-grays-white"
              }`}
            >
              {"</>"}
            </button>
          </div>
        </div>

        {menuOpen && (
          <nav className="border-t border-grays-04 lg:hidden">
            <div className="mx-auto flex max-w-[1440px] flex-col px-6 py-2 font-sohne text-small font-medium md:px-10">
              {NAV_LINKS.map(({ label, filter }) => (
                <Link
                  key={label}
                  href={categoryHref(filter)}
                  onClick={() => setMenuOpen(false)}
                  aria-current={filter === current ? "page" : undefined}
                  className={`py-3 ${
                    filter === current ? "text-grays-white" : "text-grays-02"
                  }`}
                >
                  {label}
                </Link>
              ))}
            </div>
          </nav>
        )}
      </div>

      {searchOpen && (
        <SearchPanel variant={variant} onClose={() => setSearchOpen(false)} />
      )}
    </header>
  );
}
