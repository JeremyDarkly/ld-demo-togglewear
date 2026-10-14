import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { lineId, type CartLine } from "@/lib/cart";

// Jen's cart is drawn with two items in it. The cart starts empty all the
// same, because what is in it is now something LaunchDarkly targets, and a
// cart that arrived full would look abandoned to everyone. The two items are
// what Refill in the account menu puts back, for when a demo wants a full
// cart without shopping for one.
const SEED: CartLine[] = [
  { slug: "togglewear-hoodie", size: "M", quantity: 1 },
  { slug: "enamel-mug-set", size: "One size", quantity: 1 },
];

const STORAGE_KEY = "togglewear.cart";
// Its own key rather than folded into the cart's, so a cart already in
// someone's browser still parses.
const PROMO_KEY = "togglewear.promo";

// Whether this visit began with items already in the cart. Session storage,
// so it is decided once per visit: a reload keeps the answer, and a new tab
// or a browser opened tomorrow asks again.
const VISIT_KEY = "togglewear.cart.visit";

type CartApi = {
  lines: CartLine[];
  count: number;
  // A cart left on an earlier visit and come back to, which is what an
  // abandoned cart actually is. Items added during this visit never make it
  // true, so the cart reminder banner does not chase someone mid-shop.
  // Sent to LaunchDarkly as returningCart, where flag 07's rule decides what
  // counts — which is the demo point: marketing owns the definition.
  returning: boolean;
  add: (slug: string, size: string, quantity?: number) => void;
  setQuantity: (slug: string, size: string, quantity: number) => void;
  remove: (slug: string, size: string) => void;
  // Emptied when an order is placed, since a cart that still holds the things
  // you just bought is the kind of detail a prospect notices.
  clear: () => void;
  // Puts the two sample items back, so the whole flow can be demoed twice in
  // a row without shopping for them again. They come back as if left on an
  // earlier visit, because a demo cannot close the tab and wait a day to
  // show the cart reminder.
  reset: () => void;

  // The applied promo code, or null. It belongs to the cart rather than to
  // the summary panel because the cart and the checkout both price it, and
  // because an order placed with a code should keep it.
  //
  // Stored, not judged: whether a code is any good is validatePromo's
  // business, and the summary field asks before calling this.
  promo: string | null;
  applyPromo: (code: string) => void;
  removePromo: () => void;
};

const CartContext = createContext<CartApi | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [promo, setPromo] = useState<string | null>(null);
  const [returning, setReturningState] = useState(false);

  // Written straight to session storage rather than from an effect on the
  // state: such an effect would run on mount with the initial false and
  // overwrite the answer the restore below has just recorded.
  const setReturning = useCallback((value: boolean) => {
    setReturningState(value);
    try {
      window.sessionStorage.setItem(VISIT_KEY, value ? "returning" : "new");
    } catch {
      // The answer still holds for this page load.
    }
  }, []);

  // Every page is prerendered, so storage can only be read after mount —
  // reading it during render would make the server and client markup disagree.
  useEffect(() => {
    let restored: CartLine[] = [];
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) {
        restored = JSON.parse(saved) as CartLine[];
        setLines(restored);
      }
    } catch {
      // A corrupt or unavailable store just leaves the cart empty.
    }

    // The first page of a visit settles whether it is a return to a cart;
    // every later page load in the same tab reads that answer back.
    try {
      const visit = window.sessionStorage.getItem(VISIT_KEY);
      if (visit === null) setReturning(restored.length > 0);
      else setReturningState(visit === "returning");
    } catch {
      // Without session storage every load is a fresh visit, which only
      // means a reload with items in the cart reads as a return.
      setReturningState(restored.length > 0);
    }
  }, [setReturning]);

  // A cart emptied by any route — removing the last line, placing the order —
  // is no longer one anybody abandoned.
  useEffect(() => {
    if (lines.length === 0 && returning) setReturning(false);
  }, [lines.length, returning, setReturning]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(PROMO_KEY);
      if (saved) setPromo(saved);
    } catch {
      // Same as above: an unreadable store just means no code applied.
    }
  }, []);

  useEffect(() => {
    try {
      if (promo) window.localStorage.setItem(PROMO_KEY, promo);
      else window.localStorage.removeItem(PROMO_KEY);
    } catch {
      // The code still applies for this session.
    }
  }, [promo]);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
    } catch {
      // Private browsing and full quotas both throw here; the cart still
      // works for the session.
    }
  }, [lines]);

  const add = useCallback((slug: string, size: string, quantity = 1) => {
    setLines((prev) => {
      const id = lineId(slug, size);
      const existing = prev.find((l) => lineId(l.slug, l.size) === id);
      if (existing) {
        return prev.map((l) =>
          lineId(l.slug, l.size) === id
            ? { ...l, quantity: l.quantity + quantity }
            : l
        );
      }
      return [...prev, { slug, size, quantity }];
    });
  }, []);

  const remove = useCallback((slug: string, size: string) => {
    const id = lineId(slug, size);
    setLines((prev) => prev.filter((l) => lineId(l.slug, l.size) !== id));
  }, []);

  const setQuantity = useCallback(
    (slug: string, size: string, quantity: number) => {
      if (quantity < 1) {
        remove(slug, size);
        return;
      }
      const id = lineId(slug, size);
      setLines((prev) =>
        prev.map((l) =>
          lineId(l.slug, l.size) === id ? { ...l, quantity } : l
        )
      );
    },
    [remove]
  );

  const applyPromo = useCallback((code: string) => {
    setPromo(code.trim().toUpperCase());
  }, []);

  const removePromo = useCallback(() => setPromo(null), []);

  // Both drop the code along with the lines: a promo outliving the cart it
  // was applied to would reappear on the next order unannounced.
  const clear = useCallback(() => {
    setLines([]);
    setPromo(null);
  }, []);

  const reset = useCallback(() => {
    setLines(SEED);
    setPromo(null);
    setReturning(true);
  }, [setReturning]);

  const count = lines.reduce((sum, l) => sum + l.quantity, 0);

  return (
    <CartContext.Provider
      value={{
        lines,
        count,
        returning,
        add,
        setQuantity,
        remove,
        clear,
        reset,
        promo,
        applyPromo,
        removePromo,
      }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const cart = useContext(CartContext);
  if (!cart) throw new Error("useCart must be used inside CartProvider");
  return cart;
}
