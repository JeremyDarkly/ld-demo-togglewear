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
  const setToolbarOn = useCallback((on: boolean) => {
    setToolbarState(on);
    rememberToolbar(on);
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
