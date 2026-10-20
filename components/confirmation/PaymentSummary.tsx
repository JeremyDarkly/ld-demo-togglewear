import SummaryLines from "@/components/cart/SummaryLines";
import type { CartTotals } from "@/lib/cart";

// Figma "summary-panel" (75:1600). The same money rows as the cart and
// checkout, with Jen's payment details block underneath and no actions —
// there is nothing left to change by this point.
export default function PaymentSummary({
  totals,
  paymentLabel,
  riskScore,
}: {
  totals: CartTotals;
  paymentLabel: string;
  riskScore: number;
}) {
  return (
    <section className="flex flex-col gap-6 rounded-[2px] border border-grays-hairline bg-grays-white p-8">
      <h2 className="font-sohne text-h6 font-medium text-grays-ld-black">
        Payment Summary
      </h2>

      <SummaryLines totals={totals} totalLabel="Total Paid" />

      <div className="h-px w-full bg-grays-hairline" />

      <div className="flex flex-col gap-4">
        <p className="font-sohne text-xsmall-caps font-medium uppercase text-grays-04">
          Payment Details
        </p>
        <p className="font-sohne text-small font-medium text-grays-ld-black">
          {paymentLabel}
        </p>
        <p className="font-sohne text-small text-grays-04">
          Billing address matches shipping.
        </p>
        {/* Not in Jen's design. The Order Review agents clearing the order
            is the whole point of the checkout step, and without a line here
            the only evidence they ran is a moment the audience already
            forgot. */}
        <p className="font-sohne text-xsmall text-grays-04">
          Cleared by the Order Review agents — risk {riskScore}/100.
        </p>
      </div>
    </section>
  );
}
