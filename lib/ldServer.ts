import { init, type LDClient } from "@launchdarkly/node-server-sdk";
import { Observability } from "@launchdarkly/observability-node";

// The storefront's server-side LaunchDarkly client, for the API routes that
// evaluate flags themselves rather than leaving it to the browser.
//
// Built once per server process and shared: the SDK holds a streaming
// connection open, and starting one per request would be slow and would
// count every request as a new SDK in LaunchDarkly. The observability plugin
// is registered with it, which is what makes LDObserve from
// @launchdarkly/observability-node usable at all — before the plugin is
// registered its calls throw rather than doing nothing.
//
// Resolves to null rather than rejecting when there is no SDK key or
// LaunchDarkly cannot be reached, so a route can fall back to its old
// behaviour instead of failing every request. A failed start is retried, but
// no more than once a minute: a bad key fails every time, and each attempt
// registers another observability plugin.
const RETRY_AFTER_MS = 60_000;

let clientPromise: Promise<LDClient | null> | null = null;
let failedAt = 0;

export function getServerClient(): Promise<LDClient | null> {
  if (!clientPromise) {
    if (Date.now() - failedAt < RETRY_AFTER_MS) return Promise.resolve(null);

    const sdkKey = process.env.LD_SDK_KEY;
    if (!sdkKey) {
      console.warn("LD_SDK_KEY is not set — server-side flags will read off");
      return Promise.resolve(null);
    }
    const client = init(sdkKey, {
      plugins: [
        new Observability({
          serviceName: "togglewear-api",
          serviceVersion: process.env.NEXT_PUBLIC_APP_VERSION,
        }),
      ],
    });
    clientPromise = client
      .waitForInitialization({ timeout: 5 })
      .then(() => client)
      .catch((err) => {
        console.warn("LaunchDarkly server client failed to start", err);
        clientPromise = null;
        failedAt = Date.now();
        client.close();
        return null;
      });
  }
  return clientPromise;
}
