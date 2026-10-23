// Specimen page for the design tokens ported out of Jen's Figma variables.
// Not part of the demo itself; it exists to catch drift between the Figma
// variable set and tailwind.config.js.
const COLORS = [
  { token: "Base/Lime", className: "bg-base-lime", hex: "#DDFF46" },
  { token: "Base/Blue", className: "bg-base-blue", hex: "#405BFF" },
  { token: "Base/Orange", className: "bg-base-orange", hex: "#FF9D29" },
  { token: "Base/Cyan", className: "bg-base-cyan", hex: "#3DD6F5" },
  { token: "Grays/LD Black", className: "bg-grays-ld-black", hex: "#191919" },
  { token: "Grays/Black 01", className: "bg-grays-black-01", hex: "#101010" },
  { token: "Grays/Gray 04", className: "bg-grays-04", hex: "#6D6E71" },
  { token: "Grays/Gray 03", className: "bg-grays-03", hex: "#A7A9AC" },
  { token: "Grays/Gray 02", className: "bg-grays-02", hex: "#D1D6D9" },
  { token: "Grays/Gray 01", className: "bg-grays-01", hex: "#F8F8F8" },
];

const TYPE = [
  { token: "Web H1", className: "font-sora font-bold text-h1" },
  { token: "Web H2", className: "font-sora font-semibold text-h2" },
  { token: "Web H3", className: "font-sora font-semibold text-h3" },
  { token: "Text Main, Regular", className: "font-sohne text-main" },
  { token: "Text Main, Medium", className: "font-sohne font-medium text-main-medium" },
  { token: "Text Small, Regular", className: "font-sohne text-small" },
  { token: "Text XSmall, Regular", className: "font-sohne text-xsmall" },
  { token: "Text XSmall, Mono", className: "font-sohne-mono text-xsmall-mono" },
];

export default function Tokens() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-16 md:px-8">
      <header className="mb-16">
        <p className="mb-4 font-sohne-mono text-xsmall-mono uppercase text-grays-04">
          Demo-ToggleWear-2026
        </p>
        <h1 className="font-sora text-h2 font-semibold">Design tokens</h1>
      </header>

      <section className="mb-16">
        <h2 className="mb-6 font-sora text-h3 font-semibold">Color</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          {COLORS.map(({ token, className, hex }) => (
            <div key={token}>
              <div
                className={`${className} h-20 w-full rounded-[10px] border border-grays-02`}
              />
              <p className="mt-2 font-sohne text-xsmall font-medium">{token}</p>
              <p className="font-sohne-mono text-xsmall-mono text-grays-04">{hex}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-16">
        <h2 className="mb-6 font-sora text-h3 font-semibold">Type</h2>
        <div className="divide-y divide-grays-02">
          {TYPE.map(({ token, className }) => (
            <div key={token} className="py-5">
              <p className="mb-2 font-sohne-mono text-xsmall-mono text-grays-03">
                {token}
              </p>
              <p className={className}>Swag that&apos;s built for the team</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
