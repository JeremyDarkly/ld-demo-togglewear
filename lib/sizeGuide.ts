// Jen did not design a size guide — there is no such frame in the file — and
// she supplied no measurements, so the numbers below are a standard unisex
// grade written to be plausible rather than taken from a real spec sheet. If
// ToggleWear ever sells anything for money, these are hers to confirm.
//
// The catalogue has two size systems: the XS–2XL run the tee, hoodie and
// crewneck share, and the socks' S/M and L/XL. Everything else is one size.
type SizeSystem = {
  // Footwear sizes are shoe sizes, which catalog v2 converts through a
  // sizing service of its own (pages/api/catalog/[slug].ts).
  kind: "apparel" | "footwear";
  // Column headings, not counting the size column itself.
  columns: string[];
  measurements: Record<string, string[]>;
  note: string;
};

const APPAREL: SizeSystem = {
  kind: "apparel",
  columns: ["To fit chest", "Body length"],
  measurements: {
    // Each range starts where the last one ends. The old grade jumped from
    // M's 40" to L's 42", leaving anyone in between with no size at all.
    XS: ['32–35"', '26"'],
    S: ['35–38"', '27"'],
    M: ['38–41"', '28"'],
    L: ['41–44"', '29"'],
    XL: ['44–47"', '30"'],
    "2XL": ['47–50"', '31"'],
  },
  note: "Measurements are approximate. Measure around the fullest part of your chest with the tape level. Everything is cut relaxed with dropped shoulders, so size down for a closer fit.",
};

const SOCKS: SizeSystem = {
  kind: "footwear",
  columns: ["US shoe size", "EU"],
  measurements: {
    "S/M": ["6–9", "38–41"],
    "L/XL": ["9.5–12.5", "42–46"],
  },
  note: "Mid-calf knit with a ribbed cuff, which stretches to cover a size either way.",
};

const SYSTEMS = [APPAREL, SOCKS];

export type SizeChart = {
  kind: SizeSystem["kind"];
  columns: string[];
  rows: { size: string; values: string[] }[];
  note: string;
};

// Keyed on the product's own size labels rather than its category, because
// the labels are what the chart describes — and the rows are filtered to the
// sizes that product actually sells, so the socks show two rows and the tee
// shows six from the same call.
//
// A product with nothing to choose between gets no chart, which is also what
// hides the link on every one-size item in the catalogue.
export function sizeChartFor(sizes: string[]): SizeChart | undefined {
  const system = SYSTEMS.find((s) =>
    sizes.some((size) => size in s.measurements),
  );
  if (!system) return undefined;

  const rows = sizes
    .filter((size) => size in system.measurements)
    .map((size) => ({ size, values: system.measurements[size] }));

  if (rows.length < 2) return undefined;

  return { kind: system.kind, columns: system.columns, rows, note: system.note };
}
