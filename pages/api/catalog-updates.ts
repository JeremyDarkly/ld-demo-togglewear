import type { NextApiRequest, NextApiResponse } from "next";
import type { LDClient } from "@launchdarkly/node-server-sdk";
import { getServerClient } from "@/lib/ldServer";
import { FLAG_KEY } from "@/pages/api/catalog/[slug]";

// Tells an open product page that flag 05 changed, so it asks the catalog
// again instead of keeping the answer it got on load (lib/catalog.ts). The
// server SDK hears the change over its own streaming connection; this passes
// it on as server-sent events. Only that it changed, never the value: the
// flag is evaluated on the server, and the browser still learns which
// catalog it got only from what the catalog sends back.

// Under the 60 seconds NGINX, in front of the store in its cluster, waits on
// a quiet connection before closing it. EventSource reconnects by itself
// either way, but a dropped connection can miss a change.
const HEARTBEAT_MS = 25_000;

// One listener on the SDK client for every open page, rather than one each,
// which would trip Node's warning at eleven tabs.
const pages = new Set<() => void>();
let listeningTo: LDClient | null = null;

function listen(client: LDClient) {
  if (listeningTo === client) return;
  client.on(`update:${FLAG_KEY}`, () => pages.forEach((notify) => notify()));
  listeningTo = client;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).end();
    return;
  }

  // No client, no changes to pass on. A 204 is what tells EventSource to
  // stop reconnecting.
  const client = await getServerClient();
  if (!client) {
    res.status(204).end();
    return;
  }
  listen(client);

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    // no-transform keeps Next's gzip from buffering the stream, and
    // X-Accel-Buffering does the same for NGINX.
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(": connected\n\n");

  const notify = () => res.write("event: change\ndata: {}\n\n");
  const heartbeat = setInterval(() => res.write(": keep-alive\n\n"), HEARTBEAT_MS);
  pages.add(notify);

  // Held open until the page goes, so Next does not take the handler
  // returning as a response that was never sent.
  await new Promise<void>((resolve) => {
    res.on("close", () => {
      clearInterval(heartbeat);
      pages.delete(notify);
      resolve();
    });
  });
}
