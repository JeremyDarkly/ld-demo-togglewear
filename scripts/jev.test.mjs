// Asks the Order Decision agent's Jev variation (lib/jev.ts) through a
// scripted fetch, and checks the decision it makes, the threshold it falls
// back under and each way Jev can fail. No TypeSafe key or network needed.
// With the other tests:
//
//   npm test
//
// or on its own:
//
//   node --no-warnings --test scripts/jev.test.mjs
import "./tool-call-errors-register.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { INVALID_SPAN_CONTEXT, trace } from "@opentelemetry/api";

const { JevError, isJevConfig, jevDecision } = await import("../lib/jev.ts");
const { runJev } = await import("../pages/api/order-review/index.ts");
const { startAgentRun } = await import("../lib/llmTrace.ts");
const { summaryFor } = await import("../lib/fraudAgent.ts");

// The variation as the SDK hands it over, with model.custom as LaunchDarkly
// stores it: the criteria's keys sorted.
const config = {
  provider: { name: "TypeSafe" },
  model: {
    name: "jev-1.14.0",
    custom: {
      choice_confidence_min: 0.7,
      criteria: { approve: "Under 40 points.", decline: "70 points or more.", review: "40 to 69 points." },
      criteria_order: ["review", "decline", "approve"],
    },
  },
  instructions: "Decide what happens to this order.",
};

const answer = (choice, confidence) => ({
  model: "jev-1.14.0",
  answers: { decision: { choice, confidence, probabilities: { [choice]: confidence } } },
  usage: { input_tokens: 600 },
});

const timeout = () => Object.assign(new Error("timed out"), { name: "TimeoutError" });

// A 200 whose body times out on the way, as an abort while it is read does.
const stalledBody = () =>
  new Response(new ReadableStream({ start: (controller) => controller.error(timeout()) }), { status: 200 });

// A fetch that answers with each of replies in turn, a number being an HTTP
// status with no body, a string a body as it is, a Response itself, and
// records what it was asked.
function scripted(...replies) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    const reply = replies.shift();
    if (reply instanceof Error) throw reply;
    if (reply instanceof Response) return reply;
    if (typeof reply === "number") return new Response("upstream trouble", { status: reply });
    if (typeof reply === "string") return new Response(reply, { status: 200 });
    return Response.json(reply);
  };
  return { calls, options: { apiKey: "test-key", fetchImpl } };
}

test("a TypeSafe variation is Jev, and a Bedrock one is not", () => {
  assert.equal(isJevConfig(config), true);
  assert.equal(isJevConfig({ provider: { name: "Bedrock" } }), false);
  assert.equal(isJevConfig({}), false);
});

test("Jev's choice is the decision, asked with the options in criteria_order", async () => {
  const { calls, options } = scripted(answer("decline", 0.96));
  const made = await jevDecision(config, "Order TW-1. Shipping Check: 80 points.", 80, options);

  assert.equal(made.decision, "decline");
  assert.equal(made.fellBack, false);
  assert.deepEqual(made.usage, { total: 600, input: 600, output: 0 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.headers.Authorization, "Bearer test-key");
  assert.equal(calls[0].body.model, "jev-1.14.0");
  assert.deepEqual(calls[0].body.state, { order_review: "Order TW-1. Shipping Check: 80 points.", risk_points: 80 });
  const question = calls[0].body.questions.decision;
  assert.equal(question.type, "choice");
  assert.equal(question.instructions, "Decide what happens to this order.");
  assert.deepEqual(Object.keys(question.criteria), ["review", "decline", "approve"]);
});

test("under the threshold, the decision is the one the points call for", async () => {
  const { options } = scripted(answer("approve", 0.55));
  const made = await jevDecision(config, "Order TW-2.", 45, options);
  assert.equal(made.choice, "approve");
  assert.equal(made.fellBack, true);
  assert.equal(made.decision, "review");
});

test("a timeout, a 5xx or a body that times out is tried once more", async () => {
  for (const first of [timeout(), 503, stalledBody()]) {
    const { calls, options } = scripted(first, answer("approve", 0.99));
    assert.equal((await jevDecision(config, "Order TW-3.", 0, options)).decision, "approve");
    assert.equal(calls.length, 2);
  }
});

test("each way Jev can fail is a JevError", async () => {
  const failures = {
    "no key": [{ apiKey: "", fetchImpl: async () => assert.fail("Jev was called without a key") }],
    "a 4xx": [scripted(401).options],
    "a second 5xx": [scripted(500, 502).options],
    "a missing confidence": [
      scripted({ model: "jev-1.14.0", answers: { decision: { choice: "approve", probabilities: {} } }, usage: { input_tokens: 1 } }).options,
    ],
    "a choice that is not a decision": [scripted(answer("escalate", 0.9)).options],
    "a body that times out twice": [scripted(stalledBody(), stalledBody()).options],
  };
  // A confidence that is not a number from 0 to 1 would pass any threshold,
  // or none, so it is no answer. JSON has no Infinity, but 1e999 parses to it.
  for (const confidence of [1.5, -0.1, "0.9", null]) {
    failures[`a confidence of ${confidence}`] = [scripted(answer("approve", confidence)).options];
  }
  failures["an infinite confidence"] = [
    scripted(JSON.stringify(answer("approve", 0.9)).replace('"confidence":0.9', '"confidence":1e999')).options,
  ];
  for (const [name, [options]] of Object.entries(failures)) {
    await assert.rejects(jevDecision(config, "Order TW-4.", 0, options), JevError, name);
  }
  const noCriteria = { ...config, model: { name: "jev-1.14.0", custom: {} } };
  await assert.rejects(jevDecision(noCriteria, "Order TW-4.", 0, scripted().options), JevError);
});

// A tracer that keeps each span's attributes by its name, for what the
// route's spans say about the call.
const spans = {};
trace.setGlobalTracerProvider({
  getTracer: () => ({
    startSpan(name, options) {
      const attributes = (spans[name] = { ...options?.attributes });
      const recorded = {
        setAttribute: (key, value) => ((attributes[key] = value), span),
        setAttributes: (more) => (Object.assign(attributes, more), span),
      };
      const span = new Proxy(recorded, { get: (target, key) => target[key] ?? (() => span) });
      return span;
    },
  }),
});

test("the route answers with Jev's decision and the store's message for it", async () => {
  const { options } = scripted(answer("review", 0.91));
  const agentRun = startAgentRun(trace.wrapSpanContext(INVALID_SPAN_CONTEXT), "check", "Order Decision", "", "Order TW-5.");
  const ran = await runJev(config, "Order TW-5.", 45, agentRun, undefined, options);
  assert.deepEqual(JSON.parse(ran.text), { decision: "review", score: 45, summary: summaryFor("review") });
  assert.equal(ran.metrics.success, true);
  assert.equal(ran.metrics.tokens.input, 600);
  // TypeSafe serves the call, not Bedrock, on the agent's span and the call's.
  assert.equal(spans["invoke_agent Order Decision"]["gen_ai.provider.name"], "typesafe");
  assert.equal(spans["chat jev-1.14.0"]["gen_ai.provider.name"], "typesafe");
});
