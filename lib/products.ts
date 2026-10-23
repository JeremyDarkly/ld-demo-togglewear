export type ProductColor = { name: string; hex: string };

// The three Jen lists in the footer's Shop column, which is the only place in
// her designs that names them all — the header shows New Drops, Apparel and
// Tech, so Accessories appears in one and not the other.
//
// The listing page is built to show an empty category honestly rather than
// hide the link, because a category a shopper can see in two different menus
// should not 404.
export type ProductCategory = "apparel" | "accessories" | "tech";

// Taken from the fills of Jen's swatch SVGs on the two product detail pages.
// Everything except pink maps to one of her published colour variables.
export const COLORS: Record<string, ProductColor> = {
  black: { name: "Black", hex: "#191919" },
  blue: { name: "Blue", hex: "#405BFF" },
  orange: { name: "Orange", hex: "#FF9D29" },
  cyan: { name: "Cyan", hex: "#3DD6F5" },
  pink: { name: "Pink", hex: "#F98FC9" },
  grey: { name: "Grey", hex: "#6D6E71" },
};

const APPAREL_SIZES = ["XS", "S", "M", "L", "XL", "2XL"];
const ONE_SIZE = ["One size"];

export type Product = {
  slug: string;
  name: string;
  priceUsd: number;
  description: string;
  image: string;
  // Worn things are apparel, including hats, which follows Jen's own grouping
  // in the drop promo copy: "sweatshirts, hats, tech accessories, and
  // everyday swag". Everyday swag is what accessories holds.
  category: ProductCategory;
  isNew?: boolean;
  // Loyalty Gold members get early access to these; they are absent from the
  // default catalogue entirely.
  membersOnly?: boolean;

  // Product detail page fields.
  badge: string;
  gallery: string[];
  sizes: string[];
  defaultSize: string;
  detail: string;
  features: string[];
  // Omitted where a colourway choice would be meaningless, such as the
  // tie-dyed bucket hat or the two-tone mug set. The Color block is hidden
  // when there are fewer than two.
  colors?: ProductColor[];
};

