import type { NextApiRequest, NextApiResponse } from "next";
import { LDObserve } from "@launchdarkly/observability-node";
import { contextFromRequest, getServerClient } from "@/lib/ldServer";
import { productBySlug, type Product } from "@/lib/products";
import { sizeChartFor, type SizeChart } from "@/lib/sizeGuide";

// The live half of a product page: what can be bought right now, as opposed
// to the copy and photography that are built into the page. Today that is the
// sizes on sale, the size guide's measurements and the SKU behind each size.
//
// Flag 05 decides, here on the server, which version of the catalog answers.
// v2 reads sizes off the product's size chart instead of the product record,
// so the size picker and the size guide can never disagree. It also tidied
// the response on the way, and the product page, written against v1, was
// never told. Each change breaks something different:
//
//   sizes       one-size items have no size chart, so v2 sends null rather
//               than ["One size"], and the page crashes drawing the picker
//   sizeChart   columns is renamed headings, so the Size Guide fails to open
//   skus        keyed by lowercase size, so Add to Cart finds no SKU for "M"
//   footwear    shoe sizes go through v2's new sizing service, which does not
//               answer in time, so the socks time out here with a 504
//
// The stock badge is the fifth, in pages/api/stock/[slug].ts. Nothing else on
// the server fails: apart from the timeout, every response is a 200 that the
// page cannot use. That is the release this flag exists to debug, with the
// errors in the browser and here, the cause in this route's logs and
// responses, and the session replay showing what the shopper saw.
export const FLAG_KEY = "catalogApiV2";

// v2's spelling of a size chart.
type SizeChartV2 = Omit<SizeChart, "columns"> & { headings: string[] };

export type CatalogResponse = {
  slug: string;
  catalogVersion: "v1" | "v2";
  sizes: string[] | null;
  sizeChart: SizeChart | SizeChartV2 | null;
  skus: Record<string, string>;
};

const SIZING_SERVICE_TIMEOUT_MS = 2500;

class SizingServiceTimeoutError extends Error {
  name = "SizingServiceTimeoutError";
}

// TW-TOGGLEWEAR-HOODIE-M, TW-CHECKERBOARD-SOCKS-SM, TW-BUCKET-HAT-ONESIZE.
function skuFor(product: Product, size: string) {
  return `TW-${product.slug}-${size.replace(/\W/g, "")}`.toUpperCase();
}

function toV2Chart({ columns, ...rest }: SizeChart): SizeChartV2 {
  return { ...rest, headings: columns };
}

function catalogV1(product: Product): CatalogResponse {
  return {
    slug: product.slug,
    catalogVersion: "v1",
    sizes: product.sizes,
    sizeChart: sizeChartFor(product.sizes) ?? null,
    skus: Object.fromEntries(product.sizes.map((s) => [s, skuFor(product, s)])),
  };
}

function catalogV2(product: Product): CatalogResponse {
  const chart = sizeChartFor(product.sizes);
  return {
    slug: product.slug,
    catalogVersion: "v2",
    sizes: chart ? product.sizes : null,
    sizeChart: chart ? toV2Chart(chart) : null,
    skus: Object.fromEntries(
      product.sizes.map((s) => [s.toLowerCase(), skuFor(product, s)]),
    ),
  };
}

// Stands in for v2's sizing service, which never answers inside the budget.
async function convertShoeSizes(): Promise<never> {
  await new Promise((resolve) => setTimeout(resolve, SIZING_SERVICE_TIMEOUT_MS));
  throw new SizingServiceTimeoutError(
    `Sizing service did not answer within ${SIZING_SERVICE_TIMEOUT_MS}ms`,
  );
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<CatalogResponse | { error: string }>,
) {
  const product = productBySlug(String(req.query.slug));
  if (!product) {
    res.status(404).json({ error: "Product not found" });
    return;
  }

  const client = await getServerClient();
  if (!client) {
    res.status(200).json(catalogV1(product));
    return;
  }

  // A span of its own, continuing the trace the browser started, so this
  // request sits under the shopper's session in LaunchDarkly. The flag
  // evaluation inside it is recorded on the span by the plugin.
  await LDObserve.runWithHeaders("catalog.getProduct", req.headers, async (span) => {
    const { secureSessionId, requestId } = LDObserve.parseHeaders(req.headers);
    const context = contextFromRequest(req.headers);
    const useV2 = await client.variation(FLAG_KEY, context, false);
    const body = useV2 ? catalogV2(product) : catalogV1(product);
    const attributes = {
      "catalog.version": body.catalogVersion,
      "product.slug": product.slug,
      "product.category": product.category,
    };

    span.setAttributes({
      ...attributes,
      "catalog.sizes_count": body.sizes?.length ?? 0,
    });

    if (useV2 && body.sizeChart?.kind === "footwear") {
      try {
        await convertShoeSizes();
      } catch (err) {
        const error = err as Error;
        LDObserve.recordError(error, secureSessionId, requestId, attributes, { span });
        res.status(504).json({ error: error.message });
        return;
      }
    }

    if (body.sizes === null) {
      LDObserve.recordLog(
        `No size chart for ${product.slug}; returning sizes: null`,
        "warn",
        secureSessionId,
        requestId,
        attributes,
      );
    }

    res.status(200).json(body);
  });
}
