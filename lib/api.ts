import type { LDClient } from "launchdarkly-react-client-sdk";

// Headers for the storefront's own API routes: the context the browser was
// evaluated with, so a route evaluating a flag on the server sees the same
// shopper.
export function apiHeaders(client: LDClient): Record<string, string> {
  return { "x-ld-context": JSON.stringify(client.getContext()) };
}
