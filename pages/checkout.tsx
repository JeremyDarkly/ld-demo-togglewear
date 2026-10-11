import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/router";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import ShippingForm from "@/components/checkout/ShippingForm";
import PaymentMethod from "@/components/checkout/PaymentMethod";
import CheckoutSummary from "@/components/checkout/CheckoutSummary";
import SwagAssistant from "@/components/ui/SwagAssistant";
import { useShopper } from "@/components/ui/ShopperProvider";
import { useCart } from "@/components/cart/CartProvider";
import { useOrder } from "@/components/checkout/OrderProvider";
import { cartTotals, resolveLines } from "@/lib/cart";
import { estimateDelivery, paymentLabel, type ShipTo } from "@/lib/order";
import { EVENTS, useTrack } from "@/lib/events";
import {
  assessOrder,
  orderNumber,
  ASSESS_MS,
  type FraudAssessment,
} from "@/lib/fraudAgent";
// Figma "checkout" (75:1396). Same two-column geometry as the cart: 844 and
// 420 with a 48px gutter inside 64px of page padding, stacking below xl.
//
// The one thing here that Jen did not draw is the fraud triage agent. Place
// Order submits the whole page as a form and the agent reads the address and
// the cart back out of it.
//
// An approved order goes straight to the confirmation page, where the agent's
// verdict shows up on the receipt. A held or declined order stays put and
// the verdict replaces the button, so there is something to talk over.
export default function CheckoutPage() {
  const router = useRouter();
  const { persona, variant } = useShopper();

  const { lines, promo, clear } = useCart();
  const { place } = useOrder();
  const [assessing, setAssessing] = useState(false);
  const [assessment, setAssessment] = useState<FraudAssessment | null>(null);
  const [orderRef, setOrderRef] = useState("");
  const track = useTrack();

  // Once per visit, and only with something in the cart: arriving at an empty
  // checkout is not starting one. The ref keeps it to one even when the
  // effect runs again, which it does once the client is built and twice over
  // in development, where React mounts every effect twice to flush out bugs.
  const started = useRef(false);
  useEffect(() => {
    if (started.current || lines.length === 0) return;
    started.current = track(EVENTS.checkoutStarted, { items: lines.length });
  }, [track, lines.length]);

  function placeOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (assessing || assessment) return;

    const form = new FormData(event.currentTarget);
    const read = (field: string) => String(form.get(field) ?? "").trim();
    const shipTo: ShipTo = {
      name: `${read("ship-first")} ${read("ship-last")}`.trim(),
      street: read("ship-street"),
      apartment: read("ship-apt"),
      city: read("ship-city"),
      state: read("ship-state"),
      zip: read("ship-zip"),
    };

    const resolved = resolveLines(lines);
    // Priced with the code so the receipt keeps the discount the cart showed.
    const totals = cartTotals(resolved, variant, promo);
    const verdict = assessOrder({
      zip: shipTo.zip,
      total: totals.total,
      maxLineQuantity: resolved.reduce(
        (most, line) => Math.max(most, line.quantity),
        0,
      ),
    });
    const ref = orderNumber();

    setAssessing(true);
    // Stands in for the round trip to the model. Deliberately visible: the
    // pause is what makes the audience notice something evaluated the order.
    window.setTimeout(() => {
      if (verdict.decision === "approve") {
        place({
          ref,
          lines,
          variant,
          totals,
          deliveryBy: estimateDelivery().toISOString(),
          shipTo,
          paymentLabel: paymentLabel(read("pay-method")),
          riskScore: verdict.score,
        });
        // Approved orders only: one the fraud agent holds or declines has not
        // been placed. The total is the metric value, in dollars, after any
        // discount and with tax, so it matches what the receipt says.
        track(EVENTS.orderPlaced, { ref }, totals.total);
        // Emptied after the navigation rather than before it, so this page
        // does not repaint with a zeroed summary on its way out.
        router.push("/order-confirmation").then(clear);
        return;
      }
      setOrderRef(ref);
      setAssessment(verdict);
      setAssessing(false);
    }, ASSESS_MS);
  }

  return (
    <>
      <Header persona={persona} />

      {/* Jen's workspace sits on Gray 01, full bleed, with the cards centred
          inside it. */}
      <div className="bg-grays-01">
        <form
          onSubmit={placeOrder}
          className="mx-auto flex max-w-[1440px] flex-col gap-10 px-6 py-10 md:px-10 xl:flex-row xl:gap-12 xl:px-16"
        >
          <div className="flex min-w-0 flex-1 flex-col gap-8">
            <ShippingForm />
            <PaymentMethod />
          </div>

          <div className="flex flex-col gap-6 xl:w-[420px] xl:shrink-0">
            <CheckoutSummary
              variant={variant}
              assessing={assessing}
              assessment={assessment}
              orderRef={orderRef}
            />
          </div>
        </form>
      </div>

      <Footer />

      <SwagAssistant />
    </>
  );
}