// The Figma file repeats "ToggleWear Crewneck / $48 USD / Heavyweight
// cotton-blend fleece" on all eight cards as placeholder text, so the names,
// prices and descriptions here are written to match the photography instead.
// The images and isNew flags are taken from the design.
//
// These prices feed cart and checkout totals, so this file is the single
// source of truth for them.
// The cap and the hoodie carry Jen's copy verbatim from the two product
// detail pages she designed. The other seven are written to match it: a short
// line that plays on shipping or flags, then the concrete product facts.
//
// Product names stay in our own house style (ToggleWear Cap, ToggleWear
// Hoodie) rather than Jen's, because her two are inconsistent with each other
// — "Two-tone LaunchDarkly Trucker Hat" next to plain "Hooded sweatshirt".
// Her product *facts* are kept, which is why the cap is a 5-panel here.
export const BEST_SELLERS: Product[] = [
  {
    slug: "togglewear-cap",
    name: "ToggleWear Cap",
    priceUsd: 32,
    description: "Structured 5-panel, adjustable snapback",
    image: "/images/products/cap-white-product.png",
    category: "apparel",
    badge: "Limited Run",
    gallery: [
      "/images/products/cap-white-model-1.png",
      "/images/products/cap-white-model-2.png",
      "/images/products/cap-white-product.png",
    ],
    sizes: ONE_SIZE,
    defaultSize: "One size",
    colors: [COLORS.black, COLORS.blue, COLORS.orange, COLORS.cyan],
    detail:
      "Some releases you gate. This one you just wear. Our classic black-and-white trucker hat features a breathable mesh back, structured front panel, and the LaunchDarkly logo embroidered front and center — because good taste shouldn’t be feature-flagged.\n\nAdjustable snapback closure fits most heads.",
    features: [
      "Structured 5-panel front",
      "Breathable mesh back panels",
      "Embroidered LaunchDarkly logo",
      "Adjustable snapback closure",
    ],
  },
  {
    slug: "enamel-mug-set",
    name: "Enamel Mug Set",
    priceUsd: 28,
    description: "Two 12oz enamel mugs, black and white",
    image: "/images/products/mug-pair.png",
    category: "accessories",
    badge: "Limited Run",
    gallery: [
      "/images/products/mug-pair.png",
      "/images/products/mug-black.png",
    ],
    sizes: ONE_SIZE,
    defaultSize: "One size",
    detail:
      "Two mugs, one for each environment. Heavy enamel over a steel core with a rolled rim, in matte black and off-white, each carrying the mark on the side. Chip-resistant enough for a desk that doubles as a workbench.\n\nHolds 12oz. Hand wash recommended.",
    features: [
      "12oz enamel over steel core",
      "Set of two, black and white",
      "Rolled rim, chip resistant",
      "Hand wash recommended",
    ],
  },
  {
    slug: "checkerboard-socks",
    name: "Checkerboard Socks",
    priceUsd: 18,
    description: "Mid-calf knit with cushioned sole",
    image: "/images/products/socks-worn.png",
    category: "apparel",
    isNew: true,
    badge: "Limited Run",
    gallery: [
      "/images/products/socks-worn.png",
      "/images/products/socks-flat.png",
      "/images/products/socks-sandals.png",
    ],
    sizes: ["S/M", "L/XL"],
    defaultSize: "L/XL",
    detail:
      "Flags, but for your feet. A mid-calf checkerboard knit with a cushioned footbed and a ribbed cuff that actually stays up. Loud enough to notice, subtle enough for standup.\n\nTwo sizes cover most feet.",
    features: [
      "Mid-calf with ribbed cuff",
      "Cushioned footbed",
      "Combed cotton blend",
      "Checkerboard knit pattern",
    ],
  },
  {
    slug: "togglewear-hoodie",
    name: "ToggleWear Hoodie",
    priceUsd: 68,
    description: "Heavyweight cotton-blend fleece",
    image: "/images/products/hoodie-blue-model.png",
    category: "apparel",
    isNew: true,
    badge: "Limited Run",
    gallery: [
      "/images/products/hoodie-blue-model.png",
      // The black colourway, which is in the swatch list below but was not
      // shown anywhere until now.
      "/images/products/hoodie-black-model.png",
      "/images/products/hoodie-rack.png",
      "/images/products/hoodie-colors.png",
    ],
    sizes: APPAREL_SIZES,
    defaultSize: "M",
    colors: [
      COLORS.blue,
      COLORS.black,
      COLORS.orange,
      COLORS.cyan,
      COLORS.pink,
      COLORS.grey,
    ],
    detail:
      "Comfort you can deploy anywhere. This midweight hoodie features a subtly embroidered LaunchDarkly logo on the front chest, a fleece-lined hood, and a fit that’s just as good for late-night ships as it is for lazy Sundays. Soft on the inside, sharp on the outside — no rollback needed.",
    features: [
      "Midweight fleece construction",
      "Embroidered LaunchDarkly logo on front chest",
      "Ribbed cuffs and hem",
      "Available in 6 colors",
    ],
  },
  {
    slug: "sticker-pack",
    name: "Sticker Pack",
    priceUsd: 12,
    description: "Five weatherproof vinyl stickers",
    image: "/images/products/stickers-laptop.png",
    category: "accessories",
    badge: "Limited Run",
    gallery: [
      "/images/products/stickers-laptop.png",
      "/images/products/stickers-sheet.png",
    ],
    sizes: ONE_SIZE,
    defaultSize: "One size",
    detail:
      "Five stickers, zero config. Weatherproof vinyl with a matte laminate, sized for a laptop lid, a water bottle, or whatever else needs labelling. Peel, place, ship.\n\nDie-cut, two to three inches each.",
    features: [
      "Five weatherproof vinyl stickers",
      "Matte laminate finish",
      "Dishwasher and laptop safe",
      "Die-cut, 2 to 3 inches each",
    ],
  },
  {
    slug: "canvas-tote",
    name: "Canvas Tote",
    priceUsd: 24,
    description: "Heavy cotton canvas, 15L capacity",
    image: "/images/products/tote-canvas.png",
    category: "accessories",
    badge: "Limited Run",
    gallery: ["/images/products/tote-canvas.png"],
    sizes: ONE_SIZE,
    defaultSize: "One size",
    detail:
      "Carries more than your dependencies. Heavy cotton canvas with reinforced straps and a boxed base that stands up on its own. Fits a 16-inch laptop, a change of clothes, and the rest of it.\n\n15L capacity with an interior slip pocket.",
    features: [
      "16oz cotton canvas",
      "Reinforced shoulder straps",
      "Boxed base, 15L capacity",
      "Interior slip pocket",
    ],
  },
  {
    slug: "bucket-hat",
    name: "Bucket Hat",
    priceUsd: 34,
    description: "Tie-dye cotton twill, one size",
    image: "/images/products/bucket-hat-model-1.png",
    category: "apparel",
    isNew: true,
    badge: "Limited Run",
    gallery: [
      "/images/products/bucket-hat-model-1.png",
      "/images/products/bucket-hat-model-2.png",
    ],
    sizes: ONE_SIZE,
    defaultSize: "One size",
    detail:
      "A rollout you can wear. Tie-dyed cotton twill with a structured brim and an embroidered mark on the front panel. No two are dyed exactly alike, which is either a feature or a bug depending on your appetite for variance.\n\nAdjustable inner band fits most heads.",
    features: [
      "Tie-dyed cotton twill",
      "Structured 2.5-inch brim",
      "Embroidered front panel",
      "Adjustable inner band",
    ],
  },
  {
    slug: "water-bottle",
    name: "Water Bottle",
    priceUsd: 29,
    description: "32oz insulated with carry loop",
    image: "/images/products/bottle-black.png",
    category: "accessories",
    badge: "Limited Run",
    gallery: [
      "/images/products/bottle-black.png",
      "/images/products/bottle-hand.png",
      "/images/products/bottle-model.png",
    ],
    sizes: ONE_SIZE,
    defaultSize: "One size",
    detail:
      "Stays cold through the longest incident. Double-walled stainless steel with a matte finish, a leakproof threaded lid, and a carry loop that clips to a bag. Thirty-two ounces, which is roughly one postmortem.\n\nCold for 24 hours, hot for 12.",
    features: [
      "32oz double-walled stainless steel",
      "Vacuum insulated, cold 24 hours",
      "Leakproof threaded lid",
      "Integrated carry loop",
    ],
  },
  {
    slug: "pool-float",
    name: "Pool Float",
    priceUsd: 42,
    description: "Oversized inflatable, ships flat",
    image: "/images/products/pool-float.png",
    category: "accessories",
    badge: "Limited Run",
    gallery: ["/images/products/pool-float.png"],
    sizes: ONE_SIZE,
    defaultSize: "One size",
    detail:
      "Ship it straight to the deep end. An oversized inflatable in the shape of the mark, rated for one adult and welded to survive a whole summer of poolside standups.\n\nInflates in about two minutes and packs back down flat.",
    features: [
      "Oversized inflatable, 5 feet across",
      "Heavy-gauge welded seams",
      "Rapid-inflation valve",
      "Packs flat into a reusable bag",
    ],
  },
  // Built from the two photos that were shot but never placed on a screen.
  // They are the same garment twice — polo-white-model.png is mislabelled; it
  // is this tee on a model, not a polo — so they make one product with two
  // angles rather than two products.
  //
  // Appended rather than slotted in beside the other apparel, so Jen's card
  // order on the homepage is left as she arranged it.
  //
  // No colors block: the only photography is white, and the design hides the
  // swatches below two anyway, so offering colourways we cannot show would be
  // the one dishonest thing on the page.
  {
    slug: "togglewear-tee",
    name: "ToggleWear Tee",
    priceUsd: 34,
    description: "Heavyweight cotton, relaxed fit",
    image: "/images/products/tee-white-hanger.png",
    category: "apparel",
    isNew: true,
    badge: "Limited Run",
    gallery: [
      "/images/products/polo-white-model.png",
      "/images/products/tee-white-hanger.png",
    ],
    sizes: APPAREL_SIZES,
    defaultSize: "M",
    detail:
      "The default variant. Heavyweight combed cotton in plain white, with the mark printed small on the left chest — the one you reach for on the days nothing else needs deciding.\n\nRelaxed fit with dropped shoulders; size down for a closer cut.",
    features: [
      "Heavyweight combed cotton",
      "Relaxed fit with dropped shoulders",
      "Printed LaunchDarkly mark on left chest",
      "Pre-shrunk and machine washable",
    ],
  },
];

