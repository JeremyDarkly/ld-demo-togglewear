import { useState } from "react";
import { createPortal } from "react-dom";

import { useDialog } from "@/components/ui/useDialog";
import { SHIPMENT_STAGES, type PastOrder } from "@/lib/account";
import { formatDeliveryDate } from "@/lib/order";

// Opened by the one button on an order card, which reads "Track package
// delivery" on a live shipment and "View delivery summary" on a delivered
// one. Both land here: what differs is how far along the rail the parcel is,
// which is a better reason for two labels than two components would be.
//
// Chrome borrowed from the size guide, the app's dialog precedent. The order
// card underneath already lists the products with photos and prices, so they
// are deliberately not repeated — they would be the largest block of content
// here and the least new information.
export default function ShipmentDialog({
  order,
  onClose,
}: {
  order: PastOrder;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  useDialog(onClose);

  // A tracking number exists to be pasted into a carrier's own site, so it
  // gets the referral link's copy treatment rather than being left as text
  // to select by hand.
  async function copyTracking() {
    try {
      await navigator.clipboard.writeText(order.tracking);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access needs a secure context and can be denied outright;
      // the number is on screen and selectable either way.
    }
  }

  // The stages the parcel has cleared, then the ones it has not. An unreached
  // stage is drawn hollow and dateless, which is what shows the distance
  // left — listing only the cleared stages made a parcel sitting in Reno look
  // like a finished three-step journey.
  const stages = [
    ...order.events.map((event, i) => ({
      ...event,
      reached: true,
      current: i === order.events.length - 1,
    })),
    ...SHIPMENT_STAGES.slice(order.events.length).map((label) => ({
      label,
      on: "",
      where: "",
      reached: false,
      current: false,
    })),
  ];

  const delivered = order.events.length === SHIPMENT_STAGES.length;

  return createPortal(
    <div
      onClick={onClose}
      className="animate-fade-in fixed inset-y-0 left-0 right-[var(--hood-width)] z-50 flex items-center justify-center bg-grays-ld-black/60 p-6"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="shipment-heading"
        onClick={(event) => event.stopPropagation()}
        className="animate-drop-in flex max-h-full w-full max-w-[520px] flex-col overflow-hidden rounded-[30px] bg-grays-white shadow-[0_8px_24px_rgba(0,0,0,0.18)]"
      >
        <header className="flex shrink-0 items-center justify-between gap-3 bg-grays-ld-black px-6 py-4">
          <span className="font-geist text-[12px] font-semibold uppercase tracking-[1.2px] text-grays-01">
            {order.ref}
          </span>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close shipment details"
            className="text-grays-03 transition-colors hover:text-grays-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-grays-white"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path
                d="M4 4l8 8M12 4l-8 8"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                fill="none"
              />
            </svg>
          </button>
        </header>

        <div className="flex flex-col overflow-y-auto">
          {/* The answer first. This is the one thing anyone opens tracking to
              find out, and it used to be buried as the date on the last row
              of the rail. */}
          <div className="flex flex-col gap-1.5 px-6 pb-6 pt-6">
            <p className="font-sohne text-xsmall-caps font-medium uppercase text-grays-04">
              {delivered ? "Delivered" : "Arriving"}
            </p>
            <h2
              id="shipment-heading"
              className="font-sohne text-h6 font-medium text-grays-ld-black"
            >
              {formatDeliveryDate(order.arrivesOn)}
            </h2>
            <p className="font-sohne text-small text-grays-04">
              {delivered ? "to" : "on its way to"} {order.destination}
            </p>
          </div>

          <div className="mx-6 h-px bg-grays-hairline" />

          <ol className="flex flex-col px-6 py-6">
            {stages.map((stage, i) => {
              const last = i === stages.length - 1;
              // Lighten the joint as soon as it leads somewhere the parcel
              // has not been, so the rail visibly fades out ahead of it.
              const nextReached = stages[i + 1]?.reached;

              return (
                <li key={stage.label} className="flex gap-4">
                  {/* Fixed-size box so dots of different sizes still centre
                      on one axis, and on the first line of their label. */}
                  <div className="flex flex-col items-center">
                    <div className="flex h-5 w-3 shrink-0 items-center justify-center">
                      {stage.current ? (
                        // A halo rather than just a colour: where the parcel
                        // is now should be findable at a glance.
                        <span className="size-3 rounded-full bg-accent-purple ring-4 ring-accent-purple/20" />
                      ) : stage.reached ? (
                        <span className="size-2.5 rounded-full bg-grays-03" />
                      ) : (
                        <span className="size-2.5 rounded-full border border-grays-02 bg-grays-white" />
                      )}
                    </div>

                    {!last && (
                      <span
                        className={`w-px flex-1 ${
                          nextReached ? "bg-grays-02" : "bg-grays-hairline"
                        }`}
                      />
                    )}
                  </div>

                  <div
                    className={`flex flex-col gap-1 ${last ? "" : "pb-6"}`}
                  >
                    <p
                      className={`font-sohne text-small ${
                        stage.current
                          ? "font-medium text-grays-ld-black"
                          : stage.reached
                            ? "text-grays-04"
                            : "text-grays-03"
                      }`}
                    >
                      {stage.label}
                    </p>
                    {/* No second line on a stage still to come. The missing
                        date is the point: it is not a promise we are making. */}
                    {stage.reached && (
                      <p className="font-sohne text-xsmall text-grays-04">
                        {stage.on} · {stage.where}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>

          {/* Reference data rather than the answer, so it sits at the foot of
              the panel on the grey Jen uses for the cart's estimator strip. */}
          <div className="flex items-center justify-between gap-4 bg-grays-01 px-6 py-5">
            <div className="flex min-w-0 flex-col gap-1">
              <p className="font-sohne text-xsmall text-grays-04">
                {order.carrier}
              </p>
              {/* Mono, because a tracking number is read a character at a
                  time rather than as a word. */}
              <p className="truncate font-sohne-mono text-xsmall-mono text-grays-ld-black">
                {order.tracking}
              </p>
            </div>

            <button
              type="button"
              onClick={copyTracking}
              className="flex shrink-0 items-center gap-2 rounded-[6px] border border-grays-02 bg-grays-white px-4 py-2.5 transition-colors hover:border-grays-04 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-grays-ld-black focus-visible:ring-offset-2"
            >
              <img
                src={copied ? "/icons/check.svg" : "/icons/copy.svg"}
                alt=""
                width={16}
                height={16}
                className="shrink-0 max-w-none"
              />
              <span className="font-sohne text-small font-medium text-grays-ld-black">
                {copied ? "Copied" : "Copy"}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
