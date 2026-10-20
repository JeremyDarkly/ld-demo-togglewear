import Link from "next/link";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import SuccessHeader from "@/components/confirmation/SuccessHeader";
import DeliveryCard from "@/components/confirmation/DeliveryCard";
import ShipmentItems from "@/components/confirmation/ShipmentItems";
import PaymentSummary from "@/components/confirmation/PaymentSummary";
import SwagAssistant from "@/components/ui/SwagAssistant";
import { useShopper } from "@/components/ui/ShopperProvider";
import { useOrder } from "@/components/checkout/OrderProvider";
import { resolveLines } from "@/lib/cart";

// Figma "order-confirmation" (75:1534). The success header sits on white
// with a hairline under it; everything below it is on Gray 01.
export default function OrderConfirmationPage() {
  const { persona } = useShopper();
  const { order, ready } = useOrder();

  return (
    <>
      <Header persona={persona} />

      {/* ready guards against flashing "no order" for the frame or two
          before sessionStorage has been read. */}
      {!ready ? (
        <div className="min-h-[60vh] bg-grays-01" />
      ) : order ? (
        <>
          <SuccessHeader
            firstName={order.shipTo.name.split(" ")[0] || "there"}
            orderRef={order.ref}
          />

          <div className="bg-grays-01">
            <main className="mx-auto flex max-w-[1440px] flex-col gap-10 px-6 py-10 md:px-10 xl:flex-row xl:gap-12 xl:px-16">
              <div className="flex min-w-0 flex-1 flex-col gap-8">
                <DeliveryCard
                  shipTo={order.shipTo}
                  deliveryBy={order.deliveryBy}
                />
                <ShipmentItems lines={resolveLines(order.lines)} />
              </div>

              <div className="flex flex-col gap-6 xl:w-[420px] xl:shrink-0">
                <PaymentSummary
                  totals={order.totals}
                  paymentLabel={order.paymentLabel}
                  riskScore={order.riskScore}
                  scripted={Boolean(order.scripted)}
                />
                {/* Black here rather than the purple of Place Order, which
                    Jen reserves for the step that takes the money. */}
                <Link
                  href="/"
                  className="w-full rounded-[2px] bg-grays-ld-black py-4 text-center font-sohne text-large-medium font-medium text-grays-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-grays-ld-black focus-visible:ring-offset-2"
                >
                  Continue Shopping
                </Link>
              </div>
            </main>
          </div>
        </>
      ) : (
        // Reachable by typing the URL, or by refreshing in a new session.
        <div className="bg-grays-01">
          <main className="mx-auto flex max-w-[1440px] flex-col items-center gap-4 px-6 py-24 text-center">
            <h1 className="font-sora text-h3 font-semibold text-grays-ld-black">
              No recent order
            </h1>
            <p className="font-sohne text-main text-grays-04">
              Nothing has been placed in this session.
            </p>
            <Link
              href="/"
              className="font-sohne text-small font-medium text-grays-ld-black underline"
            >
              Browse the drop
            </Link>
          </main>
        </div>
      )}

      <Footer />

      <SwagAssistant />
    </>
  );
}
