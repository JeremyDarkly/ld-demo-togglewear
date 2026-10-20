import { type FeedbackKind } from "@/lib/swagAssistant";

// A thumb, drawn inline for the same reason as the chat panel's expand
// glyphs. Thumbs down is the same path turned over. Shared by the chat's
// replies and the stylist's note, which both record what shoppers thought on
// the AI Config run that wrote them.
const THUMB_PATH =
  "M5 7.5V13H2.5V7.5H5Zm0 5.5h6.3a1.4 1.4 0 0 0 1.37-1.1l.8-3.6A1.4 1.4 0 0 0 12.1 6.6H9.2l.45-2.3a1.2 1.2 0 0 0-2.25-.8L5 7.5";

export default function ThumbButton({
  kind,
  chosen,
  disabled,
  onClick,
}: {
  kind: FeedbackKind;
  chosen: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={chosen}
      aria-label={kind === "positive" ? "Helpful answer" : "Unhelpful answer"}
      className={`rounded-[4px] p-0.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-grays-ld-black ${
        chosen
          ? "text-grays-ld-black"
          : "text-grays-03 enabled:hover:text-grays-ld-black disabled:opacity-40"
      }`}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 16 16"
        aria-hidden="true"
        className={kind === "negative" ? "rotate-180" : undefined}
      >
        <path
          d={THUMB_PATH}
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinejoin="round"
          fill={chosen ? "currentColor" : "none"}
        />
      </svg>
    </button>
  );
}
