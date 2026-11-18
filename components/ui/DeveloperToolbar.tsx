import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useLaunchDarklyToolbar } from "@launchdarkly/toolbar/react";
import {
  EventInterceptionPlugin,
  FlagOverridePlugin,
} from "@launchdarkly/toolbar/plugins";

// LaunchDarkly's developer toolbar, switched on from the account menu. It
// shows the flags and events of this browser's SDK and can override a flag
// for this browser alone, without touching its targeting in LaunchDarkly.
//
// Off unless asked for, because it is a developer's tool laid over the shop,
// and a demo is mostly about what a shopper sees. Bottom-left because the
// swag assistant's launcher has the bottom-right.
//
// Overrides only reach flags the browser evaluates. Flag 05, the generator's
// scenarios and the AI Configs are evaluated by the Node SDK on the server and
// can't be overridden from here.
//
// The toolbar itself is loaded from LaunchDarkly's CDN when it is switched
// on. Away from localhost it only works on domains the organisation has
// allowed, under Integrations > LaunchDarkly Developer Toolbar.

// Both have to be handed to the client when it is created, which is why they
// are made once here and LaunchDarklyProvider imports them.
const OVERRIDE_NAMESPACE = "togglewear.toolbar.override";
export const flagOverridePlugin = new FlagOverridePlugin({
  storageNamespace: OVERRIDE_NAMESPACE,
});
export const eventInterceptionPlugin = new EventInterceptionPlugin();

// Session storage like the incidents, so a reload keeps it open and a new tab
// starts as a shopper would see it.
const TOOLBAR_KEY = "togglewear.toolbar";

function toolbarRemembered() {
  try {
    return window.sessionStorage.getItem(TOOLBAR_KEY) === "on";
  } catch {
    return false;
  }
}

function rememberToolbar(on: boolean) {
  try {
    if (on) window.sessionStorage.setItem(TOOLBAR_KEY, "on");
    else window.sessionStorage.removeItem(TOOLBAR_KEY);
  } catch {
    // The toolbar still opens for this page load.
  }
}

// The plugin keeps overrides in local storage and reapplies them whenever the
// client starts, toolbar or no toolbar. Left there, an override from one demo
// would quietly change the next with nothing on screen to explain it.
function clearStoredOverrides() {
  try {
    const prefix = `${OVERRIDE_NAMESPACE}:`;
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key?.startsWith(prefix)) keys.push(key);
    }
    keys.forEach((key) => window.localStorage.removeItem(key));
  } catch {
    // Nothing stored that could be reapplied.
  }
}

// Called by LaunchDarklyProvider just before it creates the client.
export function dropOverridesUnlessToolbarOn() {
  if (!toolbarRemembered()) clearStoredOverrides();
}

type DeveloperToolbarApi = {
  toolbarOn: boolean;
  setToolbarOn: (on: boolean) => void;
};

const DeveloperToolbarContext = createContext<DeveloperToolbarApi | null>(null);

// The toolbar's own show and hide, which it puts on window once it is mounted.
// It saves the hidden state to local storage under this key and reads it back
// when it mounts.
type ToolbarControls = { enable: () => void; disable: () => void };
const HIDDEN_KEY = "ld-toolbar-disabled";

function toolbarControls() {
  return (window as Window & { ldToolbar?: ToolbarControls }).ldToolbar;
}

// What switching the toolbar on or off means for the flags, since an
// override that outranks LaunchDarkly looks like a broken environment to
// anyone who forgets it is there. Shown from either switch.
const TOOLBAR_WINS = "Toolbar changes win over LaunchDarkly until you turn it off.";

// The same reminder, kept under each switch for as long as the toolbar is on.
export function ToolbarWinsNote() {
  return (
    <p className="animate-fade-in flex items-center gap-2.5 rounded-xl border-l-4 border-base-lime bg-base-lime/25 px-3 py-2 font-sohne text-xsmall font-medium text-grays-ld-black">
      <span
        aria-hidden
        className="shrink-0 rounded-full bg-base-lime px-1.5 py-0.5 font-sohne-mono text-xsmall-mono"
      >
        {"</>"}
      </span>
      {TOOLBAR_WINS}
    </p>
  );
}

const NOTICES = {
  on: {
    title: "Developer toolbar on",
    body: "Flags you change in the toolbar win over LaunchDarkly. If you change one of those flags in LaunchDarkly, it won't show here until you turn the toolbar off. All other flags still follow LaunchDarkly.",
    ms: 15_000,
  },
  off: {
    title: "Developer toolbar off",
    body: "Your toolbar changes are cleared. Flags follow LaunchDarkly again.",
    ms: 10_000,
  },
};

