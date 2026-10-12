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
// same, because what is in it is now something LaunchDarkly targets: a
// signed-in shopper with items in the cart gets the cart reminder banner, and
// a cart that arrived full would show it to everyone the moment they signed
// in. The two items are what Refill in the account menu puts back, for when a
// demo wants a full cart without shopping for one.
const SEED: CartLine[] = [
  { slug: "togglewear-hoodie", size: "M", quantity: 1 },
  { slug: "enamel-mug-set", size: "One size", quantity: 1 },
];

const STORAGE_KEY = "togglewear.cart";
// Its own key rather than folded into the cart's, so a cart already in
// someone's browser still parses.
const PROMO_KEY = "togglewear.promo";

type CartApi = {
  lines: CartLine[];
  count: number;
  add: (slug: string, size: string, quantity?: number) => void;
  setQuantity: (slug: string, size: string, quantity: number) => void;
  remove: (slug: string, size: string) => void;
  // Emptied when an order is placed, since a cart that still holds the things
  // you just bought is the kind of detail a prospect notices.
  clear: () => void;
  // Puts the two sample items back, so the whole flow can be demoed twice in
  // a row without shopping for them again.
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

  // Every page is prerendered, so localStorage can only be read after mount —
  // reading it during render would make the server and client markup disagree.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) setLines(JSON.parse(saved) as CartLine[]);
    } catch {
      // A corrupt or unavailable store just leaves the cart empty.
    }
  }, []);

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
  }, []);

  const count = lines.reduce((sum, l) => sum + l.quantity, 0);

  return (
    <CartContext.Provider
      value={{
        lines,
        count,
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
