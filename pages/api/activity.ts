import type { NextApiRequest, NextApiResponse } from "next";
import { getServerClient } from "@/lib/ldServer";
import { onActivity, recentActivity, type Activity } from "@/lib/activity";

// The Live tab of Under the hood, as server-sent events: what the feed
// already holds when the tab opens, then each entry as it happens. An entry
// that repeats (lib/activity.ts) is sent again under the same id with its new
// count, and the tab replaces it.
//
// The same streaming setup as catalog-updates.ts, for the same proxies.
const HEARTBEAT_MS = 25_000;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).end();
    return;
  }

  // Starts the server SDK if nothing has yet, so the first evaluations and
  // changes have somewhere to be reported from.
  void getServerClient();

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  // Sends the headers now; with an empty feed nothing else would until the
  // first entry, and the tab would sit on "connecting".
  res.write(": connected\n\n");

  const send = (entry: Activity) => res.write(`data: ${JSON.stringify(entry)}\n\n`);
  recentActivity().forEach(send);
  const stop = onActivity(send);
  const heartbeat = setInterval(() => res.write(": keep-alive\n\n"), HEARTBEAT_MS);

  await new Promise<void>((resolve) => {
    res.on("close", () => {
      clearInterval(heartbeat);
      stop();
      resolve();
    });
  });
}