// Early access for Loyalty Gold members, which is the promise Jen's loyalty
// hero already makes: "first dibs on new merch — before it drops for everyone
// else." Her designs show the same catalogue to both personas, so this tier
// is ours rather than hers, built from product photography she shot but did
// not place on any screen.
export const MEMBERS_ONLY: Product[] = [
  {
    slug: "togglewear-crewneck",
    name: "ToggleWear Crewneck",
    priceUsd: 58,
    description: "Midweight fleece, no hood",
    image: "/images/products/crewneck-black-front.png",
    category: "apparel",
    isNew: true,
    membersOnly: true,
    badge: "Early Access",
    gallery: [
      "/images/products/crewneck-black-front.png",
      "/images/products/crewneck-black-side.png",
    ],
    sizes: APPAREL_SIZES,
    defaultSize: "M",
    colors: [COLORS.black, COLORS.blue, COLORS.grey],
    detail:
      "The hoodie, shipped without the hood. Same midweight fleece and embroidered mark, cut a little cleaner for the days you need to look like you have it together.\n\nMembers see this one first.",
    features: [
      "Midweight fleece construction",
      "Embroidered LaunchDarkly logo on front chest",
      "Ribbed cuffs and hem",
      "Members-only colourway",
    ],
  },
];

// Jen's tech photography, one card each in her "Product images - Tech" frame
// (160:1311), in the order she laid them out. The power bank and the hub were
// shot twice, so they get both angles.
//
// A list of their own rather than more best sellers, so the homepage keeps
// the grid she designed and Tech is where they live.
//
// Priced like the real thing rather than like swag, which is what the $800
// review threshold in lib/fraudAgent.ts is set against: any one item goes
// through, and two of the big three are what gets an order held.
export const TECH: Product[] = [
  {
    slug: "power-bank",
    name: "Power Bank",
    priceUsd: 39,
    description: "10,000mAh, USB-C fast charge",
    image: "/images/products/power-bank-phone.png",
    category: "tech",
    badge: "Limited Run",
    gallery: [
      "/images/products/power-bank-phone.png",
      "/images/products/power-bank-briefcase.png",
    ],
    sizes: ONE_SIZE,
    defaultSize: "One size",
    detail:
      "Uptime you can carry. A pocket battery in a textured black shell with the mark on the front, small enough to ride on the back of a phone and big enough to fill one twice over.\n\nUSB-C in and out, with 20W fast charging.",
    features: [
      "10,000mAh capacity",
      "20W USB-C fast charging",
      "Charges two devices at once",
      "Textured, pocket-sized shell",
    ],
  },
  {
    slug: "usb-c-hub",
    name: "USB-C Hub",
    priceUsd: 49,
    description: "7-in-1 aluminum, 4K HDMI",
    image: "/images/products/usb-c-hub-laptop.png",
    category: "tech",
    badge: "Limited Run",
    gallery: [
      "/images/products/usb-c-hub-laptop.png",
      "/images/products/usb-c-hub-marble.png",
    ],
    sizes: ONE_SIZE,
    defaultSize: "One size",
    detail:
      "Every port, behind one connector. A brushed aluminum hub with the wordmark along the top and a braided cable short enough to live in a laptop sleeve.\n\nWorks on macOS, Windows and ChromeOS without a driver.",
    features: [
      "4K HDMI at 60Hz",
      "100W USB-C power passthrough",
      "Two USB-A 3.0 ports",
      "SD and microSD card readers",
    ],
  },
  {
    slug: "vr-headset",
    name: "VR Headset",
    priceUsd: 499,
    description: "Standalone, two motion controllers",
    image: "/images/products/vr-headset-model.png",
    category: "tech",
    badge: "Limited Run",
    gallery: ["/images/products/vr-headset-model.png"],
    sizes: ONE_SIZE,
    defaultSize: "One size",
    detail:
      "A preview environment you can stand in. A standalone headset with two tracked controllers and the wordmark across the visor, with no PC or cable to trip over.\n\nAdjustable head strap that fits over most glasses.",
    features: [
      "Standalone, no PC required",
      "Two tracked motion controllers",
      "128GB of storage",
      "Adjustable strap, glasses friendly",
    ],
  },
  {
    slug: "instant-camera",
    name: "Instant Print Camera",
    priceUsd: 129,
    description: "Prints 2x3 photos in seconds",
    image: "/images/products/instant-camera-hand.png",
    category: "tech",
    isNew: true,
    badge: "Limited Run",
    gallery: ["/images/products/instant-camera-hand.png"],
    sizes: ONE_SIZE,
    defaultSize: "One size",
    detail:
      "Snapshots that ship on the spot. A pocket camera in bright yellow with the mark on the lens ring, printing sticky-backed photos straight from the shutter, with no ink and no app.\n\nTen sheets of zero-ink paper in the box.",
    features: [
      "Prints 2x3-inch photos in seconds",
      "Zero-ink, sticky-backed paper",
      "Built-in selfie mirror",
      "USB-C rechargeable",
    ],
  },
  {
    slug: "action-camera",
    name: "Action Camera",
    priceUsd: 349,
    description: "5.3K video, waterproof to 33ft",
    image: "/images/products/action-camera.png",
    category: "tech",
    badge: "Limited Run",
    gallery: ["/images/products/action-camera.png"],
    sizes: ONE_SIZE,
    defaultSize: "One size",
    detail:
      "Record every release. A rugged camera with a screen on each side and the wordmark on the front, with stabilization that keeps a bike ride or a ski run steady.\n\nWaterproof to 33 feet without a housing.",
    features: [
      "5.3K video, 27MP photos",
      "Front and rear screens",
      "Built-in stabilization",
      "Waterproof to 33ft",
    ],
  },
  {
    slug: "bluetooth-speaker",
    name: "Bluetooth Speaker",
    priceUsd: 89,
    description: "Knit fabric, 12-hour battery",
    image: "/images/products/speaker.png",
    category: "tech",
    badge: "Limited Run",
    gallery: ["/images/products/speaker.png"],
    sizes: ONE_SIZE,
    defaultSize: "One size",
    detail:
      "Broadcast to the whole room. A compact speaker wrapped in black knit fabric with the mark low on the front and a woven strap to carry it by. Loud enough for a team lunch, small enough for a backpack.\n\nTwelve hours a charge, and fine in the rain.",
    features: [
      "360-degree sound",
      "12-hour battery",
      "IPX5 water resistant",
      "Woven carry strap",
    ],
  },
  {
    slug: "handheld-console",
    name: "Handheld Console",
    priceUsd: 399,
    description: "7-inch OLED, 512GB storage",
    image: "/images/products/handheld-console.png",
    category: "tech",
    badge: "Limited Run",
    gallery: ["/images/products/handheld-console.png"],
    sizes: ONE_SIZE,
    defaultSize: "One size",
    detail:
      "Play in production. A handheld gaming PC in matte black with the wordmark across the back, a bright OLED screen, and room for the backlog you keep meaning to get to.\n\nCharges over USB-C and docks to a TV.",
    features: [
      "7-inch OLED display",
      "512GB of storage",
      "Docks to a TV over USB-C",
      "Matte black shell",
    ],
  },
  {
    slug: "camera-drone",
    name: "Camera Drone",
    priceUsd: 599,
    description: "4K camera, folds to fit a bag",
    image: "/images/products/drone.png",
    category: "tech",
    badge: "Limited Run",
    gallery: ["/images/products/drone.png"],
    sizes: ONE_SIZE,
    defaultSize: "One size",
    detail:
      "Ship it to the skies. A folding drone with a stabilized 4K camera, obstacle sensing on every side, and a controller with its own screen, so there is no phone to clip on.\n\nUp to 34 minutes of flight per battery.",
    features: [
      "4K camera on a 3-axis gimbal",
      "Omnidirectional obstacle sensing",
      "Screen controller included",
      "Folds to fit a daypack",
    ],
  },
  {
    slug: "camera-gimbal",
    name: "Camera Gimbal",
    priceUsd: 139,
    description: "3-axis stabilizer, travel case",
    image: "/images/products/gimbal-case.png",
    category: "tech",
    badge: "Limited Run",
    gallery: ["/images/products/gimbal-case.png"],
    sizes: ONE_SIZE,
    defaultSize: "One size",
    detail:
      "Smooth rollouts, on camera. A three-axis stabilizer that keeps a phone or a compact camera steady through a walk-and-talk, packed in a zip case with the wordmark across the lid.\n\nUp to 12 hours a charge, with a tripod built into the handle.",
    features: [
      "3-axis stabilization",
      "Fits phones and compact cameras",
      "Tripod built into the handle",
      "Zip travel case included",
    ],
  },
  {
    slug: "wireless-headphones",
    name: "Wireless Headphones",
    priceUsd: 249,
    description: "Noise cancelling, 30-hour battery",
    image: "/images/products/headphones-stand.png",
    category: "tech",
    isNew: true,
    badge: "Limited Run",
    gallery: ["/images/products/headphones-stand.png"],
    sizes: ONE_SIZE,
    defaultSize: "One size",
    detail:
      "Focus mode, toggled on. Over-ear headphones with active noise cancelling, memory-foam cushions and the mark on each cup, for open-plan offices and long flights to the offsite.\n\nThirty hours a charge, and they fold flat into a case.",
    features: [
      "Active noise cancelling",
      "30-hour battery",
      "Memory-foam ear cushions",
      "Folds flat into a case",
    ],
  },
  {
    slug: "key-finder-set",
    name: "Key Finder Set",
    priceUsd: 69,
    description: "Four Bluetooth trackers, four colors",
    image: "/images/products/key-finders.png",
    category: "tech",
    isNew: true,
    badge: "Limited Run",
    gallery: ["/images/products/key-finders.png"],
    sizes: ONE_SIZE,
    defaultSize: "One size",
    detail:
      "Know where everything is deployed. Four Bluetooth trackers in lime, blue, pink and cyan, one each for keys, a bag, a bike and whatever goes missing next, with a speaker loud enough to find them under a couch.\n\nAbout a year on each replaceable battery.",
    features: [
      "Set of four, one in each color",
      "Built-in speaker",
      "Split ring on every tracker",
      "Replaceable year-long battery",
    ],
  },
  {
    slug: "wireless-mouse",
    name: "Wireless Mouse",
    priceUsd: 59,
    description: "Lightweight, 70-hour battery",
    image: "/images/products/mouse.png",
    category: "tech",
    badge: "Limited Run",
    gallery: ["/images/products/mouse.png"],
    sizes: ONE_SIZE,
    defaultSize: "One size",
    detail:
      "Point, click, ship. A 60-gram mouse in matte black with the mark on the palm, quiet switches, and a battery that outlasts most sprints.\n\nConnects over Bluetooth or the USB-C receiver in the box.",
    features: [
      "60g lightweight shell",
      "Quiet-click switches",
      "70-hour battery",
      "Bluetooth or USB-C receiver",
    ],
  },
];

