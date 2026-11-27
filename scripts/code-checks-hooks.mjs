// Module hooks for code-checks.test.mjs, on top of tool-call-errors-hooks.mjs:
// swaps the store's LaunchDarkly server client for globalThis.stubClient, so
// the routes read the response-code-checks flag from, and send their events
// to, a client the script controls.
const stub = new URL("./code-checks-ld-server.mjs", import.meta.url).href;

export async function resolve(specifier, context, next) {
  if (specifier === "@/lib/ldServer") return { url: stub, shortCircuit: true };
  return next(specifier, context);
}
