import { useState } from "react";
import { useFlags } from "launchdarkly-react-client-sdk";

import Field from "@/components/ui/Field";

type Method = "card" | "paypal" | "applePay";

// Figma "payment-form-card" (75:1451). The selected option takes the purple
// border and the purple check; the other two sit on Gray 03.
export default function PaymentMethod() {
  const [method, setMethod] = useState<Method>("card");
  const { newPaymentProcessor } = useFlags();

  const borderFor = (value: Method) =>
    method === value ? "border-accent-purple" : "border-grays-03";

  const walletClass = (value: Method) =>
    `flex w-full items-center justify-center rounded-[4px] border p-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-purple focus-visible:ring-offset-2 ${borderFor(value)}`;

  return (
    <section className="flex flex-col gap-6 rounded-[2px] border border-grays-hairline bg-grays-white p-8">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="font-sohne text-h6 font-medium text-grays-ld-black">
          Payment Method
        </h2>
        {/* Flag 11, on screen so the kill switch has something to visibly
            change: this flips the moment the flag is turned off. */}
        <p className="shrink-0 font-sohne-mono text-xsmall-mono uppercase text-grays-04">
          {newPaymentProcessor === true ? "New processor" : "Current processor"}
        </p>
      </div>

      {/* The wallet options are buttons rather than radios, so the choice
          would not otherwise reach the form on submit. A hidden field carries
          it instead of lifting the state up to the page. */}
      <input type="hidden" name="pay-method" value={method} />

      {/* The card option holds its own fields, so it is a container with a
          button inside rather than one big button. */}
      <div className={`flex flex-col gap-4 rounded-[4px] border p-5 ${borderFor("card")}`}>
        <button
          type="button"
          onClick={() => setMethod("card")}
          aria-pressed={method === "card"}
          className="flex w-full items-center justify-between gap-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-purple focus-visible:ring-offset-2"
        >
          <span className="flex items-center gap-2">
            <img
              src="/icons/credit-card.svg"
              alt=""
              width={24}
              height={24}
              className="shrink-0 max-w-none"
            />
            <span className="font-sohne text-main font-medium text-grays-ld-black">
              Credit Card ending in •••• 4242
            </span>
          </span>
          {method === "card" && (
            <img
              src="/icons/check.svg"
              alt=""
              width={24}
              height={24}
              className="shrink-0 max-w-none"
            />
          )}
        </button>

        {/* Jen shows expiry and CVC only under the card option, so they come
            and go with the selection rather than sitting greyed out under
            PayPal. */}
        {method === "card" && (
          <div className="flex flex-col gap-4 sm:flex-row">
            <Field
              id="pay-expiry"
              label="Expiry Date"
              defaultValue="12 / 28"
              className="flex-1"
            />
            <Field
              id="pay-cvc"
              label="CVC"
              defaultValue="•••"
              className="sm:w-[120px] sm:shrink-0"
            />
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={() => setMethod("paypal")}
        aria-pressed={method === "paypal"}
        className={walletClass("paypal")}
      >
        <img
          src="/images/payment/paypal.svg"
          alt="PayPal"
          width={123}
          height={32}
          className="max-w-none"
        />
      </button>

      <button
        type="button"
        onClick={() => setMethod("applePay")}
        aria-pressed={method === "applePay"}
        className={walletClass("applePay")}
      >
        <img
          src="/images/payment/apple-pay.svg"
          alt="Apple Pay"
          width={87}
          height={32}
          className="max-w-none"
        />
      </button>
    </section>
  );
}