export const ALL_PRODUCTS: Product[] = [...BEST_SELLERS, ...TECH, ...MEMBERS_ONLY];

export function productBySlug(slug: string) {
  return ALL_PRODUCTS.find((p) => p.slug === slug);
}

// The shot a card cross-fades to while the pointer is over it.
//
// Taken from the gallery the detail page already uses rather than from a new
// field, so there is nothing extra to keep in step: a product with a second
// angle gets the behaviour for free, and the canvas tote and the pool float,
// which were only ever photographed once, simply do not swap.
//
// The first gallery entry that is not already the card's own image, because
// several galleries lead with that image and fading a photo into itself looks
// like a flicker rather than a second look.
export function hoverImageFor(product: Product): string | undefined {
  return product.gallery.find((shot) => shot !== product.image);
}

export type PricingVariant = "default" | "loyaltyGold";

// Loyalty Gold members see a lower price. Jen's design shows the mechanic
// (original struck through, member price in bold) but both numbers are the
// same $48 placeholder, so the depth is set here as a single rate.
//
// This is the natural knob for a flag or experiment to turn, which is why it
// is a rate rather than eight separate member prices.
export const LOYALTY_DISCOUNT = 0.15;

// The new customer's code, which the announcement bar and the assistant both
// promise. Shallower than the member rate on purpose: at the same 15% a Gold
// membership would buy nothing you cannot get by typing a word, and the two
// personas would land on an identical total. At 10 against 15 you can switch
// persona mid-demo and point at two different numbers.
//
// Both strings that advertise this are built from these two values rather
// than written out, because a promise of 15% next to a 10% discount is the
// kind of drift nobody notices until a prospect does.
export const WELCOME_CODE = "WELCOME";
export const WELCOME_DISCOUNT = 0.1;

