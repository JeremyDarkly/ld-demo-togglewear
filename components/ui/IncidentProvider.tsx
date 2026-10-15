import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { LDObserve } from "@launchdarkly/observability";

// The incidents a demo can stage from the account menu, one per flag that
// reacts to trouble on its own:
//
//   payment outage           -> the new processor fails every charge, so
//                               flag 10's kill switch can turn it off
//   card-testing attack      -> a burst of declined cards, so flag 11's kill
//                               switch can turn verification on
//   recommendations outage   -> the personalisation service fails, so flag
//                               12's adaptive trigger can fall back to best
//                               sellers
//
// They are the cause and never the cure. Nothing here changes a flag; the
// storefront only reports what went wrong, LaunchDarkly decides what to do
// about it, and the page changes because the flag did.

// Session storage, so a reload mid-demo does not quietly end an outage, and a
// new tab starts healthy.
const PAYMENT_KEY = "togglewear.incident.payment";
const RECOMMENDATIONS_KEY = "togglewear.incident.recommendations";

// Enough declines that a threshold of ten in a minute is clearly crossed,
// spread out so they read as a run of attempts rather than one spike.
export const CARD_TESTING_ATTEMPTS = 15;
const CARD_TESTING_INTERVAL_MS = 400;

// What a card tester's declines look like: the small charge bots use to see
// whether a stolen card is live, failing for the reasons issuers give.
const DECLINE_REASONS = [
  "do_not_honor",
  "insufficient_funds",
  "card_not_supported",
  "incorrect_cvc",
];

type IncidentApi = {
  paymentOutage: boolean;
  setPaymentOutage: (on: boolean) => void;
  recommendationsOutage: boolean;
  setRecommendationsOutage: (on: boolean) => void;
  // How many of the attack's attempts have been sent, or null when none is
  // running.
  cardTestingSent: number | null;
  simulateCardTesting: () => void;
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
  const [recommendationsOutage, setRecommendationsState] = useState(false);
  const [cardTestingSent, setCardTestingSent] = useState<number | null>(null);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    setPaymentState(readFlag(PAYMENT_KEY));
    setRecommendationsState(readFlag(RECOMMENDATIONS_KEY));
    const pending = timers.current;
    return () => pending.forEach((id) => window.clearTimeout(id));
  }, []);

  const setPaymentOutage = useCallback((on: boolean) => {
    setPaymentState(on);
    writeFlag(PAYMENT_KEY, on);
  }, []);

  const setRecommendationsOutage = useCallback((on: boolean) => {
    setRecommendationsState(on);
    writeFlag(RECOMMENDATIONS_KEY, on);
  }, []);

  const simulateCardTesting = useCallback(() => {
    if (cardTestingSent !== null) return;
    setCardTestingSent(0);
    // Pushed onto the one array rather than replacing it, which is the array
    // the unmount cleanup above holds on to.
    timers.current.length = 0;
    for (let i = 0; i < CARD_TESTING_ATTEMPTS; i++) {
      const id = window.setTimeout(() => {
        const reason = DECLINE_REASONS[i % DECLINE_REASONS.length];
        const error = new Error(`Card declined: ${reason}`);
        error.name = "CardDeclinedError";
        LDObserve.recordError(error, "Card declined at checkout", {
          reason,
          amount: "1.00",
          attempt: String(i + 1),
        });
        const sent = i + 1;
        setCardTestingSent(sent === CARD_TESTING_ATTEMPTS ? null : sent);
      }, i * CARD_TESTING_INTERVAL_MS);
      timers.current.push(id);
    }
  }, [cardTestingSent]);

  return (
    <IncidentContext.Provider
      value={{
        paymentOutage,
        setPaymentOutage,
        recommendationsOutage,
        setRecommendationsOutage,
        cardTestingSent,
        simulateCardTesting,
      }}
    >
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
