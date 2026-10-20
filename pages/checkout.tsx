import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/router";
import { useFlags, useLDClient } from "launchdarkly-react-client-sdk";
import { LDObserve } from "@launchdarkly/observability";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import ShippingForm from "@/components/checkout/ShippingForm";
import PaymentMethod from "@/components/checkout/PaymentMethod";
import CheckoutSummary from "@/components/checkout/CheckoutSummary";
import { type OrderReviewProgress } from "@/components/checkout/OrderReviewSteps";
import ExpressCheckout from "@/components/checkout/ExpressCheckout";
import SwagAssistant from "@/components/ui/SwagAssistant";
import { useShopper } from "@/components/ui/ShopperProvider";
import { useCart } from "@/components/cart/CartProvider";
import { useOrder } from "@/components/checkout/OrderProvider";
import { useIncidents } from "@/components/ui/IncidentProvider";
import { cartTotals, resolveLines } from "@/lib/cart";
import { estimateDelivery, paymentLabel, type ShipTo } from "@/lib/order";
import { EVENTS, useTrack } from "@/lib/events";
import { apiHeaders } from "@/lib/api";
import { assessOrder, orderNumber, type FraudAssessment } from "@/lib/fraudAgent";
import {
  streamOrderReview,
  underReview,
  type OrderReviewRequest,
} from "@/lib/orderReview";
// Figma "checkout" (75:1396). Same two-column geometry as the cart: 844 and
// 420 with a 48px gutter inside 64px of page padding, stacking below xl.
//
// The one thing here that Jen did not draw is the fraud review. Place Order
// submits the whole page as a form, and the address and the cart are read
// back out of it and sent to the Order Review agent graph
// (pages/api/order-review), whose agents fill in under the button as they
// work.
//
// An approved order shows its verdict for a moment and goes on to the
// confirmation page, where the score shows up on the receipt. A held or
// declined order stays put and the verdict replaces the button, so there is
// something to talk over.
// How long an approved order's verdict stays up before the confirmation page.
const APPROVED_PAUSE_MS = 1200;

export default function CheckoutPage() {
  const router = useRouter();
  const { persona, variant } = useShopper();

  const { lines, promo, clear } = useCart();
  const { place } = useOrder();
  const [assessing, setAssessing] = useState(false);
  const [assessment, setAssessment] = useState<FraudAssessment | null>(null);
  const [orderRef, setOrderRef] = useState("");
  const [paymentFailed, setPaymentFailed] = useState(false);
  const [steps, setSteps] = useState<OrderReviewProgress>({});
  const [scripted, setScripted] = useState(false);
  const client = useLDClient();
  const track = useTrack();
  const { expressCheckout, announcementOffer, newPaymentProcessor } =
    useFlags();
  const { paymentOutage } = useIncidents();

  // Once per visit, and only with something in the cart: arriving at an empty
  // checkout is not starting one. The ref keeps it to one even when the
  // effect runs again, which it does once the client is built and twice over
  // in development, where React mounts every effect twice to flush out bugs.
  const started = useRef(false);
  useEffect(() => {
    if (started.current || lines.length === 0) return;
    started.current = track(EVENTS.checkoutStarted, { items: lines.length });
  }, [track, lines.length]);

  async function placeOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (assessing || assessment) return;
    setPaymentFailed(false);
    setSteps({});
    setScripted(false);

    // Passing the submitter is what carries an express wallet button's own
    // name and value into the form data; Place Order has neither.
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const form = new FormData(event.currentTarget, submitter);
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
    const totals = cartTotals(resolved, variant, promo, announcementOffer);
    const ref = orderNumber();
    const payment = paymentLabel(read("express-method") || read("pay-method"));

    const decide = (verdict: FraudAssessment, byScript: boolean) => {
      // The charge, which only happens to an order the agent approved. During
      // a staged outage the new processor (flag 12) fails it, and the error
      // is what the kill switch's alert counts. Once the flag is off the same
      // order goes through the current processor, outage or not, which is
      // the whole point of keeping the old path behind the flag.
      if (
        verdict.decision === "approve" &&
        newPaymentProcessor === true &&
        paymentOutage
      ) {
        const error = new Error("Payment processor timed out");
        error.name = "PaymentProcessorError";
        LDObserve.recordError(error, "Charge failed on the new payment processor", {
          flag: "newPaymentProcessor",
          processor: "new",
          orderRef: ref,
        });
        setPaymentFailed(true);
        setAssessing(false);
        return;
      }

      if (verdict.decision === "approve") {
        place({
          ref,
          lines,
          variant,
          totals,
          deliveryBy: estimateDelivery().toISOString(),
          shipTo,
          paymentLabel: payment,
          riskScore: verdict.score,
          scripted: byScript,
        });
        // Approved orders only: one the fraud agent holds or declines has not
        // been placed. The total is the metric value, in dollars, after any
        // discount and with tax, so it matches what the receipt says.
        track(EVENTS.orderPlaced, { ref }, totals.total);
        // Long enough for the room to see the verdict land, which is the
        // only moment an approved order's agents are on screen together.
        setOrderRef(ref);
        setAssessment(verdict);
        window.setTimeout(() => {
          // Emptied after the navigation rather than before it, so this
          // page does not repaint with a zeroed summary on its way out.
          router.push("/order-confirmation").then(clear);
        }, APPROVED_PAUSE_MS);
        return;
      }
      setOrderRef(ref);
      setAssessment(verdict);
      setAssessing(false);
    };

    const order: OrderReviewRequest = { ref, lines, total: totals.total, shipTo, payment };
    let answered = false;
    setAssessing(true);
    try {
      await streamOrderReview(client ? apiHeaders(client) : {}, order, (reviewEvent) => {
        if (reviewEvent.type === "step") {
          const { step } = reviewEvent;
          setSteps((current) => ({ ...current, [step.key]: step }));
        } else if (!answered) {
          answered = true;
          setScripted(Boolean(reviewEvent.scripted));
          decide(reviewEvent.assessment, Boolean(reviewEvent.scripted));
        }
      });
    } catch (err) {
      LDObserve.recordError(err as Error, "Order review request failed", { orderRef: ref });
    }
    // The route answers with the scripted review itself whenever the graph
    // cannot; this is for when the route could not be reached at all.
    if (!answered) {
      setScripted(true);
      decide(assessOrder(underReview(order)), true);
    }
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
            {/* Flag 10's experiment: the current checkout against the same
                page with one-tap wallets on top. */}
            {expressCheckout === true && (
              <ExpressCheckout disabled={assessing || Boolean(assessment)} />
            )}
            <ShippingForm />
            <PaymentMethod />
          </div>

          <div className="flex flex-col gap-6 xl:w-[420px] xl:shrink-0">
            <CheckoutSummary
              variant={variant}
              assessing={assessing}
              assessment={assessment}
              orderRef={orderRef}
              paymentFailed={paymentFailed}
              steps={steps}
              scripted={scripted}
            />
          </div>
        </form>
      </div>

      <Footer />

      <SwagAssistant />
    </>
  );
}
