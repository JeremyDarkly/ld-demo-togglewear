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

// The Swag Assistant's run through the AI SDK, with the store's handler, on
// a stub LaunchDarkly client: the SDK sends $ld:ai:tool_call for each call
// and the run's own events, and the store's ai-tool-call-error lands on the
// same run, whether the variation carries its tools as 1.0 reads them or
// only in model.parameters.tools, as the legacy SDK also read them.
{
  const { initClient, config: aiConfig } = await import("@launchdarkly/ai-node");
  const { storeHandlers, runTrackDataOf, toolFunctions } = await import("../lib/aiServer.ts");
  const { renderedMessages } = await import("../lib/langchainModel.ts");

  const sent = [];
  const track = (key, ctx, data, value) => sent.push({ key, ctx, data, value });
  let served;
  await initClient({ variation: async () => served, track, flush: async () => {}, close: () => {} });

  const definition = (name) => ({ type: "function", name, parameters: { type: "object", properties: {} } });
  const shapes = {
    "top-level tools": {
      model: { name: "scripted" },
      tools: { "search-products": definition("search-products"), "get-product-details": definition("get-product-details") },
    },
    "model.parameters.tools": {
      model: { name: "scripted", parameters: { tools: toolDefs("search-products", "get-product-details") } },
    },
  };
  for (const [shape, carried] of Object.entries(shapes)) {
    sent.length = 0;
    served = {
      _ldMeta: { enabled: true, variationKey: "standard", version: 3, mode: "completion" },
      provider: { name: "bedrock" },
      messages: [{ role: "system", content: "Help {{shopper_name}}." }],
      ...carried,
    };
    scripted([
      { name: "search-products", args: { query: "cap" } },
      { name: "get-product-details", args: { slug: "no-such-thing" } },
    ]);
    const tools = swagAssistantTools(context);
    let system;
    const handler = storeHandlers(async (config, _input, toolHandlers = {}, vars) => {
      const trackData = runTrackDataOf(vars);
      const messages = renderedMessages(config, vars);
      system = messages[0].content;
      const result = await converse(
        { ...config, messages },
        [],
        "question",
        tools,
        agentRun("Swag Assistant"),
        toolCallReporter({ track }, context, trackData),
        toolFunctions(toolHandlers, tools.registry, context, trackData),
      );
      return { output: result.content, usage: { input: 120, output: 30 } };
    });
    const ran = await aiConfig({ key: "swag-assistant", handler, toolHandlers: tools.registry, skipJudges: true })
      .invoke("question", context, { shopper_name: "Alex" });

    // The SDK's reports on itself ($ld:ai:sdk:info and $ld:ai:sdk:usage)
    // are not the run's.
    const run = sent.filter((s) => !s.key.startsWith("$ld:ai:sdk:"));
    assert.equal(system, "Help Alex.");
    assert.equal(ran.response, "Here is what I found.");
    const { runId } = ran.trackData;
    assert.ok(runId);
    assert.deepEqual(
      run.map((s) => [s.key, s.data.toolKey ?? null, s.value]),
      [
        ["$ld:ai:tool_call", "search-products", 1],
        ["ai-tool-call-error", "search-products", 0],
        ["$ld:ai:tool_call", "get-product-details", 1],
        ["ai-tool-call-error", "get-product-details", 1],
        ["$ld:ai:duration:total", null, run[4].value],
        ["$ld:ai:generation:success", null, 1],
        ["$ld:ai:tokens:total", null, 150],
        ["$ld:ai:tokens:input", null, 120],
        ["$ld:ai:tokens:output", null, 30],
      ],
      shape,
    );
    for (const s of run) {
      assert.equal(s.data.runId, runId, `${shape}: ${s.key} on the run`);
      assert.equal(s.data.variationKey, "standard");
      assert.equal(s.data.configKey, "swag-assistant");
    }
    console.log(`swag assistant through the SDK, ${shape}: one $ld:ai:tool_call per call, errors on the same run`);
  }

  // An answer the handler throws away is a generation error that still
  // spends its tokens, on the same run, since the SDK sends tokens only for
  // an answer a handler returns.
  const { UnusableAnswer, ConfigChanged } = await import("../lib/aiServer.ts");
  served = {
    _ldMeta: { enabled: true, variationKey: "standard", version: 3, mode: "completion" },
    provider: { name: "bedrock" },
    model: { name: "scripted" },
    messages: [{ role: "system", content: "Help." }],
  };
  sent.length = 0;
  const unusable = storeHandlers(async () => {
    throw new UnusableAnswer("empty", "", { total: 150, input: 120, output: 30 });
  });
  await assert.rejects(
    aiConfig({ key: "swag-assistant", handler: unusable, skipJudges: true }).invoke("question", context),
    UnusableAnswer,
  );
  const thrown = sent.filter((s) => !s.key.startsWith("$ld:ai:sdk:"));
  assert.deepEqual(
    thrown.map((s) => [s.key, s.value]),
    [
      ["$ld:ai:tokens:total", 150],
      ["$ld:ai:tokens:input", 120],
      ["$ld:ai:tokens:output", 30],
      ["$ld:ai:duration:total", thrown[3].value],
      ["$ld:ai:generation:error", 1],
    ],
  );
  assert.equal(new Set(thrown.map((s) => s.data.runId)).size, 1);
  assert.deepEqual(thrown[0].ctx, context);
  console.log("an unusable answer: generation:error, with its tokens on the same run");

  // A handler told which variation the route inspected runs only on that
  // one; invoke() serving another throws ConfigChanged before any model call.
  let ranModel = false;
  const pinned = (meta) =>
    storeHandlers(async () => {
      ranModel = true;
      return { output: "ok" };
    }, meta);
  await assert.rejects(
    aiConfig({ key: "swag-assistant", handler: pinned({ variationKey: "standard", version: 2 }), skipJudges: true })
      .invoke("question", context),
    ConfigChanged,
  );
  assert.equal(ranModel, false);
  const same = await aiConfig({ key: "swag-assistant", handler: pinned({ variationKey: "standard", version: 3 }), skipJudges: true })
    .invoke("question", context);
  assert.equal(same.response, "ok");
  console.log("a pinned handler: runs on the inspected variation, throws ConfigChanged on another");
}

console.log("All tool call error checks passed.");
