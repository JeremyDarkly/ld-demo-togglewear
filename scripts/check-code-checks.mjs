// Checks lib/codeChecks.ts against the cases code_checks.py is tested
// against, then runs the Order Review graph and the Personal Stylist's check
// on a scripted model and a stubbed LaunchDarkly client, and checks the
// code-check-* events they send with the response-code-checks flag off and
// on. No LaunchDarkly or AWS credentials needed:
//
//   node --no-warnings --import ./scripts/code-checks-register.mjs scripts/check-code-checks.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { INVALID_SPAN_CONTEXT, trace } from "@opentelemetry/api";
import { AIMessage, ToolMessage } from "@langchain/core/messages";

const codeChecks = await import("../lib/codeChecks.ts");
const { runGraph } = await import("../pages/api/order-review/index.ts");
const { checkReply } = await import("../pages/api/personal-stylist/index.ts");

// ---- The cases ----

const CHECKS = {
  "decision-matches-points": (output, i) =>
    codeChecks.decisionMatchesPoints(output, i.expected_decision, i.risk_points),
  "stylist-reply-usable": (output, i) => codeChecks.stylistReplyUsable(output, i.sizes, i.catalog),
  "case-note-covers-the-case": (output, i) =>
    codeChecks.caseNoteCoversTheCase(output, i.expected_decision, i.signal_points),
  "demo-summary-names-decision": (output) => codeChecks.demoSummaryNamesDecision(output),
};

const cases = JSON.parse(
  readFileSync(new URL("../.github/workflows/demo_provisioning_scripts/code_check_cases.json", import.meta.url)),
);
for (const c of cases) {
  const result = CHECKS[c.check](c.output, c.input);
  assert.deepEqual(
    { passes: result.score >= 1, reasons: result.reasons },
    { passes: c.passes, reasons: c.reasons },
    `${c.check}: ${c.name}`,
  );
}
console.log(`cases: all ${cases.length} match code_check_cases.json`);

// ---- The Order Review graph, scripted ----

const context = { kind: "user", key: "guest", anonymous: true };
const span = trace.wrapSpanContext(INVALID_SPAN_CONTEXT);
const trackDataOf = (key) => ({ variationKey: "standard", configKey: key, version: 1, modelName: "scripted" });
const trackerFor = (key) => ({
  getTrackData: () => trackDataOf(key),
  trackMetricsOf: async (_metrics, fn) => fn(),
  trackJudgeResult: () => {},
  resumptionToken: "token",
});
const nothing = new Proxy({}, { get: () => () => {} });

const TOOLS = { "payment-risk-agent": "check-payment-risk", "shipping-check-agent": "check-shipping-address" };
const POLICY_JUDGE = "togglewear-decision-policy-judge";
const CHILDREN = {
  "order-intake-agent": ["payment-risk-agent", "shipping-check-agent", "account-history-agent"],
  "payment-risk-agent": ["fraud-decision-agent"],
  "shipping-check-agent": ["fraud-decision-agent"],
  "account-history-agent": ["fraud-decision-agent"],
  "fraud-decision-agent": ["case-note-agent"],
  "case-note-agent": [],
};

// A model that answers as whichever agent's instructions it was given: a
// specialist calls its tool, then answers; the Order Decision agent fills in
// decision; the Case Note agent writes note.
function scripted({ decision, note }) {
  const model = {
    bindTools: () => model,
    withStructuredOutput: () => ({ invoke: async () => ({ parsed: decision, raw: new AIMessage("") }) }),
    invoke: async (messages) => {
      const agent = messages[0].content;
      const tool = TOOLS[agent];
      if (tool && !(messages.at(-1) instanceof ToolMessage)) {
        return new AIMessage({ content: "", tool_calls: [{ id: "call", type: "tool_call", name: tool, args: {} }] });
      }
      return new AIMessage(agent === "case-note-agent" ? note : `${agent} found what it found.`);
    },
  };
  globalThis.scriptedModel = model;
}

