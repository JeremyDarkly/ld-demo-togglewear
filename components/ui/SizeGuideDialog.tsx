import { Component, useEffect, useRef, type ErrorInfo, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { LDObserve } from "@launchdarkly/observability";

import { useDialog } from "@/components/ui/useDialog";
import { type SizeChart } from "@/lib/sizeGuide";

// Keeps a size guide that fails to render from taking the product panel down
// with it, and records the error, which React would otherwise keep from the
// observability plugin. The page then says the guide is unavailable instead.
export class SizeGuideBoundary extends Component<
  { productSlug: string; onError: () => void; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    LDObserve.recordError(error, "Size guide failed to open", {
      component: "SizeGuideDialog",
      "product.slug": this.props.productSlug,
      componentStack: info.componentStack ?? "",
    });
    this.props.onError();
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

// The app's first real modal. Jen designed no dialog other than the swag
// assistant panel, so the chrome is borrowed from it — 30px radius, LD Black
// header, the same close glyph — rather than invented.
export default function SizeGuideDialog({
  productName,
  chart,
  onClose,
}: {
  productName: string;
  chart: SizeChart;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useDialog(onClose);

  // Nothing here is focusable except the close button, so the panel itself
  // takes the focus and Escape works without tabbing first.
  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  // Portaled to the body so the dialog does not depend on where it is
  // rendered: the product panel it is opened from sits inside an
  // overflow-hidden rounded card, and one transform anywhere above it would
  // otherwise turn this into a clipped box in the corner of a section.
  //
  // document is safe to touch here because the dialog only ever mounts from a
  // click, so it is never part of a server render.
  return createPortal(
    <div
      // Clicking the backdrop closes; clicking the panel must not, which is
      // what the stopPropagation below is for.
      onClick={onClose}
      className="fixed inset-y-0 left-0 right-[var(--hood-width)] z-50 flex items-center justify-center bg-grays-ld-black/60 p-6"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="size-guide-heading"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-full w-full max-w-[520px] flex-col overflow-hidden rounded-[30px] bg-grays-white shadow-[0_8px_24px_rgba(0,0,0,0.18)] focus-visible:outline-none"
      >
        <header className="flex shrink-0 items-center justify-between gap-3 bg-grays-ld-black px-6 py-4">
          <span
            id="size-guide-heading"
            className="font-geist text-[12px] font-semibold uppercase tracking-[1.2px] text-grays-01"
          >
            Size Guide
          </span>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close size guide"
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

        <div className="flex flex-col gap-5 overflow-y-auto px-6 py-6">
          <p className="font-sohne text-small font-medium text-grays-ld-black">
            {productName}
          </p>

          <table className="w-full border-collapse text-left font-sohne text-small">
            <thead>
              <tr className="border-b border-grays-02">
                <th
                  scope="col"
                  className="pb-2 font-sohne text-xsmall-caps font-medium uppercase text-grays-04"
                >
                  Size
                </th>
                {chart.columns.map((column) => (
                  <th
                    key={column}
                    scope="col"
                    className="pb-2 font-sohne text-xsmall-caps font-medium uppercase text-grays-04"
                  >
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {chart.rows.map(({ size, values }) => (
                <tr key={size} className="border-b border-grays-hairline">
                  <th
                    scope="row"
                    className="py-3 font-medium text-grays-ld-black"
                  >
                    {size}
                  </th>
                  {values.map((value) => (
                    <td key={value} className="py-3 text-grays-04">
                      {value}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>

          <p className="font-sohne text-xsmall text-grays-04">{chart.note}</p>
        </div>
      </div>
    </div>,
    document.body,
  );
}
