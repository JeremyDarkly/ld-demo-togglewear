import {
  SpanStatusCode,
  context,
  trace,
  type Span,
  type TimeInput,
} from "@opentelemetry/api";
import type { LDJudgeResult, LDTokenUsage } from "@launchdarkly/server-sdk-ai";
import type { AIMessage } from "@langchain/core/messages";
import { recordActivity } from "@/lib/activity";
import { textOf } from "@/lib/aiServer";
import { servedByFor } from "@/lib/swagAssistant";

// The spans that make an agent's run readable as a conversation under
// Monitor > Traces > Conversations in LaunchDarkly, following its
// instrumentation guide (docs/sdk/features/observability-llm-instrumentation):
// the OpenTelemetry generative AI conventions, which the observability
// plugin exports with everything else.
//
// LangChain's Bedrock model is not instrumented for us in Node, so the
// routes record each step themselves. One agent run is an invoke_agent span
// holding what the agent was handed and what it answered; inside it, a chat
// span per model call and an execute_tool span per tool call. Every span
// carries the conversation id, the only thing LaunchDarkly groups on: a
// chat is one conversation, and so is an order's whole review.
//
// The observability plugin registers its tracer through its own bundled
// copy of the API, at 1.9.0, when the LaunchDarkly client starts. Either
// way of missing it gets a tracer that records nothing, without an error:
// a newer minor version of @opentelemetry/api refuses the registration,
// which is why package.json keeps it on 1.9, and a tracer taken before the
// client starts never picks it up, which is why it is taken for each run.
//
// The spans hold only generative AI attributes. LaunchDarkly files a span
// with HTTP attributes as an HTTP span, which drops it from the LLM views,
// so these are children of the route's span rather than that span itself.

// What OpenTelemetry calls Bedrock, which with the model id is what
// LaunchDarkly prices a call from, using the model configs' token costs.
const PROVIDER = "aws.bedrock";

// Judges usually answer in a few seconds. A run still waiting on them after
// this is sent without its scores rather than held open.
const EVALUATION_WAIT_MS = 30_000;

type Part =
  | { type: "text"; content: string }
  | { type: "tool_call"; id: string; name: string; arguments: string };
type Message = { role: "user" | "assistant"; parts: Part[] };

const text = (role: Message["role"], content: string): Message => ({
  role,
  parts: [{ type: "text", content }],
});

// A model's reply as LaunchDarkly reads it: its text, then each tool it
// asked for, with the call id its tool span carries, which is what puts the
// tool after the message that asked for it.
function replyMessage(response: AIMessage): Message {
  const parts: Part[] = [];
  const said = textOf(response);
  if (said) parts.push({ type: "text", content: said });
  for (const call of response.tool_calls ?? []) {
    parts.push({
      type: "tool_call",
      id: call.id ?? "",
      name: call.name,
      arguments: JSON.stringify(call.args),
    });
  }
  return { role: "assistant", parts };
}

export type AgentRun = {
  // One model call. input is what is new to the model on this call; the
  // earlier turns are already in the conversation.
  modelCall: (
    model: string,
    input: string[],
    call: () => Promise<{ response: AIMessage; usage?: LDTokenUsage; output?: string }>,
  ) => Promise<AIMessage>;
  tool: (call: { id?: string; name: string; args: unknown }, run: () => Promise<string>) => Promise<string>;
  // The answer, and the end of the run. With judges, their scores can still
  // be added until scored is called, without moving the run's end.
  finish: (output: string, judged?: boolean) => void;
  fail: (err: unknown) => void;
  scored: (results?: LDJudgeResult[]) => void;
};

