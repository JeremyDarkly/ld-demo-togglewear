// The Swag Assistant's real tools (lib/swagAssistantTools.ts), called as a
// given shopper (an id from lib/shopper.ts; "guest" is the guest). Imported by
// swag-tool-results.mjs, and run by ci_eval.py's stand-in tools
// (demo_provisioning_scripts/swag_tools.py), which send one call per line on
// stdin, {"shopper", "tool", "args"}, and read one line back for each:
// {"output"}, or {"error"} when the call could not be made. No LaunchDarkly or
// AWS credentials needed:
//
//   node --no-warnings --import ./scripts/tool-call-errors-register.mjs scripts/swag-tools.mjs
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

const { swagAssistantTools } = await import("../lib/swagAssistantTools.ts");

// The context the route is called with (pages/api/swag-assistant/index.ts).
export function contextFor(shopper) {
  return shopper === "guest"
    ? { kind: "user", key: "guest", anonymous: true }
    : { kind: "user", key: shopper };
}

// What the tool returns, as the route hands it to the model.
export async function callSwagTool(shopper, name, args) {
  const tool = swagAssistantTools(contextFor(shopper)).registry[name];
  if (!tool) throw new Error(`no tool named ${name}`);
  return tool(args ?? {});
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  for await (const line of createInterface({ input: process.stdin })) {
    if (!line.trim()) continue;
    let reply;
    try {
      const { shopper, tool, args } = JSON.parse(line);
      if (typeof shopper !== "string" || !shopper) throw new Error("no shopper");
      reply = { output: await callSwagTool(shopper, tool, args) };
    } catch (error) {
      reply = { error: String(error?.message ?? error) };
    }
    process.stdout.write(`${JSON.stringify(reply)}\n`);
  }
}
