import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useFlags, useLDClient } from "launchdarkly-react-client-sdk";
import { LDObserve } from "@launchdarkly/observability";

import { useShopper } from "@/components/ui/ShopperProvider";
import { ordersFor, type PastOrder } from "@/lib/account";
import { apiHeaders } from "@/lib/api";
import { productBySlug, type Product } from "@/lib/products";
import {
  SWAG_ASSISTANT_KEY,
  greetingFor,
  servedByFor,
  type ChatMessage,
  type FeedbackKind,
  type LiveVariation,
  type SwagAssistantReply,
} from "@/lib/swagAssistant";

// The parts of the AI Config's flag value the badge needs. The browser gets
// the whole value, prompt included, but only reads which variation it is.
type AiConfigFlag = {
  _ldMeta?: { enabled?: boolean; variationKey?: string };
  model?: { name?: string };
};

// Null until the SDK has the flag, or when LaunchDarkly is not configured,
// so the header shows nothing rather than a guess.
function liveVariationFrom(value: unknown): LiveVariation | null {
  const config = value as AiConfigFlag | undefined;
  if (!config?._ldMeta) return null;
  if (!config._ldMeta.enabled) return "off";
  if (!config._ldMeta.variationKey || !config.model?.name) return null;
  return servedByFor(config._ldMeta.variationKey, config.model.name);
}

function describe(live: LiveVariation) {
  return live === "off" ? "off" : `${live.variation} · ${live.model}`;
}

// Owns whether the assistant is open and what has been said. Both used to
// live in SwagAssistant itself, which meant two things: the conversation was
// thrown away on every page change, and nothing outside that corner of the
// screen could open it — so the cart's Contact Swag Support link had nowhere
// to point.
//
// The persona is read here rather than taken as a prop, because every page
// was passing the same useShopper() value down and the greeting is the only
// reason the assistant needed it.
type SwagAssistantApi = {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  messages: ChatMessage[];
  send: (text: string) => void;
  // A reply is on its way. The panel shows the assistant typing and holds
  // the next question until it lands, so the history stays in order.
  pending: boolean;
  rate: (messageId: string, kind: FeedbackKind) => void;
  // The variation LaunchDarkly would serve this shopper now. It changes the
  // moment targeting does, without waiting for the next question.
  live: LiveVariation | null;
  // Back to the state it has on first open, greeting and suggested prompts
  // included, so the same demo can be run again for the next prospect
  // without reloading the page.
  reset: () => void;
  // Whether the panel is at its larger size. Kept here rather than in the
  // panel so it survives both closing and a page change, for the same reason
  // the conversation does.
  expanded: boolean;
  toggleExpanded: () => void;
  // Whether the products the assistant recommends show member pricing, which
  // is the same multi-context story the rest of the page tells.
  memberPricing: boolean;
};

const SwagAssistantContext = createContext<SwagAssistantApi | null>(null);

const FAILED_TEXT =
  "Sorry, I couldn't come up with an answer just now. Try asking again in a moment.";