// The incentive in the cart reminder banner, for a shopper who came back to
// a cart they left on an earlier visit. A code rather than a discount applied
// automatically, because typing it is how a demo shows the banner was what
// brought them back. Same rate as WELCOME, and refused to members for the
// same reason: their 15% already beats it.
export const COMEBACK_CODE = "COMEBACK";
export const COMEBACK_DISCOUNT = 0.1;

// The Cart Recovery agent's cheaper incentive: a free sticker pack with the
// order rather than money off it. Members can use it too, since a gift does
// not compete with their pricing the way a second discount would.
export const STICKERS_CODE = "STICKERS";

export function memberPriceUsd(priceUsd: number) {
  return Math.round(priceUsd * (1 - LOYALTY_DISCOUNT));
}

export function formatPrice(priceUsd: number) {
  return `$${priceUsd} USD`;
}

// Jen's loyalty variant leads with the hoodie, one of the NEW items, instead
// of the cap. The rest of her order is unchanged.
const LOYALTY_LEAD_SLUG = "togglewear-hoodie";

export function bestSellersFor(variant: PricingVariant): Product[] {
  if (variant === "default") return BEST_SELLERS;

  const lead = BEST_SELLERS.find((p) => p.slug === LOYALTY_LEAD_SLUG);
  const rest = lead
    ? [lead, ...BEST_SELLERS.filter((p) => p.slug !== LOYALTY_LEAD_SLUG)]
    : BEST_SELLERS;

  // Members-only items come first, ahead of Jen's lead item, so the early
  // access is the first thing a member sees.
  return [...MEMBERS_ONLY, ...rest];
}

