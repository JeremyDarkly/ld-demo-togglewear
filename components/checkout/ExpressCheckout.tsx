// Flag 10's treatment: one-tap wallet buttons above the full form, the way
// most storefronts now open checkout. Not one of Jen's frames; it is built
// from her payment card's wallet buttons and her card chrome.
//
// Each button submits the page's form itself, so an express order goes
// through the same placeOrder, fraud agent and order-placed event as one
// from Place Order. The address is the form's prefilled one, which is what a
// wallet would supply. The button's own name and value travel with the
// submit and tell placeOrder which wallet paid.
//
// formNoValidate because a wallet verifies the shopper on its own, so
// nothing in the card form should hold it up.
export default function ExpressCheckout({ disabled }: { disabled: boolean }) {
  const wallet =
    "flex flex-1 items-center justify-center rounded-[4px] border border-grays-ld-black p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-purple focus-visible:ring-offset-2 disabled:opacity-60";

  return (
    <section className="flex flex-col gap-5 rounded-[2px] border border-grays-hairline bg-grays-white p-8">
      <div className="flex flex-col gap-1">
        <h2 className="font-sohne text-h6 font-medium text-grays-ld-black">
          Express Checkout
        </h2>
        <p className="font-sohne text-small text-grays-04">
          Pay in one tap with the address and card on file.
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <button
          type="submit"
          name="express-method"
          value="paypal"
          formNoValidate
          disabled={disabled}
          className={wallet}
        >
          <img
            src="/images/payment/paypal.svg"
            alt="Pay with PayPal"
            width={123}
            height={32}
            className="max-w-none"
          />
        </button>
        <button
          type="submit"
          name="express-method"
          value="applePay"
          formNoValidate
          disabled={disabled}
          className={wallet}
        >
          <img
            src="/images/payment/apple-pay.svg"
            alt="Pay with Apple Pay"
            width={87}
            height={32}
            className="max-w-none"
          />
        </button>
      </div>

      <div className="flex items-center gap-4">
        <span className="h-px flex-1 bg-grays-hairline" />
        <span className="font-sohne-mono text-xsmall-mono uppercase text-grays-04">
          Or fill in your details
        </span>
        <span className="h-px flex-1 bg-grays-hairline" />
      </div>
    </section>
  );
}
