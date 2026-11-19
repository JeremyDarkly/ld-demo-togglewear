import { useEffect, useState } from "react";
import { isEventStore } from "@/lib/eventStore";

// Marketing's event follow-up form. The utm_term names the event, so it needs
// changing when the booth moves to a different conference.
const BOOK_MEETING_URL =
  "https://launchdarkly.com/event-follow-up/?utm_source=event&utm_medium=meetingrequested&utm_campaign=pltf&utm_term=awsreinv25";
const LEARN_MORE_URL = "https://launchdarkly.com/";

// The booth's way out to LaunchDarkly, beside the hero's call to action in
// the event stores. Outlined rather than lime so the shop's own button stays
// the first thing the eye lands on.
export default function EventLinks() {
  const [shown, setShown] = useState(false);
  useEffect(() => setShown(isEventStore()), []);
  if (!shown) return null;

  return (
    <>
      <a
        href={BOOK_MEETING_URL}
        target="_blank"
        rel="noreferrer"
        className="flex h-12 w-fit items-center justify-center gap-2.5 rounded-[12px] border border-grays-white pl-4 pr-3 hover:bg-grays-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-grays-white focus-visible:ring-offset-2 focus-visible:ring-offset-grays-ld-black"
      >
        <span className="pb-px font-sohne text-main-medium font-medium text-grays-white">
          Book a meeting
        </span>
        {/* The hero's arrow, inverted to white. */}
        <span className="relative block size-7 shrink-0 overflow-hidden">
          <img
            src="/icons/arrow-button.svg"
            alt=""
            className="absolute left-[-24.89px] top-[7.78px] h-[11.714px] w-[46.73px] max-w-none invert"
          />
        </span>
      </a>
      <a
        href={LEARN_MORE_URL}
        target="_blank"
        rel="noreferrer"
        className="flex h-12 items-center font-sohne text-main-medium font-medium text-grays-02 hover:text-grays-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-grays-white"
      >
        Learn more ↗
      </a>
    </>
  );
}
