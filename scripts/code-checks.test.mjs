// Checks lib/codeChecks.ts against the cases code_checks.py is tested
// against, then runs the Order Review graph and the Personal Stylist's check
// on a scripted model and a stubbed LaunchDarkly client, and checks the
// code-check-* events they send with the response-code-checks flag off and
// on. The graph runs through the AI SDK itself, which is handed the stub
// client with initClient, so it never starts one of its own; the stub serves
// the graph, its agents and the judge as flag values. No LaunchDarkly or AWS
// credentials needed. With the other tests:
//
//   npm test
//
// or on its own:
//
//   node --no-warnings --test scripts/code-checks.test.mjs
import "./code-checks-register.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { INVALID_SPAN_CONTEXT, trace } from "@opentelemetry/api";
import { AIMessage, ToolMessage } from "@langchain/core/messages";

const { initClient } = await import("@launchdarkly/ai-node");
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
  test(`case ${c.check}: ${c.name}`, () => {
    const result = CHECKS[c.check](c.output, c.input);
    assert.deepEqual(
      { passes: result.score >= 1, reasons: result.reasons },
      { passes: c.passes, reasons: c.reasons },
    );
  });
}

// ---- The Order Review graph, scripted ----

const context = { kind: "user", key: "guest", anonymous: true };
const span = trace.wrapSpanContext(INVALID_SPAN_CONTEXT);
const trackDataOf = (key) => ({ variationKey: "standard", configKey: key, version: 1, modelName: "scripted" });

const GRAPH = "order-review";
const TOOLS = { "payment-risk-agent": "check-payment-risk", "shipping-check-agent": "check-shipping-address" };
const POLICY_JUDGE = "togglewear-decision-policy-judge";
const POLICY_METRIC = "$ld:ai:judge:decision-policy";
const SPECIALIST_POLICY = "specialist-judge-decision-policy";
const SPECIALISTS = ["payment-risk-agent", "shipping-check-agent", "account-history-agent"];
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

// The flag values LaunchDarkly would serve: the graph's topology, each
// agent's config, with the policy judge on the Order Decision agent at
// samplingRate, and the judge's own config.
function flagValue(key, samplingRate) {
  if (key === GRAPH) {
    return {
      _ldMeta: { enabled: true, variationKey: "graph", version: 1 },
      root: "order-intake-agent",
      edges: Object.fromEntries(Object.entries(CHILDREN).map(([from, to]) => [from, to.map((k) => ({ key: k }))])),
    };
  }
  if (key === POLICY_JUDGE) {
    return {
      _ldMeta: { enabled: true, variationKey: "judge", version: 1, mode: "judge" },
      model: { name: "scripted-judge" },
      provider: { name: "bedrock" },
      messages: [{ role: "system", content: "Score the decision." }],
      evaluationMetricKey: POLICY_METRIC,
    };
  }
  if (key in CHILDREN) {
    const tool = TOOLS[key];
    return {
      _ldMeta: { enabled: true, variationKey: "standard", version: 1, mode: "agent" },
      model: { name: "scripted" },
      provider: { name: "bedrock" },
      instructions: key,
      ...(tool && { tools: { [tool]: { type: "function", name: tool, parameters: { type: "object", properties: {} } } } }),
      ...(key === "fraud-decision-agent" && { judgeConfiguration: { judges: [{ key: POLICY_JUDGE, samplingRate }] } }),
    };
  }
  return undefined;
}

// The one client the AI SDK keeps, passing everything to whichever stub
// client the case set up.
await initClient({
  variation: (...args) => globalThis.stubClient.variation(...args),
  track: (...args) => globalThis.stubClient.track(...args),
  flush: async () => {},
  close: () => {},
});

