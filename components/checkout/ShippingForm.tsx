import Field from "@/components/ui/Field";

// Figma "shipping-form-card" (75:1419). Prefilled with Jen's Alex Morgan so
// a demo can go straight from cart to placed order without typing, and so
// the Order Review agents have an address to reason about.
//
// The ZIP is the one field worth knowing about: it is what the Order Review
// keys its decline path off, so it is the lever an SE changes on stage. Held
// to exactly five digits, so a mistyped 999999 cannot quietly miss the
// blocked 99999 and leave the decline looking broken.
export default function ShippingForm() {
  return (
    <section className="flex flex-col gap-6 rounded-[2px] border border-grays-hairline bg-grays-white p-8">
      <h2 className="font-sohne text-h6 font-medium text-grays-ld-black">
        Shipping Destination
      </h2>

      <div className="flex flex-col gap-5 sm:flex-row">
        <Field
          id="ship-first"
          label="First Name"
          defaultValue="Alex"
          className="flex-1"
        />
        <Field
          id="ship-last"
          label="Last Name"
          defaultValue="Morgan"
          className="flex-1"
        />
      </div>

      <Field
        id="ship-street"
        label="Street Address"
        defaultValue="91 Orchard Street"
      />

      <Field
        id="ship-apt"
        label="Apartment, suite, etc. (optional)"
        defaultValue="Apt 4B"
      />

      <div className="flex flex-col gap-5 sm:flex-row">
        {/* 478 / 120 / 150 at 1440, which is roughly 3.9 : 1 : 1.25 — kept as
            flex ratios so the row survives the narrower widths Jen did not
            draw. */}
        <Field id="ship-city" label="City" defaultValue="New York" className="flex-[478]" />
        <Field id="ship-state" label="State" defaultValue="NY" className="flex-[120]" />
        <Field
          id="ship-zip"
          label="ZIP Code"
          defaultValue="10001"
          inputMode="numeric"
          maxLength={5}
          pattern="[0-9]{5}"
          required
          className="flex-[150]"
        />
      </div>
    </section>
  );
}
