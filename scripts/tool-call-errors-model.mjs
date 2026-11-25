// LaunchDarkly's LangChain provider, with createLangChainModel answering
// from globalThis.scriptedModel instead of building a Bedrock model.
export * from "@launchdarkly/server-sdk-ai-langchain";

export async function createLangChainModel() {
  return globalThis.scriptedModel;
}
