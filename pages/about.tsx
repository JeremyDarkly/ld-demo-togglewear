import Link from "next/link";

import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import SectionPanel from "@/components/layout/SectionPanel";
import QuoteBreak from "@/components/sections/QuoteBreak";
import DropPromo from "@/components/sections/DropPromo";
import Reveal from "@/components/ui/Reveal";
import SwagAssistant from "@/components/ui/SwagAssistant";
import { useShopper } from "@/components/ui/ShopperProvider";
import { categoryHref } from "@/lib/products";

// Jen designed no about page, so this is built only from devices that already
// exist: the hero's full-bleed black treatment for the opening, the inset
// white SectionPanel for the body, the quote break reused as it stands, and
// the drop promo to give the page somewhere to go. No new type sizes, no new
// colours, no photography — the three columns carry it, which also means
// nothing here is waiting on Jen.
//
// It is our own page rather than a redirect to launchdarkly.com because
// sending a prospect off to the marketing site in the middle of a demo loses
// the thread. The outbound link lives in the middle column instead.
const COLUMNS = [
  {
    heading: "Made for the team, not the launch",
    body: "Most company swag is printed for one conference and worn once. Ours is specified like something you would actually buy — heavyweight combed cotton, pre-shrunk, cut relaxed with dropped shoulders. The drop changes every season, so there is always something new worth wearing.",
  },
  {
    heading: "Part of LaunchDarkly",
    body: "ToggleWear is LaunchDarkly's store, and the mark on every piece is the same one engineering teams see on the dashboard they ship software with. If you came for the feature management rather than the fleece, that lives on the main site.",
  },
  {
    heading: "Every drop is limited",
    body: "We print what a season needs and then we stop. When a run goes it does not come back in the same colourway, which is why a product page that says Limited Run means it. Members see each drop before anyone else.",
  },
];

export default function About() {
  const { persona } = useShopper();

  return (
    <>
      <Header persona={persona} />

      {/* The hero's black, padding and type treatment, without its collage —
          reusing that art here would read as a second homepage. */}
      <section className="w-full bg-grays-ld-black">
        <div className="mx-auto flex max-w-[1440px] flex-col gap-6 px-6 py-16 md:px-10 md:py-20 xl:gap-[37px] xl:px-16 xl:py-[100px]">
          <p className="font-sohne text-small font-medium text-grays-02">
            About ToggleWear
          </p>

          <h1 className="max-w-[760px] font-sora text-[44px] font-bold leading-none tracking-[-2.2px] text-grays-01 md:text-[56px] md:tracking-[-2.8px] xl:text-[72px] xl:tracking-[-3.6px]">
            We ship swag the way we ship software.
          </h1>

          <p className="max-w-[620px] font-sohne text-main text-grays-02">
            ToggleWear is the LaunchDarkly swag store — the sweatshirts, hats,
            tech accessories and everyday merch that turn up at conferences, on
            onboarding desks, and in the post when someone does something good.
            It is run by people who spend their days thinking about releases,
            which is why a shop that sells socks has opinions about rollouts.
          </p>
        </div>
      </section>

      <SectionPanel className="bg-grays-white">
        <div className="flex flex-col gap-12 px-6 pb-16 pt-12 md:px-10 md:pb-20 md:pt-16 xl:px-16 xl:pb-[100px] xl:pt-[75px]">
          <div className="grid grid-cols-1 gap-x-16 gap-y-12 md:grid-cols-2 xl:grid-cols-3">
            {COLUMNS.map(({ heading, body }, index) => (
              <Reveal
                key={heading}
                delay={index * 120}
                className="flex flex-col gap-4"
              >
                <h2 className="font-sora text-h6 font-semibold text-grays-ld-black">
                  {heading}
                </h2>
                <p className="font-sohne text-small text-grays-04">{body}</p>
              </Reveal>
            ))}
          </div>

          <Reveal className="flex flex-col gap-6 border-t border-grays-02 pt-10 sm:flex-row sm:items-center sm:gap-10">
            <Link
              href={categoryHref()}
              className="flex h-12 w-fit items-center justify-center gap-2.5 rounded-[12px] border border-grays-ld-black bg-base-lime pl-4 pr-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-grays-ld-black focus-visible:ring-offset-2"
            >
              <span className="pb-px font-sohne text-main-medium font-medium text-grays-ld-black">
                Shop the current drop
              </span>
              {/* The same cropped arrow the hero's call to action uses. */}
              <span className="relative block size-7 shrink-0 overflow-hidden">
                <img
                  src="/icons/arrow-button.svg"
                  alt=""
                  className="absolute left-[-24.89px] top-[7.78px] h-[11.714px] w-[46.73px] max-w-none"
                />
              </span>
            </Link>

            {/* New tab, like the footer's off-site links: leaving ToggleWear
                mid-demo costs a click to get back. */}
            <a
              href="https://launchdarkly.com/"
              target="_blank"
              rel="noreferrer"
              className="flex w-fit items-center gap-2 font-sohne text-small font-medium text-grays-ld-black"
            >
              Visit launchdarkly.com
              <img
                src="/icons/arrow-link.svg"
                alt=""
                width={15.619}
                height={11.714}
                className="max-w-none"
              />
            </a>
          </Reveal>
        </div>
      </SectionPanel>

      <QuoteBreak />
      {/* Flush, because the quote break above is full-bleed black and already
          brings its own padding. */}
      <DropPromo flushTop />
      <Footer />

      <SwagAssistant />
    </>
  );
}