type Notice = { kind: keyof typeof NOTICES; id: number };

const FADE_OUT_MS = 300;

// Top right, clear of the toolbar (bottom-left), the swag assistant
// (bottom-right) and Under the hood. Lime-edged so it stands out against the
// black header it overlaps. Holds still while the pointer is on it, and
// fades out rather than vanishing.
function ToolbarNotice({ notice, onClose }: { notice: Notice; onClose: () => void }) {
  const [held, setHeld] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const { title, body, ms } = NOTICES[notice.kind];

  useEffect(() => {
    if (held || leaving) return;
    const timer = window.setTimeout(() => setLeaving(true), ms);
    return () => window.clearTimeout(timer);
  }, [held, leaving, ms]);

  useEffect(() => {
    if (!leaving) return;
    const timer = window.setTimeout(onClose, FADE_OUT_MS);
    return () => window.clearTimeout(timer);
  }, [leaving, onClose]);

  return (
    <div
      role="status"
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      className={`animate-fade-in fixed right-[calc(24px_+_var(--hood-width))] top-24 z-50 flex w-[min(380px,calc(100vw_-_48px))] items-start gap-3 rounded-2xl border-2 border-base-lime bg-grays-ld-black p-4 text-grays-white shadow-[0_8px_32px_rgba(221,255,70,0.18),0_8px_24px_rgba(0,0,0,0.3)] transition-[opacity,transform] duration-300 ease-out motion-reduce:transition-none ${
        leaving ? "-translate-y-1 opacity-0" : "opacity-100"
      }`}
    >
      <span
        aria-hidden
        className="mt-0.5 flex shrink-0 items-center rounded-full bg-base-lime px-2 py-1 font-sohne-mono text-xsmall-mono text-grays-ld-black"
      >
        {"</>"}
      </span>
      <div className="flex-1">
        <p className="font-sohne text-small font-medium">{title}</p>
        <p className="mt-1 font-sohne text-xsmall text-grays-02">{body}</p>
      </div>
      <button
        type="button"
        onClick={() => setLeaving(true)}
        aria-label="Close"
        className="-mr-1 -mt-1 rounded-full px-2 py-0.5 font-sohne text-small text-grays-03 transition-colors hover:bg-grays-06 hover:text-grays-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-grays-white"
      >
        ×
      </button>
    </div>
  );
}

export function DeveloperToolbarProvider({ children }: { children: ReactNode }) {
  const [toolbarOn, setToolbarState] = useState(false);
  // Mounted the first time it is switched on and never unmounted after that:
  // version 2.3.1 keeps only one of its stylesheets when it is mounted a
  // second time on the same page, and comes back see-through with its layout
  // collapsed. Switching it off hides it instead.
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setToolbarState(toolbarRemembered());
  }, []);

  useEffect(() => {
    if (!toolbarOn || mounted) return;
    // Hidden on an earlier page load would otherwise keep it hidden now.
    try {
      window.localStorage.removeItem(HIDDEN_KEY);
    } catch {
      // Nothing saved to undo.
    }
    setMounted(true);
  }, [toolbarOn, mounted]);

  useLaunchDarklyToolbar({
    flagOverridePlugin,
    eventInterceptionPlugin,
    // Names the project and the environment both, so the flags it lists are
    // the ones this storefront is evaluating.
    clientSideId: process.env.NEXT_PUBLIC_LD_CLIENT_KEY,
    position: "bottom-left",
    enabled: mounted,
  });

  // Closing it puts every flag back to what LaunchDarkly serves, straight
  // away rather than on the next reload.
  const [notice, setNotice] = useState<Notice | null>(null);
  const closeNotice = useCallback(() => setNotice(null), []);

  const setToolbarOn = useCallback((on: boolean) => {
    setToolbarState(on);
    rememberToolbar(on);
    setNotice({ kind: on ? "on" : "off", id: Date.now() });
    if (on) {
      toolbarControls()?.enable();
      return;
    }
    toolbarControls()?.disable();
    if (flagOverridePlugin.getClient()) flagOverridePlugin.clearAllOverrides();
    clearStoredOverrides();
  }, []);

  return (
    <DeveloperToolbarContext.Provider value={{ toolbarOn, setToolbarOn }}>
      {children}
      {notice && <ToolbarNotice key={notice.id} notice={notice} onClose={closeNotice} />}
    </DeveloperToolbarContext.Provider>
  );
}

export function useDeveloperToolbar() {
  const toolbar = useContext(DeveloperToolbarContext);
  if (!toolbar) {
    throw new Error("useDeveloperToolbar must be used inside DeveloperToolbarProvider");
  }
  return toolbar;
}
