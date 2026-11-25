import type { LDClient, LDContext } from "@launchdarkly/node-server-sdk";

// ai-tool-call-error, sent once for each tool an agent calls: 1 when the
// call failed, 0 when it worked, so the metric's average is the share of
// tool calls that fail (METRICS in demo_resources.py). It goes on the same
// track data as the AI SDK's own $ld:ai:tool_call, the variation's with the
// tool's key added, so it lands on whichever variation made the call.
//
// A call fails when the tool does not exist, when it throws, or when it
// answers with an error, as get-product-details does for a slug it does not
// know. An empty answer, such as a search that found nothing, is still an
// answer.
export const TOOL_CALL_ERROR_KEY = "ai-tool-call-error";

export type ReportToolCall = (toolKey: string, failed: boolean) => void;

export function toolCallReporter(
  client: Pick<LDClient, "track"> | null,
  context: LDContext,
  trackData: object,
): ReportToolCall {
  return (toolKey, failed) => {
    // A metric that failed to send is never worth a failed reply.
    try {
      client?.track(TOOL_CALL_ERROR_KEY, context, { ...trackData, toolKey }, failed ? 1 : 0);
    } catch {
      // Nothing to do: the reply goes on without it.
    }
  };
}

// Whether a tool's answer, as the loop hands it to the model, is an error:
// an object with an error key.
export function isErrorResult(text: string): boolean {
  try {
    const parsed = JSON.parse(text);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) && "error" in parsed;
  } catch {
    return false;
  }
}
