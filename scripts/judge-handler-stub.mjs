// The AI SDK's LangChain messages handler, which the store runs its judges
// with (lib/aiServer.ts), answering with globalThis.judgeReply instead of
// calling Bedrock: a string is the judge's reply, an Error a failed model
// call.
import { createHandler } from "@launchdarkly/ai-node";

export function createLangChainMessagesHandler() {
  return createHandler(["*", "messages"], async () => {
    const reply = globalThis.judgeReply;
    if (reply instanceof Error) throw reply;
    return { output: reply ?? "", usage: { input: 50, output: 10 } };
  });
}
