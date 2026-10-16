import { useState } from "react";
import Image from "next/image";
import { useFlags } from "launchdarkly-react-client-sdk";

// Imported rather than referenced by path like the product photos are. A
// string path is a stable URL, so re-exporting this image leaves every
// browser that has seen it serving the old bytes — which is exactly what
// happened while it was being cropped. An import gets a content-hashed
// filename instead, so the URL changes whenever the image does.
import referralArt from "@/public/images/referral.png";
import referralTeeArt from "@/public/images/referral-tee.jpg";

import { useShopper } from "@/components/ui/ShopperProvider";
import { REFERRAL, referralLinkFor, type ReferralOffer } from "@/lib/account";
import { EVENTS, useTrack } from "@/lib/events";

// Flag 11, an experiment: which offer the card makes, each in its own Jen
// design. The control is her original dark card with $20 each way; the
// treatment is her second, lighter card offering a free tee to both people.
// Measured on how many shoppers copy their link.
export default function ReferralCard() {
  const [copied, setCopied] = useState(false);
  const { referralOffer } = useFlags();
  const offer: ReferralOffer = referralOffer === "free-tee" ? "free-tee" : "store-credit";
  const track = useTrack();
  // A referral link that credits the wrong shopper is worse than no link, so
  // it is built from whoever is signed in rather than being a constant.
  const { person } = useShopper();
  const link = referralLinkFor(person);

  async function copyLink() {
    // Counted on the click rather than on the clipboard write: the shopper
    // chose to share either way, and a blocked clipboard is the browser's
    // doing, not the offer's.
    track(EVENTS.referralLinkCopied, { offer });
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access needs a secure context and can be denied outright;
      // the link is on screen and selectable either way.
    }
  }

  const Panel = offer === "free-tee" ? FreeTeePanel : StoreCreditPanel;

  return (
    <section className="flex flex-col gap-5">
      <h2 className="font-sohne text-h6 font-medium text-grays-ld-black">
        Share the Swag
      </h2>

      <Panel offer={offer} link={link} copied={copied} onCopy={copyLink} />
    </section>
  );
}

type PanelProps = {
  offer: ReferralOffer;
  link: string;
  copied: boolean;
  onCopy: () => void;
};

// Figma "Referrals Container" (78:1649).
//
// The left panel is Jen's gradient, sampled from her render at #855ee7 to
// #5b67f5, with the cut-out she composed over it — pulled from her file,
// trimmed to the pair, and cut off mid-shirt the way she frames it. Showing
// the figures all the way down to the jeans fit them inside the panel with
// room to spare, which read as zoomed out next to her version; cropping where
// she does is what lets them fill it.
//
// Her two arrow marks are baked into the image rather than laid over it, so
// they stay on the shirts at every panel size instead of needing coordinates
// that only hold at one width. The larger mark is on the nearer figure, as
// she has it.
//
// The photo itself is still a stock placeholder rather than ToggleWear's own
// art, so this panel remains a Jen ask.
function StoreCreditPanel({ offer, link, copied, onCopy }: PanelProps) {
  return (
    <div className="flex flex-col overflow-hidden rounded-[12px] bg-grays-ld-black lg:flex-row">
      {/* contain rather than cover, because the pair is a portrait cut-out
          in a panel that is wider than it is tall: covering would crop them
          to a band of torsos. Bottom-anchored so they stand on the panel's
          edge the way Jen has them, instead of floating in the middle. */}
      <div className="relative h-40 shrink-0 overflow-hidden bg-gradient-to-br from-[#855ee7] to-[#5b67f5] lg:h-auto lg:w-[320px]">
        <Image
          src={referralArt}
          alt=""
          fill
          sizes="320px"
          className="object-contain object-bottom"
        />
      </div>

      <div className="flex flex-1 flex-col justify-between gap-10 p-10">
        <div className="flex flex-col gap-5">
          <p className="font-sohne text-h4 font-medium text-grays-white">
            {REFERRAL[offer].headline}
          </p>
          <p className="font-sohne text-small text-grays-03">
            {REFERRAL[offer].description}
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <p className="min-w-0 flex-1 truncate rounded-[6px] bg-grays-06 px-4 py-3 font-sohne text-small text-grays-03">
            {link}
          </p>
          <button
            type="button"
            onClick={onCopy}
            className="flex shrink-0 items-center justify-center gap-2 rounded-[6px] bg-base-lime px-6 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-base-lime focus-visible:ring-offset-2 focus-visible:ring-offset-grays-ld-black"
          >
            <img
              src="/icons/copy.svg"
              alt=""
              width={16}
              height={16}
              className="shrink-0 max-w-none"
            />
            <span className="font-sohne text-small font-medium text-grays-ld-black">
              {copied ? "Copied" : "Copy Link"}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

// Figma "Referrals Card Design 2" (160:1527).
//
// Jen drew it with the $20 copy; the tee offer is the experiment's change, set
// in her layout. The photo is her crop of the pair at the window, with both
// arrow marks baked in for the same reason as the dark card's: a dark mark on
// his white tee, and a light one blended into her black tee.
//
// Her art sits to the right of the copy at 320 wide. Below lg it moves above
// the copy as a band, like the dark card's, framed on the faces.
function FreeTeePanel({ offer, link, copied, onCopy }: PanelProps) {
  return (
    <div className="flex flex-col overflow-hidden rounded-[12px] bg-grays-white lg:flex-row">
      <div className="flex flex-1 flex-col justify-between gap-10 p-10">
        <div className="flex flex-col gap-[25px]">
          <p className="font-sora text-[28px] font-semibold leading-[1.05] tracking-[-1.4px] text-grays-ld-black md:text-h3">
            {REFERRAL[offer].headline}
          </p>
          <p className="max-w-[363px] font-sohne text-small text-grays-05">
            {REFERRAL[offer].description}
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
          <p className="min-w-0 flex-1 truncate rounded-[6px] border border-grays-03 bg-grays-01 px-4 py-3 font-sohne text-small text-grays-05">
            {link}
          </p>
          <button
            type="button"
            onClick={onCopy}
            className="flex shrink-0 items-center justify-center gap-2 rounded-[6px] bg-grays-ld-black px-6 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-grays-ld-black focus-visible:ring-offset-2"
          >
            <img
              src="/icons/copy-white.svg"
              alt=""
              width={16}
              height={16}
              className="shrink-0 max-w-none"
            />
            <span className="font-sohne text-small font-medium text-grays-white">
              {copied ? "Copied" : "Copy Link"}
            </span>
          </button>
        </div>
      </div>

      <div className="relative order-first h-40 shrink-0 overflow-hidden lg:order-none lg:h-auto lg:w-[320px]">
        <Image
          src={referralTeeArt}
          alt=""
          fill
          sizes="(min-width: 1024px) 320px, 100vw"
          className="object-cover object-[50%_10%] lg:object-top"
        />
      </div>
    </div>
  );
}
