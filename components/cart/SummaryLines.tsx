import {
  COMEBACK_CODE,
  COMEBACK_DISCOUNT,
  LOYALTY_DISCOUNT,
  WELCOME_CODE,
  WELCOME_DISCOUNT,
} from "@/lib/products";
import { formatMoney, type CartTotals } from "@/lib/cart";

// Labelled from the totals rather than from the persona, which is what this
// used to read. The two can disagree — a new customer with a code gets a
// discount and is not a member — and the receipt has to keep saying whatever
// it said at checkout, which only the snapshotted totals know.
const DISCOUNT_ROW = {
  loyalty: `Loyalty Discount (${Math.round(LOYALTY_DISCOUNT * 100)}%)`,
  welcome: `${WELCOME_CODE} (${Math.round(WELCOME_DISCOUNT * 100)}%)`,
  comeback: `${COMEBACK_CODE} (${Math.round(COMEBACK_DISCOUNT * 100)}%)`,
} as const;

// The four money rows and the total, drawn identically in the cart summary
// (70:1448) and the checkout summary (75:1471). Shared so the discount row
// cannot appear on one screen and not the other, and so the purple only has
// one home.
export default function SummaryLines({
  totals,
  // "Total" while you can still change your mind, "Total Paid" on the
  // receipt.
  totalLabel = "Total",
}: {
  totals: CartTotals;
  totalLabel?: string;
}) {
  return (
    <>
      <div className="flex w-full flex-col gap-4 font-sohne text-small">
        <div className="flex items-start justify-between gap-4">
          <p className="text-grays-04">Subtotal</p>
          <p className="font-medium text-grays-ld-black">
            {formatMoney(totals.subtotal)}
          </p>
        </div>

        {totals.discountKind !== "none" && (
          <div className="flex items-start justify-between gap-4 text-accent-purple">
            <p>{DISCOUNT_ROW[totals.discountKind]}</p>
            <p className="font-medium">-{formatMoney(totals.discount)}</p>
          </div>
        )}

        <div className="flex items-start justify-between gap-4">
          <p className="text-grays-04">Shipping</p>
          <p className="font-medium text-accent-purple">FREE</p>
        </div>

        <div className="flex items-start justify-between gap-4">
          <p className="text-grays-04">Estimated Tax</p>
          <p className="font-medium text-grays-ld-black">
            {formatMoney(totals.tax)}
          </p>
        </div>
      </div>

      <div className="h-px w-full bg-grays-hairline" />

      <div className="flex items-center justify-between gap-4">
        <p className="font-sohne text-main font-medium text-grays-ld-black">
          {totalLabel}
        </p>
        <p className="font-sohne text-h6 font-medium text-grays-ld-black">
          {formatMoney(totals.total)}
        </p>
      </div>
    </>
  );
}
