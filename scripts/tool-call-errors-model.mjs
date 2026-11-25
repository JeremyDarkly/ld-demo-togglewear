// The store's LangChain model helpers (lib/langchainModel.ts), with
// langChainModel answering from globalThis.scriptedModel instead of building
// a Bedrock model.
export * from "../lib/langchainModel.ts";

export async function langChainModel() {
  return globalThis.scriptedModel;
}
