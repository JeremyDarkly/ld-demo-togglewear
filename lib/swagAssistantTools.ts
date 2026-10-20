import type { LDContext } from "@launchdarkly/node-server-sdk";
import type { ToolRegistry } from "@launchdarkly/server-sdk-ai";
import { tierStatusFor } from "@/lib/account";
import {
  LOYALTY_DISCOUNT,
  WELCOME_CODE,
  WELCOME_DISCOUNT,
  filterLabel,
  memberPriceUsd,
  productsFor,
  type Product,
} from "@/lib/products";
import { isGuest, isMember, shopperById, variantFor } from "@/lib/shopper";
import { sizeChartFor } from "@/lib/sizeGuide";

// What the swag assistant's tools actually do. Their names, descriptions and
// argument schemas live in LaunchDarkly (AI_TOOLS in demo_resources.py), and
// are attached to the Swag Assistant's variations there, so a variation only
// reaches the functions here that LaunchDarkly gives it. The keys below have
// to match those tool keys exactly; a tool LaunchDarkly offers with no
// function here is skipped with a warning.
//
// Every tool reads the catalogue as this shopper sees it, so a non-member
// cannot be told about the members-only crewneck by asking the assistant
// rather than the search box.

// The shopper the request was made as. A guest's context carries no key we
// know, which shopperById turns into the guest rather than into a person.
function shopperFor(context: LDContext) {
  return shopperById(typeof context.key === "string" ? context.key : "");
}

function summary(product: Product, member: boolean) {
  return {
    slug: product.slug,
    name: product.name,
    price_usd: product.priceUsd,
    ...(member && { member_price_usd: memberPriceUsd(product.priceUsd) }),
    description: product.description,
    category: filterLabel(product.category),
    is_new: Boolean(product.isNew),
    members_only: Boolean(product.membersOnly),
    sizes: product.sizes,
  };
}

// Looser than the storefront's search box, which wants every word to match:
// a model asks things like "warm hoodie for winter", and nothing in the
// catalogue says "winter". Products are ranked by how many words they match
// instead, across the long copy and features as well as the name.
function matches(product: Product, terms: string[]) {
  const text = [
    product.name,
    product.description,
    product.detail,
    filterLabel(product.category),
    ...product.features,
  ]
    .join(" ")
    .toLowerCase();
  return terms.filter((term) => text.includes(term)).length;
}

const MAX_RESULTS = 6;

export type SwagAssistantTools = {
  registry: ToolRegistry;
  // Every product a tool told the model about, so the reply can show cards
  // for the ones it went on to recommend and none that it made up.
  seenSlugs: Set<string>;
};

export function swagAssistantTools(context: LDContext): SwagAssistantTools {
  const person = shopperFor(context);
  const member = isMember(person);
  const catalogue = productsFor(variantFor(person.tier));
  const seenSlugs = new Set<string>();

  const registry: ToolRegistry = {
    "search-products": (args: {
      query?: string;
      category?: string;
      max_price_usd?: number;
      new_only?: boolean;
    }) => {
      const terms = (args.query ?? "")
        .toLowerCase()
        .split(/\W+/)
        .filter((term) => term.length > 2);

      const results = catalogue
        .filter(
          (p) =>
            (!args.category ||
              filterLabel(p.category).toLowerCase() ===
                args.category.toLowerCase()) &&
            (args.max_price_usd === undefined ||
              p.priceUsd <= args.max_price_usd) &&
            (!args.new_only || p.isNew),
        )
        .map((p) => ({ product: p, score: terms.length ? matches(p, terms) : 1 }))
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_RESULTS)
        .map((r) => r.product);

      results.forEach((p) => seenSlugs.add(p.slug));
      return { results: results.map((p) => summary(p, member)) };
    },

    "get-product-details": (args: { slug?: string }) => {
      const product = catalogue.find((p) => p.slug === args.slug);
      if (!product) {
        return {
          error: `No product with slug "${args.slug}". Use search-products to find one.`,
        };
      }
      seenSlugs.add(product.slug);
      const chart = sizeChartFor(product.sizes);
      return {
        ...summary(product, member),
        detail: product.detail,
        features: product.features,
        colors: product.colors?.map((c) => c.name) ?? [],
        size_chart: chart
          ? {
              columns: ["Size", ...chart.columns],
              rows: chart.rows.map((r) => [r.size, ...r.values]),
              note: chart.note,
            }
          : null,
      };
    },

    // The numbers come from the same constants the cart charges with, so
    // the assistant cannot promise a discount checkout will not give.
    "get-member-perks": () => {
      if (isGuest(person)) {
        return {
          signed_in: false,
          loyalty_tier: "none",
          discount_codes: [
            {
              code: WELCOME_CODE,
              percent_off: WELCOME_DISCOUNT * 100,
              applies_to: "a first order",
            },
          ],
          shipping: "Free on every order, delivered in 3 to 5 business days",
          membership: `Gold and Platinum members get ${
            LOYALTY_DISCOUNT * 100
          }% off everything and early access to members-only drops.`,
        };
      }

      const status = tierStatusFor(person);
      return {
        signed_in: true,
        name: person.name,
        loyalty_tier: person.tier,
        member_discount_percent: member ? LOYALTY_DISCOUNT * 100 : 0,
        // Member pricing already beats every code, and checkout refuses
        // codes for members rather than stacking them.
        discount_codes: member
          ? []
          : [
              {
                code: WELCOME_CODE,
                percent_off: WELCOME_DISCOUNT * 100,
                applies_to: "a first order",
              },
            ],
        early_access: member
          ? "Sees members-only drops, such as the ToggleWear Crewneck, before anyone else"
          : null,
        shipping: "Free on every order, delivered in 3 to 5 business days",
        loyalty_points: status.points,
        current_reward: status.current,
        next_reward: status.atTop ? null : status.next,
        points_to_next_reward: status.atTop
          ? 0
          : Math.max(status.target - status.points, 0),
      };
    },
  };

  return { registry, seenSlugs };
}