export function SwagAssistantProvider({ children }: { children: ReactNode }) {
  const { persona, person } = useShopper();
  const client = useLDClient();
  const [isOpen, setIsOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState(false);
  // The history to send has to be the one on screen when the question was
  // asked, which a state setter cannot hand back synchronously.
  const messagesRef = useRef<ChatMessage[]>([]);
  messagesRef.current = messages;
  // Bumped by reset, so a reply still in flight from the conversation that
  // was just thrown away does not land in the new one.
  const conversationRef = useRef(0);

  const live = liveVariationFrom(useFlags()[SWAG_ASSISTANT_KEY]);
  const liveLabel = live ? describe(live) : null;
  const liveRef = useRef(live);
  liveRef.current = live;
  const previousLabelRef = useRef(liveLabel);

  // A switch mid-conversation also gets a line in the conversation itself,
  // so a room watching the shared screen sees it happen. Not before anything
  // has been asked, when the header badge alone says it.
  useEffect(() => {
    const previous = previousLabelRef.current;
    previousLabelRef.current = liveLabel;
    const now = liveRef.current;
    if (!previous || !now || previous === liveLabel) return;
    if (messagesRef.current.length < 2) return;

    const notice: ChatMessage = {
      id: `notice-${Date.now()}`,
      role: "assistant",
      notice: true,
      text:
        now === "off"
          ? "The AI Config was switched off, so replies are scripted for now"
          : `Now answering with ${now.variation} · ${now.model}`,
    };
    setMessages((prev) => [...prev, notice]);
  }, [liveLabel]);

  const open = useCallback(() => {
    // Seeded on first open rather than on mount, so switching persona before
    // opening still produces the right greeting.
    setMessages((prev) => (prev.length === 0 ? [greetingFor(persona)] : prev));
    setIsOpen(true);
  }, [persona]);

  const close = useCallback(() => setIsOpen(false), []);

  const send = useCallback(
    async (text: string) => {
      const user: ChatMessage = {
        id: `user-${Date.now()}`,
        role: "user",
        text,
      };
      const history = [...messagesRef.current, user]
        .filter((m) => !m.failed && !m.notice)
        .map(({ role, text }) => ({ role, text }));
      const conversation = conversationRef.current;

      setMessages((prev) => [...prev, user]);
      setPending(true);

      let reply: ChatMessage;
      try {
        const res = await fetch("/api/swag-assistant", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(client ? apiHeaders(client) : {}),
          },
          body: JSON.stringify({ messages: history }),
        });
        if (!res.ok) throw new Error(`Swag assistant answered ${res.status}`);
        const body = (await res.json()) as SwagAssistantReply;
        const pastOrders = ordersFor(person);
        reply = {
          id: body.replyId ?? `reply-${Date.now()}`,
          role: "assistant",
          text: body.text,
          products: body.productSlugs
            .map((slug) => productBySlug(slug))
            .filter((p): p is Product => Boolean(p)),
          orders: (body.orderRefs ?? [])
            .map((ref) => pastOrders.find((o) => o.ref === ref))
            .filter((o): o is PastOrder => Boolean(o)),
          replyId: body.replyId,
          servedBy: body.servedBy,
          scripted: body.scripted,
        };
      } catch (err) {
        LDObserve.recordError(err as Error, "Swag assistant request failed");
        reply = {
          id: `failed-${Date.now()}`,
          role: "assistant",
          text: FAILED_TEXT,
          failed: true,
        };
      }

      if (conversation !== conversationRef.current) return;
      setMessages((prev) => [...prev, reply]);
      setPending(false);
    },
    [client, person],
  );

  const rate = useCallback(
    (messageId: string, kind: FeedbackKind) => {
      const message = messagesRef.current.find((m) => m.id === messageId);
      if (!message?.replyId || message.feedback) return;

      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, feedback: kind } : m)),
      );
      fetch("/api/swag-assistant/feedback", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(client ? apiHeaders(client) : {}),
        },
        body: JSON.stringify({ replyId: message.replyId, kind }),
      }).catch((err: Error) =>
        LDObserve.recordError(err, "Swag assistant feedback failed"),
      );
    },
    [client],
  );

  // Straight back to one greeting rather than to nothing, because a single
  // message is also what makes the panel offer its suggested prompts again.
  const reset = useCallback(() => {
    conversationRef.current += 1;
    setPending(false);
    setMessages([greetingFor(persona)]);
  }, [persona]);

  const toggleExpanded = useCallback(
    () => setExpanded((open) => !open),
    [],
  );

  return (
    <SwagAssistantContext.Provider
      value={{
        isOpen,
        open,
        close,
        messages,
        send,
        pending,
        rate,
        live,
        reset,
        expanded,
        toggleExpanded,
        memberPricing: persona === "loyaltyGold",
      }}
    >
      {children}
    </SwagAssistantContext.Provider>
  );
}

export function useSwagAssistant() {
  const assistant = useContext(SwagAssistantContext);
  if (!assistant)
    throw new Error(
      "useSwagAssistant must be used inside SwagAssistantProvider",
    );
  return assistant;
}
