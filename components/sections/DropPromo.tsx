import Image from "next/image";
import Link from "next/link";

import SectionPanel from "@/components/layout/SectionPanel";
import Reveal from "@/components/ui/Reveal";
import { categoryHref } from "@/lib/products";

// Figma "the drop pomo" (63:3648). A white panel split into an 820px photo
// and a 600px content column at 1440, stacking below xl.
//
// Persona-independent: the loyalty homepage instances the same component with
// no variant.
//
// The photo is a transparent cutout sitting on a Gray 02 panel, and Jen crops
// it hard — the model is placed at 1691x2537 inside an 820x530 window at
// (-478, -990), so only the band from his forehead to his waist shows. That is
// roughly 2x tighter than object-cover would be, so object-position cannot
// reproduce it. Instead the offsets below are expressed relative to the
// container width and the image's own height, which holds the crop at any
// size. The crop is load-bearing: it is what places the LD mark on the cap.
// flushTop is the page's call rather than this component's, for the same
// reason as the product detail panel: it depends on what sits above. A
// full-bleed black section brings its own padding and the inset would double
// up; another panel above keeps its own 10px frame, and the two together read
// as the gap between the cards.
export default function DropPromo({ flushTop = false }: { flushTop?: boolean }) {
  return (
    <SectionPanel
      flushTop={flushTop}
      className="bg-grays-white flex flex-col xl:h-[530px] xl:flex-row"
    >
      <div className="relative aspect-[820/530] w-full overflow-hidden bg-grays-02 xl:aspect-auto xl:h-full xl:flex-1">
        <Image
          src="/images/drop-model.png"
          alt="Model wearing a ToggleWear trucker cap and white tee"
          width={2731}
          height={4096}
          sizes="(min-width: 1280px) 1691px, 207vw"
          className="absolute left-[-58.29%] top-0 w-[206.22%] max-w-none translate-y-[-39.02%]"
        />

        {/* The mark on the cap. Jen rotates a 46px glyph inside a 65px box,
            which is just its rotated bounding box, so the inner width is 71%. */}
        <div className="absolute left-[27.48%] top-[6.64%] flex aspect-square w-[7.92%] items-center justify-center">
          <img
            src="/icons/ld-logo.svg"
            alt=""
            className="w-[71%] max-w-none rotate-[-42.21deg]"
          />
        </div>
      </div>

      {/* Only the copy moves. The photo fills its half of the panel edge to
          edge, so rising into place would open a strip of bare panel under
          it for the length of the animation. */}
      <Reveal className="flex flex-col justify-between gap-12 border-grays-02 p-8 md:p-12 xl:h-full xl:w-[600px] xl:shrink-0 xl:border-l xl:p-16">
        <div className="flex flex-col gap-[30px]">
          <p className="font-sohne text-small font-medium text-grays-04">
            The Drop
          </p>

          <h2 className="font-sora text-[32px] font-semibold leading-[1.05] tracking-[-1.6px] text-grays-ld-black md:text-[44px] md:tracking-[-2.2px] xl:text-h2">
            Fresh drops, every season.
          </h2>

          <p className="font-sohne text-main text-grays-04">
            Sweatshirts, hats, tech accessories, and everyday swag — all
            designed to be worn, shared, and shipped fast.
          </p>
        </div>

        {/* New drops rather than the whole catalogue, since that is what the
            copy above it promises. */}
        <Link
          href={categoryHref("new")}
          className="flex w-fit items-center gap-2 font-sohne text-small font-medium text-grays-ld-black"
        >
          Shop new arrivals
          <img
            src="/icons/arrow-link.svg"
            alt=""
            width={15.619}
            height={11.714}
            className="max-w-none"
          />
        </Link>
      </Reveal>
    </SectionPanel>
  );
}
