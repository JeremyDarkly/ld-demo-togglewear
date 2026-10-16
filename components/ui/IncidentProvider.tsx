import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

// The incident a demo can stage from the account menu: a payment outage, in
// which the new processor fails every charge so flag 12's kill switch can
// turn it off.
//
// It is the cause and never the cure. Nothing here changes a flag; the
// storefront only reports what went wrong, LaunchDarkly decides what to do
// about it, and the page changes because the flag did.
//
// Flags 13 and 14 react to trouble too, but theirs happens behind the store
// rather than in it, so they are started from the demo generator (Cmd+K)
// instead of from here.

// Session storage, so a reload mid-demo does not quietly end an outage, and a
// new tab starts healthy.
const PAYMENT_KEY = "togglewear.incident.payment";

type IncidentApi = {
  paymentOutage: boolean;
  setPaymentOutage: (on: boolean) => void;
};

const IncidentContext = createContext<IncidentApi | null>(null);

function readFlag(key: string) {
  try {
    return window.sessionStorage.getItem(key) === "on";
  } catch {
    return false;
  }
}

function writeFlag(key: string, on: boolean) {
  try {
    if (on) window.sessionStorage.setItem(key, "on");
    else window.sessionStorage.removeItem(key);
  } catch {
    // The state still holds for this page load.
  }
}

export function IncidentProvider({ children }: { children: ReactNode }) {
  const [paymentOutage, setPaymentState] = useState(false);

  useEffect(() => {
    setPaymentState(readFlag(PAYMENT_KEY));
  }, []);

  const setPaymentOutage = useCallback((on: boolean) => {
    setPaymentState(on);
    writeFlag(PAYMENT_KEY, on);
  }, []);

  return (
    <IncidentContext.Provider value={{ paymentOutage, setPaymentOutage }}>
      {children}
    </IncidentContext.Provider>
  );
}

export function useIncidents() {
  const incidents = useContext(IncidentContext);
  if (!incidents) {
    throw new Error("useIncidents must be used inside IncidentProvider");
  }
  return incidents;
}
