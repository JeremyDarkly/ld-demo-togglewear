// The Order Decision as the store's Jev variation makes it (lib/jev.ts), for
// ci_eval.py's offline evals (demo_provisioning_scripts/ci_eval.py), which
// send one request on stdin, {"config", "order", "points"}: the variation as
// the SDK hands it over, the agent's input and the total points. It writes
// one line back: {"answer"}, the JSON the route answers with (runJev in
// pages/api/order-review/index.ts), with what Jev chose, how sure it was and
// its usage, or {"error"} when Jev could not answer. Needs TYPESAFE_API_KEY,
// and no npm install:
//
//   node --no-warnings --import ./scripts/tool-call-errors-register.mjs scripts/jev-decision.mjs
import { text } from "node:stream/consumers";

const { jevDecision } = await import("../lib/jev.ts");
const { summaryFor } = await import("../lib/fraudAgent.ts");

let reply;
try {
  const { config, order, points } = JSON.parse(await text(process.stdin));
  if (typeof order !== "string" || typeof points !== "number") throw new Error("no order or points");
  const made = await jevDecision(config, order, points);
  reply = {
    answer: JSON.stringify({ decision: made.decision, score: points, summary: summaryFor(made.decision) }),
    choice: made.choice,
    confidence: made.confidence,
    fellBack: made.fellBack,
    usage: made.usage,
  };
} catch (error) {
  reply = { error: `${error?.name ?? "Error"}: ${error?.message ?? error}` };
}
process.stdout.write(`${JSON.stringify(reply)}\n`);
