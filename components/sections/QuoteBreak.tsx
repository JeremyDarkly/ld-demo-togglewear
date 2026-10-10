import Reveal from "@/components/ui/Reveal";

// Figma "quote break" (63:3647). Unlike the item block and the drop promo,
// this section has no inset white card — the type sits directly on the
// full-bleed LD Black, so it needs no SectionPanel.
//
// At 1440 the design uses 160px side padding, 120px top and bottom, a 32px
// gap above the author line, and caps the quote at 920px. The quote is Web H1
// (the text-h1 token) scaled down on narrower screens so it does not run to
// four or five lines on a phone.
//
// This section is persona-independent: the loyalty homepage instances the
// same component with no variant.
export default function QuoteBreak() {
  return (
    <section className="w-full bg-grays-ld-black">
      <div className="mx-auto flex max-w-[1440px] flex-col items-center gap-8 px-6 py-20 md:px-10 md:py-28 xl:px-40 xl:py-[120px]">
        <Reveal className="w-full max-w-[920px]">
          <p className="text-center font-sora text-[36px] font-bold leading-none tracking-[-1.8px] text-grays-white md:text-[48px] md:tracking-[-2.4px] xl:text-h1">
            {`"Swag that’s built for the team — not just the launch."`}
          </p>
        </Reveal>

        {/* A beat behind the quote, the way an attribution follows the line. */}
        <Reveal delay={200} className="flex items-center gap-3">
          <div className="h-px w-8 shrink-0 bg-grays-02" />
          <p className="font-sohne text-small font-medium text-grays-02">
            ToggleWear Team
          </p>
        </Reveal>
      </div>
    </section>
  );
}