// Ordered as Jen lists them in the footer. "All Swag" is not here because it
// is the absence of a filter rather than a category.
export const CATEGORIES: { slug: ProductCategory; label: string }[] = [
  { slug: "apparel", label: "Apparel" },
  { slug: "accessories", label: "Accessories" },
  { slug: "tech", label: "Tech" },
];

// New Drops sits alongside the categories in the header but is not one — it
// reads isNew, which several products across the categories carry.
export type ProductFilter = ProductCategory | "new";

export function filterLabel(filter?: ProductFilter) {
  if (!filter) return "All Swag";
  if (filter === "new") return "New Drops";
  return CATEGORIES.find((c) => c.slug === filter)?.label ?? "All Swag";
}

// One place that knows the listing URL's shape, so the header, the footer,
// the best sellers link and the listing's own tabs cannot drift apart.
export function categoryHref(filter?: ProductFilter) {
  return filter ? `/products?category=${filter}` : "/products";
}

// Next hands query values through as string, string[] or undefined, and the
// value is whatever was in the URL — so this validates against the known set
// rather than trusting it, and an unrecognised one falls back to everything.
export function parseFilter(value: unknown): ProductFilter | undefined {
  if (value === "new") return "new";
  return CATEGORIES.find((c) => c.slug === value)?.slug;
}

// Listings start from the persona's catalogue rather than ALL_PRODUCTS, so a
// non-member browsing into Apparel never sees the members-only crewneck —
// the same rule the product page already enforces when reached by slug.
export function productsFor(
  variant: PricingVariant,
  filter?: ProductFilter,
): Product[] {
  const catalogue = [...bestSellersFor(variant), ...TECH];
  if (!filter) return catalogue;
  if (filter === "new") return catalogue.filter((p) => p.isNew);
  return catalogue.filter((p) => p.category === filter);
}
