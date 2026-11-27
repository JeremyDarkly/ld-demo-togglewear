import { initChatModel } from "langchain/chat_models/universal";
import { tool, type StructuredToolInterface } from "@langchain/core/tools";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
  parseTemplate,
  type AiConfigRep,
  type ConfigMessage,
  type TokenUsage,
} from "@launchdarkly/ai-node";

// What the legacy LangChain provider (@launchdarkly/server-sdk-ai-langchain)
// did for the store's own model loops, which the 1.0 SDK no longer exports:
// build the variation's model, read a response's token counts, turn the
// variation's tool definitions into LangChain tools, and fill in its prompt.
// The 1.0 LangChain handler does all of this inside its own loop, which
// cannot force a first tool call, ask again for an unsourced price or answer
// in a schema from code, so the routes that need those keep their own loop
// and use these.

// The variation's model, as the legacy createLangChainModel built it: the
// provider's LangChain chat model, given the variation's parameters, less
// any tools, which are bound separately.
export async function langChainModel(config: AiConfigRep): Promise<BaseChatModel> {
  const parameters = { ...(config.model?.parameters ?? {}) };
  delete parameters.tools;
  return (await initChatModel(config.model?.name ?? "", {
    ...parameters,
    modelProvider: (config.provider?.name ?? "").toLowerCase(),
  })) as unknown as BaseChatModel;
}

export function usageOf(response: AIMessage): TokenUsage | undefined {
  const usage = response?.usage_metadata;
  if (!usage) return undefined;
  return { total: usage.total_tokens, input: usage.input_tokens, output: usage.output_tokens };
}

type ToolDefinition = { name: string; description?: string; parameters?: Record<string, unknown> };

// The tools attached to the variation. 1.0 reads only a top-level tools map;
// the legacy SDK also read model.parameters.tools, which is where the store's
// variations carried them, so both are read here.
export function toolDefinitions(config: AiConfigRep): ToolDefinition[] {
  if (config.tools && Object.keys(config.tools).length) {
    return Object.entries(config.tools).map(([name, t]) => ({ ...t, name }));
  }
  const legacy = config.model?.parameters?.tools;
  if (!Array.isArray(legacy)) return [];
  return legacy.flatMap((t) => {
    const name = t?.name ?? t?.function?.name;
    if (typeof name !== "string") return [];
    return [{
      name,
      description: t.description ?? t.function?.description,
      parameters: t.parameters ?? t.function?.parameters,
    }];
  });
}

// What the store's tools run, by tool key. Each takes the arguments the
// model filled in.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ToolFunctions = Record<string, (args: any) => unknown>;

// LangChain tools for the definitions that have a function behind them.
export function structuredTools(
  definitions: ToolDefinition[],
  functions: ToolFunctions,
): StructuredToolInterface[] {
  return definitions.flatMap((definition) => {
    const fn = functions[definition.name] as ((args: unknown) => unknown) | undefined;
    if (!fn) return [];
    const schema =
      definition.parameters && typeof definition.parameters === "object" && definition.parameters.properties
        ? definition.parameters
        : { type: "object", properties: {}, additionalProperties: true };
    return [
      tool(
        async (args: unknown) => {
          const result = await fn(args ?? {});
          return typeof result === "string" ? result : JSON.stringify(result);
        },
        {
          name: definition.name,
          description: definition.description?.trim() || `Tool ${definition.name}`,
          schema: schema as Record<string, unknown>,
        },
      ),
    ];
  });
}

// The variation's messages with their {{placeholders}} filled in. The SDK
// hands a handler the variables, ldContext included, but leaves the filling
// in to the handler.
export function renderedMessages(
  config: Pick<AiConfigRep, "messages">,
  variables: Record<string, unknown> = {},
): ConfigMessage[] {
  return (config.messages ?? []).map((m) => ({ ...m, content: parseTemplate(m.content, variables) }));
}

export function toLangChain(messages: ConfigMessage[]): BaseMessage[] {
  return messages.map((m) =>
    m.role === "system"
      ? new SystemMessage(m.content)
      : m.role === "user"
        ? new HumanMessage(m.content)
        : new AIMessage(m.content),
  );
}
