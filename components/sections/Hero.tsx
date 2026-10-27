import Image from "next/image";
import Link from "next/link";

import { categoryHref } from "@/lib/products";
import type { LoyaltyTier, ShopperRole } from "@/lib/shopper";

// Figma component "hero" (63:4062), which has two variants: Default and
// "Loyal Gold Member". Both the copy and the image change between them.
//
// Keyed on the loyalty tier rather than on the pricing variant it used to
// take. Platinum maps onto the gold pricing variant for now, so a hero that
// asked about pricing could not tell the top tier from the middle one and
// Diane saw Alex's hero.

type Variant = {
  eyebrow: string;
  headline: string;
  body: string;
  cta: string;
  href: string;
  image: string;
};

const VARIANTS: Record<LoyaltyTier, Variant> = {
  none: {
    eyebrow: "ToggleWear — Built for builders.",
    headline: "Official swag for all Control Freaks.",
    body: "Sweatshirts, hats, tech accessories, and everyday swag featuring the ToggleWear mark — designed to be worn, not just worn out.",
    cta: "Shop swag",
    // The two calls to action say different things, so they go to different
    // places: everything for the default shopper, and the new arrivals the
    // member's copy is actually promising.
    href: categoryHref(),
    image: "/images/hero-default.png",
  },
  gold: {
    eyebrow: "New drip drop.",
    headline: "First rollout goes to you.",
    body: "As a loyalty member, you get first dibs on new merch — before it drops for everyone else.",
    cta: "Shop new arrivals",
    href: categoryHref("new"),
    image: "/images/hero-loyalty.png",
  },
  // Jen has not designed this one. The copy promises early access and member
  // pricing, which both exist, and deliberately not free shipping or a
  // headline discount rate, which do not yet.
  //
  // The art is cropped from her VR Headset product shot (Figma 242:1301), the
  // Limited Run piece, so the top tier leads with the most exclusive item in
  // the store rather than reusing the gold panel, which would leave it looking
  // identical to the middle tier. The source photo is about 850px wide, so it
  // is upscaled to match her 1400px heroes and slightly softer; the wordmark
  // is a vector layer and stays sharp.
  platinum: {
    eyebrow: "Platinum access.",
    headline: "The whole drop, before anyone.",
    body: "Platinum members see every new release before it reaches anyone else, with member pricing across the entire range.",
    cta: "Shop the drop",
    href: categoryHref("new"),
    image: "/images/hero-platinum-vr.png",
  },
};

// Beta testers and developers have no tier, so without these they saw the
// default hero and nothing on the page said who was signed in. Neither has art
// from Jen; both reuse her product shots, the Visor model photo (Figma
// 277:1280), a new arrival everyone can see, and the Sticker Pack laptop
// (47:2252), cropped the same way as the platinum panel.
const ROLE_VARIANTS: Partial<Record<ShopperRole, Variant>> = {
  beta: {
    eyebrow: "Beta access.",
    headline: "You see it before it ships.",
    body: "As a beta tester, new drops reach you first, before they go out to everyone else.",
    cta: "Shop new arrivals",
    href: categoryHref("new"),
    image: "/images/hero-beta-visor.png",
  },
  developer: {
    eyebrow: "Staff preview.",
    headline: "Every rollout starts with you.",
    body: "As a ToggleWear developer, you're first in line for every release, so you see what's changing before anyone else.",
    cta: "Shop tech",
    href: categoryHref("tech"),
    image: "/images/hero-developer-stickers.png",
  },
};

// A tier wins over a role, the same order the announcement bar uses, so a
// gold member switched to beta still sees the gold hero.
export default function Hero({
  tier = "none",
  role = "shopper",
}: {
  tier?: LoyaltyTier;
  role?: ShopperRole;
}) {
  const { eyebrow, headline, body, cta, href, image } =
    (tier === "none" && ROLE_VARIANTS[role]) || VARIANTS[tier];

  return (
    <section className="w-full bg-grays-ld-black">
      <div className="mx-auto flex max-w-[1440px] flex-col xl:h-[616px] xl:flex-row xl:items-start">
        <div className="flex flex-1 flex-col justify-between gap-12 px-6 py-12 md:px-10 md:py-16 xl:h-full xl:gap-0 xl:pb-20 xl:pl-16 xl:pr-12 xl:pt-20">
          <div className="flex w-full flex-col gap-6 xl:gap-[37px]">
            <p className="font-sohne text-small font-medium text-grays-02">
              {eyebrow}
            </p>

            {/* Jen scaled the H1 token up for this instance. Tracking stays at
                the -5% the type system uses, so it tracks with the size. */}
            <h1 className="font-sora text-[44px] font-bold leading-none tracking-[-2.2px] text-grays-01 md:text-[56px] md:tracking-[-2.8px] xl:w-[508px] xl:text-[77.531px] xl:tracking-[-3.8766px]">
              {headline}
            </h1>

            <p className="max-w-[480px] font-sohne text-main text-grays-02">
              {body}
            </p>
          </div>

          <Link
            href={href}
            className="flex h-12 w-fit items-center justify-center gap-2.5 rounded-[12px] border border-grays-ld-black bg-base-lime pl-4 pr-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-grays-white focus-visible:ring-offset-2 focus-visible:ring-offset-grays-ld-black"
          >
            <span className="pb-px font-sohne text-main-medium font-medium text-grays-ld-black">
              {cta}
            </span>
            {/* A wide arrow glyph that the design crops down to a 28px box.
                max-w-none is required: preflight's img{max-width:100%} would
                otherwise clamp it to the container and squash it, since the
                SVG sets preserveAspectRatio="none". */}
            <span className="relative block size-7 shrink-0 overflow-hidden">
              <img
                src="/icons/arrow-button.svg"
                alt=""
                className="absolute left-[-24.89px] top-[7.78px] h-[11.714px] w-[46.73px] max-w-none"
              />
            </span>
          </Link>
        </div>

        {/* No bottom padding at xl: the design runs the panel flush to the
            bottom edge of the 616px hero. */}
        <div className="w-full shrink-0 p-2.5 xl:h-full xl:w-[720px] xl:pb-0">
          <div className="relative aspect-[700/606] w-full overflow-hidden rounded-[30px] bg-grays-03 xl:aspect-auto xl:h-full">
            <Image
              src={image}
              alt=""
              fill
              priority
              sizes="(min-width: 1280px) 700px, 100vw"
              className="object-cover"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
