import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import ArchitectureTab from "@/components/hood/ArchitectureTab";
import CodeTab from "@/components/hood/CodeTab";
import DemoToolsTab from "@/components/hood/DemoToolsTab";
import LiveTab from "@/components/hood/LiveTab";

// Under the hood: the panel an SE opens beside the store to show what the
// store is doing in LaunchDarkly. ToggleBank spreads the same jobs over a
// sidebar terminal, a menu of code and architecture pages and a Demo Tools
// button; here they are the four tabs of one panel.
//
// It sits beside the page rather than over it, with no dim and no focus
// trap, because the point of the Live tab is to watch it while clicking
// around the store. It is owned above the pages so it stays open, on the
// same tab, through every page change.

export type HoodTab = "live" | "code" | "architecture" | "tools";

const TABS: { id: HoodTab; label: string }[] = [
  { id: "live", label: "Live" },
  { id: "code", label: "Code" },
  { id: "architecture", label: "Architecture" },
  { id: "tools", label: "Demo tools" },
];

// Session storage like the incidents: a reload mid-demo keeps the panel
// where it was, and a new tab starts with just the store.
const STORAGE_KEY = "togglewear.hood";

type HoodApi = {
  open: boolean;
  toggle: () => void;
  close: () => void;
};

const HoodContext = createContext<HoodApi | null>(null);

function readSaved(): { open: boolean; tab: HoodTab } {
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) ?? "null");
    if (saved && TABS.some((t) => t.id === saved.tab)) {
      return { open: Boolean(saved.open), tab: saved.tab };
    }
  } catch {
    // Nothing usable saved.
  }
  return { open: false, tab: "live" };
}

export function UnderTheHoodProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<HoodTab>("live");
  // State rather than a ref, so saving waits for the render that has the
  // restored values instead of writing the defaults over them.
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    const saved = readSaved();
    setOpen(saved.open);
    setTab(saved.tab);
    setRestored(true);
  }, []);

  useEffect(() => {
    if (!restored) return;
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ open, tab }));
    } catch {
      // The panel still works for this page load.
    }
  }, [open, tab, restored]);

  const toggle = useCallback(() => setOpen((was) => !was), []);
  const close = useCallback(() => setOpen(false), []);

  return (
    <HoodContext.Provider value={{ open, toggle, close }}>
      {children}
      {open && <HoodPanel tab={tab} onTab={setTab} onClose={close} />}
    </HoodContext.Provider>
  );
}

export function useUnderTheHood() {
  const hood = useContext(HoodContext);
  if (!hood) throw new Error("useUnderTheHood must be used inside UnderTheHoodProvider");
  return hood;
}

function HoodPanel({
  tab,
  onTab,
  onClose,
}: {
  tab: HoodTab;
  onTab: (tab: HoodTab) => void;
  onClose: () => void;
}) {
  // Escape closes it unless something on top (the generator, the search
  // panel) is open and wants the key for itself.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <aside
      aria-label="Under the hood"
      // Below the generator (z-60), which can be opened from inside it, and
      // above the header (z-50) and the swag assistant (z-40).
      className="animate-slide-in-right fixed inset-y-0 right-0 z-[55] flex w-full max-w-[620px] flex-col bg-grays-white shadow-[0_8px_32px_rgba(0,0,0,0.28)]"
    >
      <header className="flex shrink-0 flex-col gap-4 bg-grays-ld-black px-6 pb-0 pt-5">
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2.5">
            <img src="/icons/ld-logo-white.svg" alt="" width={16} height={16} />
            <span className="font-geist text-[12px] font-semibold uppercase tracking-[1.2px] text-grays-01">
              Under the hood
            </span>
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Under the hood"
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
        </div>

        <div role="tablist" aria-label="Under the hood" className="-mb-px flex gap-1">
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`hood-tab-${id}`}
              aria-selected={tab === id}
              aria-controls={`hood-panel-${id}`}
              onClick={() => onTab(id)}
              className={`rounded-t-[12px] px-4 py-2.5 font-sohne text-small font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-base-lime ${
                tab === id
                  ? "bg-grays-white text-grays-ld-black"
                  : "text-grays-03 hover:text-grays-white"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      <div
        role="tabpanel"
        id={`hood-panel-${tab}`}
        aria-labelledby={`hood-tab-${tab}`}
        className="flex min-h-0 flex-1 flex-col"
      >
        {tab === "live" && <LiveTab />}
        {tab === "code" && <CodeTab />}
        {tab === "architecture" && <ArchitectureTab />}
        {tab === "tools" && <DemoToolsTab />}
      </div>
    </aside>
  );
}
