// Runs the Swag Assistant's and the Order Review's tool loops against a
// scripted model and checks the ai-tool-call-error each tool call sends.
// No LaunchDarkly or AWS credentials needed:
//
//   node --no-warnings --import ./scripts/tool-call-errors-register.mjs scripts/check-tool-call-errors.mjs
import assert from "node:assert/strict";
import { INVALID_SPAN_CONTEXT, trace } from "@opentelemetry/api";
import { AIMessage } from "@langchain/core/messages";

const { converse } = await import("../pages/api/swag-assistant/index.ts");
const { runAgent } = await import("../pages/api/order-review/index.ts");
const { swagAssistantTools } = await import("../lib/swagAssistantTools.ts");
const { orderReviewTools } = await import("../lib/orderReviewTools.ts");
const { startAgentRun } = await import("../lib/llmTrace.ts");
const { toolCallReporter } = await import("../lib/toolCallErrors.ts");

const context = { kind: "user", key: "guest", anonymous: true };
const trackData = { variationKey: "standard", configKey: "swag-assistant", version: 1, modelName: "scripted" };

// A model that asks for these tool calls, then answers.
function scripted(calls) {
  const replies = [
    new AIMessage({ content: "", tool_calls: calls.map((c, i) => ({ id: `call-${i}`, type: "tool_call", ...c })) }),
    new AIMessage("Here is what I found."),
  ];
  const model = { invoke: async () => replies.shift(), bindTools: () => model };
  globalThis.scriptedModel = model;
}

function recorder() {
  const sent = [];
  const client = { track: (key, ctx, data, value) => sent.push({ key, ctx, data, value }) };
  return { sent, report: toolCallReporter(client, context, trackData) };
}

const agentRun = (name) =>
  startAgentRun(trace.wrapSpanContext(INVALID_SPAN_CONTEXT), "check", name, "", "question");

const toolDefs = (...names) => names.map((name) => ({ type: "function", name, parameters: { type: "object", properties: {} } }));

function expectSent(sent, expected) {
  assert.deepEqual(
    sent.map((s) => [s.key, s.data.toolKey, s.value]),
    expected.map(([toolKey, value]) => ["ai-tool-call-error", toolKey, value]),
  );
  for (const s of sent) {
    assert.deepEqual(s.data, { ...trackData, toolKey: s.data.toolKey });
    assert.equal(s.ctx, context);
  }
}

// Swag Assistant: an unknown tool, a bad slug, an empty search and a good lookup.
{
  const { sent, report } = recorder();
  scripted([
    { name: "get-weather", args: {} },
    { name: "get-product-details", args: { slug: "no-such-thing" } },
    { name: "search-products", args: { query: "zzzzqqq" } },
    { name: "get-product-details", args: { slug: "togglewear-cap" } },
  ]);
  const config = {
    model: { name: "scripted", parameters: { tools: toolDefs("search-products", "get-product-details") } },
    messages: [],
  };
  const result = await converse(config, [], "question", swagAssistantTools(context), agentRun("Swag Assistant"), report);
  assert.ok(result.toolTranscript[2].endsWith('{"results":[]}'), result.toolTranscript[2]);
  expectSent(sent, [
    ["get-weather", 1],
    ["get-product-details", 1],
    ["search-products", 0],
    ["get-product-details", 0],
  ]);
  assert.deepEqual(result.metrics.toolCalls, ["get-weather", "get-product-details", "search-products", "get-product-details"]);
  console.log("swag assistant: unknown tool 1, bad slug 1, empty search 0, good lookup 0");
}

// Swag Assistant: a tool that throws is reported before the throw ends the reply.
{
  const { sent, report } = recorder();
  scripted([{ name: "explode", args: {} }]);
  const tools = swagAssistantTools(context);
  tools.registry.explode = () => {
    throw new Error("tool broke");
  };
  const config = { model: { name: "scripted", parameters: { tools: toolDefs("explode") } }, messages: [] };
  await assert.rejects(converse(config, [], "question", tools, agentRun("Swag Assistant"), report), /tool broke/);
  expectSent(sent, [["explode", 1]]);
  console.log("swag assistant: throwing tool 1, and the error still reaches the route");
}

// A failed send never breaks the reply.
{
  scripted([{ name: "search-products", args: { query: "cap" } }]);
  const report = toolCallReporter({ track: () => { throw new Error("send failed"); } }, context, trackData);
  const config = { model: { name: "scripted", parameters: { tools: toolDefs("search-products") } }, messages: [] };
  const result = await converse(config, [], "question", swagAssistantTools(context), agentRun("Swag Assistant"), report);
  assert.equal(result.content, "Here is what I found.");
  console.log("swag assistant: a send that throws leaves the reply as it was");
}

// Order Review agent: an unknown tool and a good one.
{
  const { sent, report } = recorder();
  scripted([
    { name: "get-weather", args: {} },
    { name: "check-payment-risk", args: {} },
  ]);
  const order = {
    ref: "TW-1",
    lines: [{ slug: "togglewear-cap", size: "One Size", quantity: 1 }],
    total: 25,
    shipTo: { name: "A", line1: "1 Main St", city: "Oakland", state: "CA", zip: "94607" },
    payment: "visa",
  };
  const config = {
    model: { name: "scripted", parameters: { tools: toolDefs("check-payment-risk") } },
    instructions: "",
  };
  const result = await runAgent(config, "input", orderReviewTools(order, context).registry, agentRun("Payment Risk"), report);
  assert.equal(result.text, "Here is what I found.");
  expectSent(sent, [
    ["get-weather", 1],
    ["check-payment-risk", 0],
  ]);
  console.log("order review: unknown tool 1, good call 0");
}

console.log("All tool call error checks passed.");