function aiClient(judged) {
  const node = (key) => ({
    getKey: () => key,
    getConfig: () => ({
      model: {
        name: "scripted",
        parameters: { tools: TOOLS[key] ? [{ type: "function", name: TOOLS[key], parameters: { type: "object", properties: {} } }] : [] },
      },
      instructions: key,
      judgeConfiguration: key === "fraud-decision-agent" ? { judges: [{ key: POLICY_JUDGE, samplingRate: 1 }] } : undefined,
      createTracker: () => trackerFor(key),
    }),
  });
  const graph = {
    enabled: true,
    createTracker: () => nothing,
    getNode: node,
    rootNode: () => node("order-intake-agent"),
    getChildNodes: (key) => CHILDREN[key].map(node),
  };
  return {
    agentGraph: async () => graph,
    createJudge: async (key) => ({
      evaluate: async () => ({ judgeConfigKey: key, ...judged }),
      getAIConfig: () => ({ createTracker: () => trackerFor(key) }),
    }),
  };
}

// A client that serves the flag as flag (a function to throw), and records
// what is sent.
function stubClient(flag, { trackThrows = false } = {}) {
  const sent = [];
  globalThis.stubClient = {
    variation: async (key, _ctx, fallback) =>
      key === codeChecks.CODE_CHECKS_FLAG ? (typeof flag === "function" ? flag() : flag) : fallback,
    track: (key, ctx, data, value) => {
      if (trackThrows) throw new Error("send failed");
      sent.push({ key, ctx, data, value });
    },
  };
  return sent;
}

const order = (zip, total) => ({
  ref: "TW-1",
  lines: [{ slug: "togglewear-cap", size: "One Size", quantity: 1 }],
  total,
  shipTo: { name: "A", line1: "1 Main St", city: "Oakland", state: "CA", zip },
  payment: "visa",
});

const GOOD_NOTE =
  "Order TW-1 was held for review at 45 points. The total is over $800 (45 points). The shopper is a guest. Please check it.";

async function review({ flag, decision, note = GOOD_NOTE, judged = { sampled: true, success: true, score: 0.9 }, zip = "94607", total = 900, trackThrows }) {
  const sent = stubClient(flag, { trackThrows });
  scripted({ decision, note });
  let assessment;
  const ran = await runGraph(aiClient(judged), context, order(zip, total), () => {}, (a) => (assessment = a), span, (err) => {
    throw err;
  });
  assert.equal(ran, true);
  // The judges run without anything waiting on them.
  await new Promise((resolve) => setTimeout(resolve, 20));
  const checks = sent.filter((s) => s.key.startsWith("code-check-"));
  for (const s of checks) {
    assert.equal(s.ctx, context);
    assert.equal(typeof s.data.reason, "string");
    assert.ok(s.data.reason.length <= 300);
  }
  // Sorted, since the judge's disagreement lands whenever the judge answers.
  const byKey = (a, b) => `${a.key} ${a.data.configKey}`.localeCompare(`${b.key} ${b.data.configKey}`);
  checks.sort(byKey);
  return { assessment, events: checks.map((s) => [s.key, s.data.configKey, s.value]), sent: checks };
}

const held = { decision: "review", score: 45, summary: "Your order is under review before it ships." };

// Flag off: no check runs, nothing is sent, the review is the same.
{
  const { assessment, events } = await review({ flag: false, decision: held });
  assert.deepEqual(events, []);
  assert.equal(assessment.decision, "review");
  console.log("order review, flag false: no code-check events");
}

// Flag unreadable: treated as off.
{
  const { events } = await review({ flag: () => { throw new Error("no flag"); }, decision: held });
  assert.deepEqual(events, []);
  console.log("order review, flag unreadable: off, no code-check events");
}

// Flag on, a right decision the judge passes.
{
  const { assessment, events } = await review({ flag: true, decision: held });
  assert.equal(assessment.decision, "review");
  assert.deepEqual(events, [
    ["code-check-case-note-covers-the-case", "case-note-agent", 0],
    ["code-check-decision-matches-points", "fraud-decision-agent", 0],
    ["code-check-demo-summary-names-decision", "fraud-decision-agent", 0],
    ["code-check-error", "case-note-agent", 0],
    ["code-check-error", "fraud-decision-agent", 0],
    ["code-check-judge-disagreement", "fraud-decision-agent", 0],
  ]);
  console.log("order review, flag true: each check 0, error 0, judge agrees 0");
}

