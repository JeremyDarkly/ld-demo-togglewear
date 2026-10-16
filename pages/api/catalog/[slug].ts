import type { NextApiRequest, NextApiResponse } from "next";
import type { LDContext } from "@launchdarkly/node-server-sdk";
import { LDObserve } from "@launchdarkly/observability-node";
import { getServerClient } from "@/lib/ldServer";
import { productBySlug, type Product } from "@/lib/products";
import { sizeChartFor } from "@/lib/sizeGuide";

// The live half of a product page: what can be bought right now, as opposed
// to the copy and photography that are built into the page. Today that is the
// list of sizes on sale.
//
// Flag 05 decides, here on the server, which version of the catalog answers.
// v2 reads sizes off the product's size chart instead of the product record,
// so the size picker and the size guide can never disagree. Its bug is that
// one-size items have no size chart, and v2 returns sizes: null for them
// rather than ["One size"]. Nothing on the server fails: the response is a
// 200 that the product page cannot render. That is the release this flag
// exists to debug, with the error in the browser, the cause in this route's
// logs and response, and the session replay showing what the shopper saw.
export const FLAG_KEY = "catalogApiV2";

export type CatalogResponse = {
  slug: string;
  catalogVersion: "v1" | "v2";
  sizes: string[] | null;
};

// The browser sends the context it was evaluated with, so the server lands
// the shopper on the same side of any rollout the storefront did. A real
// storefront would look the shopper up from a session cookie; there is no
// account system behind this one to look them up in.
function contextFrom(header: string | string[] | undefined): LDContext {
  const fallback: LDContext = {
    kind: "user",
    key: "catalog-anonymous",
    anonymous: true,
  };
  if (typeof header !== "string") return fallback;
  try {
    const context = JSON.parse(header);
    return context && typeof context.key === "string" ? context : fallback;
  } catch {
    return fallback;
  }
}

function catalogV1(product: Product): CatalogResponse {
  return { slug: product.slug, catalogVersion: "v1", sizes: product.sizes };
}

function catalogV2(product: Product): CatalogResponse {
  const chart = sizeChartFor(product.sizes);
  return {
    slug: product.slug,
    catalogVersion: "v2",
    sizes: chart ? product.sizes : null,
  };
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
    const context = contextFrom(req.headers["x-ld-context"]);
    const useV2 = await client.variation(FLAG_KEY, context, false);
    const body = useV2 ? catalogV2(product) : catalogV1(product);

    span.setAttributes({
      "catalog.version": body.catalogVersion,
      "product.slug": product.slug,
      "product.category": product.category,
      "catalog.sizes_count": body.sizes?.length ?? 0,
    });

    if (body.sizes === null) {
      LDObserve.recordLog(
        `No size chart for ${product.slug}; returning sizes: null`,
        "warn",
        secureSessionId,
        requestId,
        {
          "catalog.version": body.catalogVersion,
          "product.slug": product.slug,
          "product.category": product.category,
        },
      );
    }

    res.status(200).json(body);
  });
}