// An agent's run within a conversation, under parent (the route's span).
// system is its prompt, shown once per conversation however often it is
// sent; input is what it was handed, which opens its part of the transcript.
export function startAgentRun(
  parent: Span,
  conversationId: string,
  agentName: string,
  system: string,
  input: string,
): AgentRun {
  const tracer = trace.getTracer("togglewear-ai");
  const base = { "gen_ai.conversation.id": conversationId };
  const parentContext = trace.setSpan(context.active(), parent);
  const run = tracer.startSpan(
    `invoke_agent ${agentName}`,
    {
      attributes: {
        ...base,
        "gen_ai.operation.name": "invoke_agent",
        "gen_ai.agent.name": agentName,
        "gen_ai.provider.name": PROVIDER,
        "gen_ai.system_instructions": JSON.stringify([{ type: "text", content: system }]),
        "gen_ai.input.messages": JSON.stringify([text("user", input)]),
      },
    },
    parentContext,
  );
  const runContext = trace.setSpan(parentContext, run);
  let endedAt: TimeInput | undefined;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    run.end(endedAt);
  };

  return {
    async modelCall(model, input, call) {
      const span = tracer.startSpan(
        `chat ${model}`,
        {
          attributes: {
            ...base,
            "gen_ai.operation.name": "chat",
            "gen_ai.provider.name": PROVIDER,
            "gen_ai.request.model": model,
            ...(input.length && {
              "gen_ai.input.messages": JSON.stringify(input.map((t) => text("user", t))),
            }),
          },
        },
        runContext,
      );
      run.setAttribute("gen_ai.request.model", model);
      const startedAt = Date.now();
      try {
        const { response, usage, output } = await call();
        recordActivity({
          kind: "model",
          title: `${agentName} called ${servedByFor("", model).model}`,
          detail: [
            usage && `${usage.input.toLocaleString()} in, ${usage.output.toLocaleString()} out tokens`,
            `${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
          ]
            .filter(Boolean)
            .join(" · "),
        });
        const reply = output !== undefined ? text("assistant", output) : replyMessage(response);
        span.setAttributes({
          "gen_ai.output.messages": JSON.stringify([reply]),
          ...(usage && {
            "gen_ai.usage.input_tokens": usage.input,
            "gen_ai.usage.output_tokens": usage.output,
          }),
        });
        return response;
      } catch (err) {
        span.recordException(err as Error);
        span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
        recordActivity({
          kind: "error",
          title: `${agentName}'s call to ${servedByFor("", model).model} failed`,
          detail: `${(err as Error).name}: ${(err as Error).message}`.slice(0, 160),
        });
        throw err;
      } finally {
        span.end();
      }
    },

    async tool(call, runTool) {
      recordActivity({ kind: "tool", title: `${agentName} used the ${call.name} tool` });
      const span = tracer.startSpan(
        `execute_tool ${call.name}`,
        {
          attributes: {
            ...base,
            "gen_ai.operation.name": "execute_tool",
            "gen_ai.tool.name": call.name,
            "gen_ai.tool.call.id": call.id ?? "",
            "gen_ai.tool.call.arguments": JSON.stringify(call.args),
          },
        },
        runContext,
      );
      try {
        const result = await runTool();
        span.setAttribute("gen_ai.tool.call.result", result);
        return result;
      } catch (err) {
        span.recordException(err as Error);
        span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
        throw err;
      } finally {
        span.end();
      }
    },

    finish(output, judged = false) {
      run.setAttribute("gen_ai.output.messages", JSON.stringify([text("assistant", output)]));
      endedAt = new Date();
      if (judged) setTimeout(close, EVALUATION_WAIT_MS).unref?.();
      else close();
    },

    fail(err) {
      recordActivity({
        kind: "error",
        title: `${agentName} couldn't answer`,
        detail: (err as Error).message.slice(0, 160),
      });
      run.recordException(err as Error);
      run.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
      close();
    },

    scored(results = []) {
      if (closed) return;
      for (const result of results) {
        if (!result.sampled || !result.success || result.score === undefined) continue;
        recordActivity({
          kind: "judge",
          title: `${(result.metricKey ?? result.judgeConfigKey ?? "A judge").replace(/^\$ld:ai:judge:/, "")} scored ${agentName} ${result.score}`,
          detail: result.reasoning?.slice(0, 140),
        });
        run.addEvent(
          "gen_ai.evaluation.result",
          {
            "gen_ai.evaluation.name": (result.metricKey ?? result.judgeConfigKey ?? "judge")
              .replace(/^\$ld:ai:judge:/, ""),
            "gen_ai.evaluation.score.value": result.score,
            ...(result.reasoning && { "gen_ai.evaluation.explanation": result.reasoning }),
          },
          endedAt,
        );
      }
      close();
    },
  };
}