// Flag on, the model says review on a blocked ZIP: the check reads the
// model's decision, the guard still declines, and the judge that passed it
// disagrees with the check. The weak check passes a summary that names the
// wrong decision, and the note is checked against the final decision.
{
  const { assessment, events, sent } = await review({
    flag: true,
    zip: "99999",
    decision: held,
    note: "Order TW-1 was held. The ZIP matches a reshipping address (80 points). The total is over $800 (45 points). Nothing was charged.",
  });
  assert.equal(assessment.decision, "decline");
  assert.deepEqual(events, [
    ["code-check-case-note-covers-the-case", "case-note-agent", 1],
    ["code-check-decision-matches-points", "fraud-decision-agent", 1],
    ["code-check-demo-summary-names-decision", "fraud-decision-agent", 0],
    ["code-check-error", "case-note-agent", 0],
    ["code-check-error", "fraud-decision-agent", 0],
    ["code-check-judge-disagreement", "fraud-decision-agent", 1],
  ]);
  assert.equal(sent[1].data.reason, "decision 'review' isn't 'decline'; score 45 isn't 100 points");
  assert.deepEqual(sent[1].data, { ...trackDataOf("fraud-decision-agent"), reason: sent[1].data.reason });
  assert.equal(sent[0].data.reason, "doesn't say it was declined");
  console.log("order review, flag true: model's decision checked before the guard, judge disagreement 1");
}

// The weak check fails a right decision put another way.
{
  const { events } = await review({
    flag: true,
    decision: { ...held, summary: "We've held your order while someone takes a look." },
  });
  assert.deepEqual(events.slice(1, 3), [
    ["code-check-decision-matches-points", "fraud-decision-agent", 0],
    ["code-check-demo-summary-names-decision", "fraud-decision-agent", 1],
  ]);
  console.log("order review, flag true: weak check fails a right decision put another way");
}

// No disagreement when the judge was skipped or errored.
for (const judged of [
  { sampled: false, success: true, score: 0.9 },
  { sampled: true, success: false, errorMessage: "model failed" },
]) {
  const { events } = await review({ flag: true, decision: held, judged });
  assert.ok(!events.some(([key]) => key === "code-check-judge-disagreement"), JSON.stringify(judged));
}
console.log("order review, flag true: no judge disagreement when the judge was skipped or errored");

// A send that throws leaves the review as it was.
{
  const { assessment } = await review({ flag: true, decision: held, trackThrows: true });
  assert.equal(assessment.decision, "review");
  console.log("order review, flag true: a send that throws leaves the decision as it was");
}

// ---- The Personal Stylist ----

const product = { sizes: ["S", "M", "L"] };
const catalog = [{ slug: "togglewear-cap" }];
const stylist = async (flag, raw) => {
  const sent = stubClient(flag);
  await checkReply(globalThis.stubClient, context, trackDataOf("personal-stylist"), raw, product, catalog);
  return sent.map((s) => [s.key, s.value, s.data.reason]);
};
assert.deepEqual(await stylist(false, '{"size": "XXL"}'), []);
console.log("personal stylist, flag false: no code-check events");
assert.deepEqual(await stylist(true, '{"size": "M", "pairing": "togglewear-cap", "note": "M fits."}'), [
  ["code-check-stylist-reply-usable", 0, ""],
  ["code-check-error", 0, ""],
]);
assert.deepEqual(await stylist(true, '```json\n{"size": "XXL", "pairing": "togglewear-cap", "note": "XXL fits."}\n```'), [
  ["code-check-stylist-reply-usable", 1, "size 'XXL' isn't one of S, M, L"],
  ["code-check-error", 0, ""],
]);
console.log("personal stylist, flag true: the raw reply is checked, before the page drops its size");

// ---- A check that throws ----
{
  const sent = stubClient(true);
  const results = codeChecks.runCodeChecks(globalThis.stubClient, context, trackDataOf("x"), {
    "decision-matches-points": () => {
      throw new Error("broke");
    },
    "demo-summary-names-decision": () => codeChecks.demoSummaryNamesDecision("{}"),
  });
  assert.deepEqual(Object.keys(results), ["demo-summary-names-decision"]);
  assert.deepEqual(
    sent.map((s) => [s.key, s.value, s.data.reason]),
    [
      ["code-check-demo-summary-names-decision", 0, ""],
      ["code-check-error", 1, "decision-matches-points: broke"],
    ],
  );
  console.log("a check that throws: no event of its own, code-check-error 1");
}

console.log("All code check checks passed.");
