import type { IncomingHttpHeaders } from "http";
import {
  init,
  type LDClient,
  type LDContext,
} from "@launchdarkly/node-server-sdk";
import { Observability } from "@launchdarkly/observability-node";
import { activityHook, recordActivity } from "@/lib/activity";
import { FlagStore } from "@/lib/flagStore";

// The storefront's server-side LaunchDarkly client, for the API routes that
// evaluate flags themselves rather than leaving it to the browser, and for
// the demo generator (lib/generator).
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

// The store behind the current client, for the demo generator (lib/flagStore.ts).
let store: FlagStore | null = null;

export function getServerClient(): Promise<LDClient | null> {
  if (!clientPromise) {
    if (Date.now() - failedAt < RETRY_AFTER_MS) return Promise.resolve(null);

    const sdkKey = process.env.LD_SDK_KEY;
    if (!sdkKey) {
      console.warn("LD_SDK_KEY is not set — server-side flags will read off");
      return Promise.resolve(null);
    }
    store = new FlagStore();
    const client = init(sdkKey, {
      featureStore: store,
      plugins: [
        new Observability({
          serviceName: "togglewear-api",
          serviceVersion: process.env.NEXT_PUBLIC_APP_VERSION,
        }),
      ],
      // Reports each evaluation to the Live tab of Under the hood.
      hooks: [activityHook],
    });
    client.on("update", ({ key }: { key: string }) =>
      recordActivity({
        kind: "change",
        title: `LaunchDarkly streamed a change to ${key}`,
        detail: "No redeploy and no restart: the next evaluation uses it",
      }),
    );
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

// Whether a guarded rollout is still running on the flag, as far as the
// streamed flag data says. False with no client, so a generator waiting on
// one simply keeps waiting.
export function rolloutRunning(flagKey: string) {
  return store?.rolloutRunning(flagKey) ?? false;
}

// The browser sends the context it was evaluated with, so the server lands
// the shopper on the same side of any rollout the storefront did. A real
// storefront would look the shopper up from a session cookie; there is no
// account system behind this one to look them up in.
const ANONYMOUS: LDContext = {
  kind: "user",
  key: "server-anonymous",
  anonymous: true,
};

export function contextFromRequest(headers: IncomingHttpHeaders): LDContext {
  const header = headers["x-ld-context"];
  if (typeof header !== "string") return ANONYMOUS;
  try {
    const context = JSON.parse(header);
    return context && typeof context.key === "string" ? context : ANONYMOUS;
  } catch {
    return ANONYMOUS;
  }
}
