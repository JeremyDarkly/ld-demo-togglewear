import type { NextApiRequest, NextApiResponse } from "next";
import { LDObserve } from "@launchdarkly/observability-node";
import { FLAG_KEY } from "@/pages/api/catalog/[slug]";
import { contextFromRequest, getServerClient } from "@/lib/ldServer";
import { productBySlug } from "@/lib/products";

// The badge in the corner of a product page, asked for separately because
// stock changes by the minute while the rest of the page does not.
//
// Catalog v2 moves stock lookups behind the new inventory gateway, which has
// no route for them yet. The gateway answers with its own HTML error page, as
// gateways do, and the product page, which only ever got JSON from v1, parses
// it anyway. That is flag 05's quietest failure: the page still works, the
// badge just reads "Stock unavailable", and the SyntaxError it records says
// "Unexpected token '<'".
export type StockResponse = { slug: string; badge: string };

const GATEWAY_ERROR_PAGE = `<html>
<head><title>502 Bad Gateway</title></head>
<body>
<center><h1>502 Bad Gateway</h1></center>
<hr><center>togglewear-inventory-gateway</center>
</body>
</html>
`;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<StockResponse | { error: string } | string>,
) {
  const product = productBySlug(String(req.query.slug));
  if (!product) {
    res.status(404).json({ error: "Product not found" });
    return;
  }

  const client = await getServerClient();
  if (!client) {
    res.status(200).json({ slug: product.slug, badge: product.badge });
    return;
  }

  await LDObserve.runWithHeaders("inventory.getStock", req.headers, async (span) => {
    const { secureSessionId, requestId } = LDObserve.parseHeaders(req.headers);
    const useV2 = await client.variation(FLAG_KEY, contextFromRequest(req.headers), false);
    const attributes = {
      "catalog.version": useV2 ? "v2" : "v1",
      "product.slug": product.slug,
    };
    span.setAttributes(attributes);

    if (useV2) {
      LDObserve.recordLog(
        `Inventory gateway has no route for ${req.url}; answered 502`,
        "error",
        secureSessionId,
        requestId,
        attributes,
      );
      res.status(502).setHeader("Content-Type", "text/html").send(GATEWAY_ERROR_PAGE);
      return;
    }

    res.status(200).json({ slug: product.slug, badge: product.badge });
  });
}
