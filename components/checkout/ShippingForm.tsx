import Field from "@/components/ui/Field";
import { useShopper } from "@/components/ui/ShopperProvider";
import { addressFor } from "@/lib/account";

// Figma "shipping-form-card" (75:1419). Prefilled with the signed-in
// shopper's own name and address (lib/account.ts), and Jen's Alex Morgan for
// a guest, so a demo can go straight from cart to placed order without
// typing, and so the Order Review agents have an address to reason about.
//
// The ZIP is the one field worth knowing about: it is what the Order Review
// keys its decline path off, so it is the lever an SE changes on stage. Held
// to exactly five digits, so a mistyped 999999 cannot quietly miss the
// blocked 99999 and leave the decline looking broken. Megan's is a Dutch
// postcode instead, with the country where a US address has its state.
const POSTAL = {
  US: { stateLabel: "State", zipLabel: "ZIP Code", pattern: "[0-9]{5}", maxLength: 5, inputMode: "numeric" },
  NL: { stateLabel: "Country", zipLabel: "Postcode", pattern: "[0-9]{4} ?[A-Za-z]{2}", maxLength: 7, inputMode: "text" },
} as const;

export default function ShippingForm() {
  const { person } = useShopper();
  const address = addressFor(person);
  const postal = POSTAL[address.country];
  const [first, ...rest] = address.name.split(" ");

  return (
    // Keyed by shopper because the fields are uncontrolled: switching
    // shopper on this page has to start them over from the new address.
    <section
      key={person.id}
      className="flex flex-col gap-6 rounded-[2px] border border-grays-hairline bg-grays-white p-8"
    >
      <h2 className="font-sohne text-h6 font-medium text-grays-ld-black">
        Shipping Destination
      </h2>

      <div className="flex flex-col gap-5 sm:flex-row">
        <Field
          id="ship-first"
          label="First Name"
          defaultValue={first}
          className="flex-1"
        />
        <Field
          id="ship-last"
          label="Last Name"
          defaultValue={rest.join(" ")}
          className="flex-1"
        />
      </div>

      <Field
        id="ship-street"
        label="Street Address"
        defaultValue={address.street}
      />

      <Field
        id="ship-apt"
        label="Apartment, suite, etc. (optional)"
        defaultValue={address.apartment}
      />

      <div className="flex flex-col gap-5 sm:flex-row">
        {/* 478 / 120 / 150 at 1440, which is roughly 3.9 : 1 : 1.25 — kept as
            flex ratios so the row survives the narrower widths Jen did not
            draw. */}
        <Field id="ship-city" label="City" defaultValue={address.city} className="flex-[478]" />
        <Field
          id="ship-state"
          label={postal.stateLabel}
          defaultValue={address.state}
          className="flex-[120]"
        />
        <Field
          id="ship-zip"
          label={postal.zipLabel}
          defaultValue={address.zip}
          inputMode={postal.inputMode}
          maxLength={postal.maxLength}
          pattern={postal.pattern}
          required
          className="flex-[150]"
        />
      </div>
    </section>
  );
}
