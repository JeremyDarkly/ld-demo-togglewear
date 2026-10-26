// Figma "AI swag assistant chat" (63:3692) — the collapsed launcher for the
// swag assistant. Jen places it outside the page scroll frame, 30px from the
// right edge and 25px up from the bottom of the viewport, so it is fixed
// rather than part of any section.
//
// It sits below the persona switcher in the stacking order so that dev
// control stays reachable.
export default function ChatLauncher({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Open swag assistant"
      className="fixed bottom-[25px] right-[calc(30px_+_var(--hood-width))] z-40 flex items-center gap-2.5 rounded-full bg-base-blue px-5 py-3 text-grays-01 shadow-[0_8px_8px_rgba(0,0,0,0.1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-grays-white focus-visible:ring-offset-2"
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
        className="shrink-0"
      >
        <path
          d="M2.05665 11.6727C2.11384 11.4129 2.09201 11.1419 1.99398 10.8946C1.31177 9.47916 1.15142 7.86822 1.54121 6.34605C1.931 4.82388 2.84588 3.48828 4.12444 2.57491C5.403 1.66154 6.96308 1.22909 8.52942 1.35386C10.0958 1.47863 11.5677 2.1526 12.6855 3.25687C13.8034 4.36113 14.4953 5.82471 14.6392 7.3894C14.7831 8.95409 14.3697 10.5193 13.472 11.8089C12.5743 13.0985 11.25 14.0297 9.73269 14.438C8.21538 14.8464 6.6026 14.7057 5.1789 14.0409C4.94523 13.9521 4.69134 13.9309 4.44617 13.9795L2.17066 14.6449C2.06089 14.674 1.9455 14.6746 1.83543 14.6467C1.72536 14.6187 1.62426 14.5631 1.54172 14.4851C1.45918 14.4071 1.39793 14.3093 1.36378 14.201C1.32963 14.0926 1.32372 13.9774 1.3466 13.8662L2.05665 11.6727Z"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>

      <span className="font-geist text-[12px] font-semibold uppercase leading-normal tracking-[1.2px]">
        Swag Assistant
      </span>
    </button>
  );
}
