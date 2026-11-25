// Module hooks for check-tool-call-errors.mjs, which runs the routes' tool
// loops under plain Node: resolves the store's imports the way Next does,
// leaves out the React components a route only imports types from, and swaps
// the store's LangChain model and the AI SDK's LangChain handler, which runs
// the judges, for scripted ones, so nothing calls Bedrock or needs a
// credential.
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const stub = new URL("./tool-call-errors-model.mjs", import.meta.url).href;
const judgeStub = new URL("./judge-handler-stub.mjs", import.meta.url).href;

export async function resolve(specifier, context, next) {
  if (specifier === "@/lib/langchainModel" && context.parentURL !== stub) {
    return { url: stub, shortCircuit: true };
  }
  if (specifier === "@launchdarkly/ai-langchain-messages") {
    return { url: judgeStub, shortCircuit: true };
  }
  if (specifier.startsWith("@/components/")) {
    return { url: "data:text/javascript,export {}", shortCircuit: true };
  }
  // The store's own modules, by "@/" path or relative, without extensions.
  const local = specifier.startsWith("@/")
    ? root + specifier.slice(2)
    : specifier.startsWith(".") && context.parentURL?.endsWith(".ts")
      ? fileURLToPath(new URL(specifier, context.parentURL))
      : null;
  if (local) {
    const file = [".ts", "/index.ts", ""].map((ext) => local + ext).find(existsSync);
    return { url: pathToFileURL(file ?? local).href, shortCircuit: true };
  }
  return next(specifier, context);
}