// A client that serves the flag as flag (a function to throw) and the
// graph's configs, and records what is sent. With trackThrows, the store's
// own code-check events fail to send.
function stubClient(flag, { trackThrows = false, samplingRate = 1 } = {}) {
  const sent = [];
  globalThis.stubClient = {
    variation: async (key, _ctx, fallback) =>
      key === codeChecks.CODE_CHECKS_FLAG
        ? typeof flag === "function" ? flag() : flag
        : flagValue(key, samplingRate) ?? fallback,
    track: (key, ctx, data, value) => {
      if (trackThrows && key.startsWith("code-check-")) throw new Error("send failed");
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

const PASSES = JSON.stringify({ score: 0.9, reasoning: "The decision follows from the points." });

// judged is the judge's reply, or an Error for a judge model that fails.
async function review({ flag, decision, note = GOOD_NOTE, judged = PASSES, samplingRate, zip = "94607", total = 900, trackThrows }) {
  const sent = stubClient(flag, { trackThrows, samplingRate });
  scripted({ decision, note });
  globalThis.judgeReply = judged;
  let assessment;
  const errors = [];
  const ran = await runGraph(context, order(zip, total), () => {}, (a) => (assessment = a), span, (err) => errors.push(err));
  assert.equal(ran, true);
  // The judges run without anything waiting on them.
  await new Promise((resolve) => setTimeout(resolve, 50));
  const all = [...sent];
  const checks = sent.filter((s) => s.key.startsWith("code-check-"));
  for (const s of checks) {
    assert.equal(s.ctx, context);
    assert.equal(typeof s.data.reason, "string");
    assert.ok(s.data.reason.length <= 300);
  }
  // Sorted, since the judge's disagreement lands whenever the judge answers.
  const byKey = (a, b) => `${a.key} ${a.data.configKey}`.localeCompare(`${b.key} ${b.data.configKey}`);
  checks.sort(byKey);
  return { assessment, events: checks.map((s) => [s.key, s.data.configKey, s.value]), sent: checks, all, errors };
}

const held = { decision: "review", score: 45, summary: "Your order is under review before it ships." };

// Flag off: no check runs, nothing is sent, the review is the same.
test("order review, flag false: no code-check events", async () => {
  const { assessment, events } = await review({ flag: false, decision: held });
  assert.deepEqual(events, []);
  assert.equal(assessment.decision, "review");
});

// Flag unreadable: treated as off.
test("order review, flag unreadable: off, no code-check events", async () => {
  const { events } = await review({ flag: () => { throw new Error("no flag"); }, decision: held });
  assert.deepEqual(events, []);
});

// Flag on, a right decision the judge passes.
test("order review, flag true: each check 0, error 0, judge agrees 0", async () => {
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
});

// Flag on, the model says review on a blocked ZIP: the check reads the
// model's decision, the guard still declines, and the judge that passed it
// disagrees with the check. The weak check passes a summary that names the
// wrong decision, and the note is checked against the final decision.
test("order review, flag true: model's decision checked before the guard, judge disagreement 1", async () => {
  const { assessment, events, sent, all } = await review({
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
  // On the Order Decision agent's run, as the SDK recorded it.
  const decided = all.find(
    (s) => s.key === "$ld:ai:generation:success" && s.data.configKey === "fraud-decision-agent",
  );
  assert.deepEqual(sent[1].data, { ...decided.data, reason: sent[1].data.reason });
  assert.equal(sent[1].data.graphKey, GRAPH);
  assert.equal(sent[0].data.reason, "doesn't say it was declined");
});

// The weak check fails a right decision put another way.
test("order review, flag true: weak check fails a right decision put another way", async () => {
  const { events } = await review({
    flag: true,
    decision: { ...held, summary: "We've held your order while someone takes a look." },
  });
  assert.deepEqual(events.slice(1, 3), [
    ["code-check-decision-matches-points", "fraud-decision-agent", 0],
    ["code-check-demo-summary-names-decision", "fraud-decision-agent", 1],
  ]);
});

// No disagreement when the judge was not sampled, its model failed, or its
// reply did not parse. Only the last sends judge-parse-error 1; a judge that
// did not run, or threw, had no reply to parse.
for (const [label, options, parseError] of [
  ["not sampled", { samplingRate: 0 }, []],
  ["model failed", { judged: new Error("model failed") }, []],
  ["reply did not parse", { judged: "Looks fine to me." }, [1]],
]) {
  test(`order review, flag true: no judge disagreement when the judge ${label === "not sampled" ? "was not sampled" : label}`, async () => {
    const { events, all, errors } = await review({ flag: true, decision: held, ...options });
    assert.ok(!events.some(([key]) => key === "code-check-judge-disagreement"));
    assert.ok(!all.some((s) => s.key === POLICY_METRIC));
    assert.ok(!all.some((s) => s.key === SPECIALIST_POLICY));
    assert.deepEqual(all.filter((s) => s.key === "judge-parse-error").map((s) => s.value), parseError);
    assert.equal(errors.length, label === "model failed" ? 1 : 0);
  });
}

// The events a held order's review sends, by who sends them: the SDK's for
// each agent's run and each handoff into a node run with from, and the
// store's for the graph, the specialists' handoffs to the decision, the
// judge's score and whether it parsed.
test("order review: every agent's run, the graph's events, the handoffs and the judge's score are sent", async () => {
  const { all } = await review({ flag: false, decision: held });
  const count = (key, configKey) =>
    all.filter((s) => s.key === key && (configKey === undefined || s.data.configKey === configKey)).length;
  const agents = Object.keys(CHILDREN);
  for (const agent of agents) {
    assert.equal(count("$ld:ai:generation:success", agent), 1, agent);
    assert.equal(count("$ld:ai:duration:total", agent), 1, agent);
  }
  assert.equal(count("$ld:ai:generation:error"), 0);
  assert.equal(count("$ld:ai:tool_call"), 2);
  assert.deepEqual(
    all.filter((s) => s.key === "$ld:ai:graph:node").map((s) => [s.data.nodeKey, s.data.index]),
    [
      ["order-intake-agent", 0],
      ["payment-risk-agent", 1],
      ["shipping-check-agent", 2],
      ["account-history-agent", 3],
      ["fraud-decision-agent", 4],
      ["case-note-agent", 5],
    ],
  );
  assert.deepEqual(
    all.filter((s) => s.key === "$ld:ai:graph:handoff_success").map((s) => `${s.data.sourceKey} > ${s.data.targetKey}`).sort(),
    [
      "account-history-agent > fraud-decision-agent",
      "fraud-decision-agent > case-note-agent",
      "order-intake-agent > account-history-agent",
      "order-intake-agent > payment-risk-agent",
      "order-intake-agent > shipping-check-agent",
      "payment-risk-agent > fraud-decision-agent",
      "shipping-check-agent > fraud-decision-agent",
    ],
  );
  assert.equal(count("$ld:ai:graph:invocation_success"), 1);
  assert.equal(count("$ld:ai:graph:duration:total"), 1);
  assert.equal(count("$ld:ai:graph:invocation_failure"), 0);
  const score = all.find((s) => s.key === POLICY_METRIC);
  assert.equal(score.value, 0.9);
  assert.equal(score.data.configKey, "fraud-decision-agent");
  assert.equal(score.data.judgeConfigKey, POLICY_JUDGE);
  assert.equal(count("$ld:ai:generation:success", POLICY_JUDGE), 1);
  assert.deepEqual(all.filter((s) => s.key === "judge-parse-error").map((s) => [s.data.configKey, s.value]), [[POLICY_JUDGE, 0]]);
});

// The Decision Policy judge's score lands on each specialist's run too, as
// the SDK recorded it, with the judge's key; the intake, the decision and
// the case note get none.
test("order review: the Decision Policy judge's score is sent on each specialist", async () => {
  const { all } = await review({ flag: false, decision: held });
  const sent = all.filter((s) => s.key === SPECIALIST_POLICY);
  assert.deepEqual(sent.map((s) => s.data.configKey).sort(), [...SPECIALISTS].sort());
  for (const s of sent) {
    assert.equal(s.ctx, context);
    assert.equal(s.value, 0.9);
    const ran = all.find((r) => r.key === "$ld:ai:generation:success" && r.data.configKey === s.data.configKey);
    assert.deepEqual(s.data, { ...ran.data, judgeConfigKey: POLICY_JUDGE });
  }
});

// A send that throws leaves the review as it was.
test("order review, flag true: a send that throws leaves the decision as it was", async () => {
  const { assessment } = await review({ flag: true, decision: held, trackThrows: true });
  assert.equal(assessment.decision, "review");
});

// ---- The Personal Stylist ----

const product = { sizes: ["S", "M", "L"] };
const catalog = [{ slug: "togglewear-cap" }];
const stylist = async (flag, raw) => {
  const sent = stubClient(flag);
  await checkReply(globalThis.stubClient, context, trackDataOf("personal-stylist"), raw, product, catalog);
  return sent.map((s) => [s.key, s.value, s.data.reason]);
};
test("personal stylist, flag false: no code-check events", async () => {
  assert.deepEqual(await stylist(false, '{"size": "XXL"}'), []);
});
test("personal stylist, flag true: the raw reply is checked, before the page drops its size", async () => {
  assert.deepEqual(await stylist(true, '{"size": "M", "pairing": "togglewear-cap", "note": "M fits."}'), [
    ["code-check-stylist-reply-usable", 0, ""],
    ["code-check-error", 0, ""],
  ]);
  assert.deepEqual(await stylist(true, '```json\n{"size": "XXL", "pairing": "togglewear-cap", "note": "XXL fits."}\n```'), [
    ["code-check-stylist-reply-usable", 1, "size 'XXL' isn't one of S, M, L"],
    ["code-check-error", 0, ""],
  ]);
});

// ---- A check that throws ----
test("a check that throws: no event of its own, code-check-error 1", async () => {
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
});

// ---- order-decision-error, on every decision ----
// Not a code check, but sent by the same route on the Order Decision agent's
// run whatever the response-code-checks flag serves.
const decisionErrors = (sent) =>
  sent.filter((s) => s.key === "order-decision-error").map((s) => [s.data.configKey, s.data.variationKey, s.value]);

test("a usable decision: order-decision-error 0 on the Order Decision agent's run", async () => {
  const { all } = await review({ flag: false, decision: held });
  assert.deepEqual(decisionErrors(all), [["fraud-decision-agent", "standard", 0]]);
});

test("no usable decision: order-decision-error 1, and the review throws to fall back", async () => {
  const sent = stubClient(false);
  scripted({ decision: null, note: GOOD_NOTE });
  await assert.rejects(runGraph(context, order("94607", 900), () => {}, () => {}, span, () => {}));
  assert.deepEqual(decisionErrors(sent), [["fraud-decision-agent", "standard", 1]]);
});
