import { useEffect, useState } from "react";
import SectionPanel from "@/components/layout/SectionPanel";
import ProductCard from "@/components/ui/ProductCard";
import Reveal from "@/components/ui/Reveal";
import { productBySlug, type PricingVariant, type Product } from "@/lib/products";

// The next drop, shown early to whoever flag 01 lets in — beta testers and
// developers. It is the demo's plainest release toggle, ToggleWear's version
// of core-demo's Wealth Management component: a whole section that is there
// for some shoppers, absent for the rest, and gone for everyone the moment
// the flag is switched off.
//
// Jen did not design it, so it is built from her pieces: the panel from the
// item block, the cards from best sellers, and lime, the brand's accent, as
// the panel's colour. Lime rather than the white of the panel below it so the
// two grids are not read as one, and rather than black because the hero
// directly above is black and the section would merge into it.
//
// The four are the newest pieces in the catalogue, the ones with photography,
// so nothing here waits on Jen. Members-only items are left out: early
// access and membership are separate entitlements, and Megan is not a member.
const EARLY_ACCESS_SLUGS = [
  "togglewear-hoodie",
  "togglewear-tee",
  "bucket-hat",
  "checkerboard-socks",
];

const products = EARLY_ACCESS_SLUGS.map(productBySlug).filter(
  (product): product is Product => Boolean(product),
);

// The public opening is always midnight fourteen days from whenever the page
// is looked at, so the countdown never runs out or shows a past date in a
// demo given months from now. Midnight rather than now-plus-two-weeks keeps
// the target still across reloads on the same day.
//
// Reading the clock while rendering is safe here: the section only exists
// once the flag has been evaluated in the browser, so it is never
// prerendered and cannot disagree with the server.
const LEAD_DAYS = 14;

// How long early access has notionally been open in total. Only used to
// fill the progress bar, which starts about a third of the way along so it
// reads as a window already under way.
const WINDOW_DAYS = 21;

const DAY = 24 * 60 * 60 * 1000;

function publicOpening() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + LEAD_DAYS);
}

function Countdown() {
  const [opensAt] = useState(publicOpening);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const remaining = Math.max(0, opensAt.getTime() - now);
  const progress = 1 - remaining / (WINDOW_DAYS * DAY);
  const units = [
    { label: "Days", value: Math.floor(remaining / DAY) },
    { label: "Hrs", value: Math.floor(remaining / 3_600_000) % 24 },
    { label: "Min", value: Math.floor(remaining / 60_000) % 60 },
    { label: "Sec", value: Math.floor(remaining / 1000) % 60 },
  ];

  return (
    <div className="flex w-full flex-col gap-3 md:w-auto md:min-w-[340px]">
      <p className="font-sohne-mono text-xsmall-mono uppercase text-grays-ld-black">
        Opens to everyone{" "}
        {opensAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
      </p>

      {/* Read out once as a sentence instead of a number changing every
          second, which a screen reader would otherwise announce each time. */}
      <div
        className="flex gap-6"
        role="timer"
        aria-label={`Opens to everyone in ${units[0].value} days`}
      >
        {units.map((unit) => (
          <div key={unit.label} className="flex flex-col" aria-hidden>
            <span className="font-sora text-[40px] font-semibold leading-none tracking-[-1.5px] text-grays-ld-black tabular-nums md:text-[52px]">
              {String(unit.value).padStart(2, "0")}
            </span>
            <span className="mt-2 font-sohne-mono text-xsmall-mono uppercase text-grays-ld-black/60">
              {unit.label}
            </span>
          </div>
        ))}
      </div>

      <div className="h-1 w-full overflow-hidden rounded-full bg-grays-ld-black/15">
        <div
          className="h-full rounded-full bg-grays-ld-black"
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      </div>
    </div>
  );
}

const TICKER = ["Early access", "New drop", "Before everyone else"];

// A strip of type running across the top of the panel, the way a drop is
// announced in a shop window. Black on the lime with a hairline under it
// rather than a black band: a band would merge with the black frame around
// the panel and read as the panel starting lower. Reuses the carousel's
// marquee, so it loops the same seamless way.
function Ticker() {
  const set = Array.from({ length: 4 }, () => TICKER).flat();
  return (
    <div className="overflow-hidden border-b border-grays-ld-black/15 py-3">
      <div className="flex w-max animate-[marquee_40s_linear_infinite] motion-reduce:animate-none">
        {[false, true].map((duplicate) => (
          <div
            key={String(duplicate)}
            className="flex"
            aria-hidden={duplicate || undefined}
          >
            {set.map((phrase, index) => (
              <span
                key={index}
                className="flex items-center whitespace-nowrap font-sohne-mono text-xsmall-mono uppercase text-grays-ld-black"
              >
                {phrase}
                <span className="mx-6 h-1.5 w-1.5 rounded-full bg-grays-ld-black" />
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function EarlyAccessDrop({
  variant = "default",
}: {
  variant?: PricingVariant;
}) {
  // Mounts closed and opens on the next frame. The section appears when the
  // flag turns on — live, if someone flips it mid-demo — and opening it
  // makes room gradually instead of shoving best sellers down in one jump.
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setOpen(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    // Animating grid rows from 0fr to 1fr is what lets the height ease to
    // whatever the content needs, which a height transition cannot do.
    <div
      className={`grid transition-[grid-template-rows,opacity] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none ${
        open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
      }`}
    >
      <div className="overflow-hidden">
        <SectionPanel className="bg-base-lime">
          <Ticker />
          <div className="px-6 pb-16 pt-10 md:px-10 md:pb-20 md:pt-12 xl:px-16 xl:pb-[100px] xl:pt-[60px]">
            <Reveal className="mb-12 flex flex-col gap-10 md:flex-row md:items-end md:justify-between">
              <div className="flex flex-col gap-4">
                <h2 className="font-sora text-h3 font-semibold text-grays-ld-black">
                  The new drop, before everyone else.
                </h2>
                <p className="max-w-[520px] font-sohne text-main text-grays-ld-black/70">
                  You are seeing it first because you are on the early access
                  list.
                </p>
              </div>
              <Countdown />
            </Reveal>

            <div className="grid grid-cols-2 gap-x-6 gap-y-12 xl:grid-cols-4">
              {products.map((product, index) => (
                <Reveal key={product.slug} delay={index * 80}>
                  <ProductCard
                    product={product}
                    memberPricing={variant === "loyaltyGold"}
                    badge="Early access"
                  />
                </Reveal>
              ))}
            </div>
          </div>
        </SectionPanel>
      </div>
    </div>
  );
}

