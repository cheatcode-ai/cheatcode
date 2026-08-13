import type { RequestContext } from "@mastra/core/request-context";
import { type JSONValue, type ModelMessage, modelMessageSchema } from "ai";
import { z } from "zod";
import { CONTEXT } from "./context";
import { mastra } from "./index";
import { cheatcodeTools } from "./tool-defs/tool-set";

// DeepSeek leaves max_tokens at a much smaller API default when callers omit it even though the
// selected V4 Pro model supports a 384K output window. Use the model's advertised maximum so tool
// arguments are not truncated by a transport default; semantic completion still controls the loop.
const DEEPSEEK_V4_PRO_MAX_OUTPUT_TOKENS = 384_000;

export const GeneralAgentFinishReasonSchema = z.enum([
  "stop",
  "length",
  "content-filter",
  "tool-calls",
  "error",
  "other",
]);

type GeneralAgentFinishReason = z.infer<typeof GeneralAgentFinishReasonSchema>;

export interface GeneralAgentToolCall {
  input: JSONValue;
  toolCallId: string;
  toolName: string;
}

interface GeneralAgentStepResult {
  finishReason: GeneralAgentFinishReason;
  responseMessages: JSONValue[];
  text: string;
  toolCalls: GeneralAgentToolCall[];
}

interface GenerateGeneralAgentStepOptions {
  abortSignal?: AbortSignal;
  excludedTools?: readonly CheatcodeToolName[];
  includedTools?: readonly CheatcodeToolName[];
  isDeepSeek: boolean;
  messages: JSONValue[];
  requestContext: RequestContext;
  runId: string;
}

type CheatcodeToolName = keyof typeof cheatcodeTools;
type CheatcodeToolSubset = Partial<typeof cheatcodeTools>;

interface ExecuteGeneralAgentToolOptions {
  abortSignal?: AbortSignal;
  input: JSONValue;
  requestContext: RequestContext;
  runId: string;
  toolCallId: string;
  toolName: string;
}

/** Runs one model-only turn so the caller can checkpoint its tool calls durably. */
export async function generateGeneralAgentStep(
  options: GenerateGeneralAgentStepOptions,
): Promise<GeneralAgentStepResult> {
  const messages = options.messages.map((message) => modelMessageSchema.parse(message));
  const clientTools = resolveClientTools(options);
  const result = await mastra.getAgent("generalStep").generate(messages as never, {
    ...(options.abortSignal ? { abortSignal: options.abortSignal } : {}),
    clientTools,
    ...(options.isDeepSeek
      ? { providerOptions: { deepseek: { thinking: { type: "disabled" as const } } } }
      : {}),
    ...(options.isDeepSeek
      ? { modelSettings: { maxOutputTokens: DEEPSEEK_V4_PRO_MAX_OUTPUT_TOKENS } }
      : {}),
    requestContext: options.requestContext,
    runId: options.runId,
  });
  return {
    finishReason: GeneralAgentFinishReasonSchema.parse(result.finishReason),
    responseMessages: toJsonValues(result.response.messages ?? []),
    text: result.text,
    toolCalls: result.toolCalls.map((call) => ({
      input: toJsonValue(call.payload.args),
      toolCallId: call.payload.toolCallId,
      toolName: call.payload.toolName,
    })),
  };
}

function resolveClientTools(options: GenerateGeneralAgentStepOptions): CheatcodeToolSubset {
  if (options.includedTools && options.excludedTools) {
    throw new Error("Agent tools cannot be included and excluded in the same model step.");
  }
  if (!options.includedTools && (!options.excludedTools || options.excludedTools.length === 0)) {
    return cheatcodeTools;
  }
  const toolNames = options.includedTools
    ? options.includedTools
    : (Object.keys(cheatcodeTools) as CheatcodeToolName[]).filter(
        (toolName) => !options.excludedTools?.includes(toolName),
      );
  return Object.fromEntries(toolNames.map((toolName) => [toolName, cheatcodeTools[toolName]]));
}

function toJsonValues(values: ModelMessage[]): JSONValue[] {
  return values.map(toJsonValue);
}

function toJsonValue(value: unknown): JSONValue {
  const serialized = JSON.stringify(value ?? null);
  return z.json().parse(JSON.parse(serialized));
}

/** Reconstructs and executes one registered tool after its model turn is checkpointed. */
export async function executeGeneralAgentTool(
  options: ExecuteGeneralAgentToolOptions,
): Promise<unknown> {
  const tools = await mastra.getAgent("general").getToolsForExecution({
    methodType: "generate",
    requestContext: options.requestContext,
    runId: options.runId,
  });
  const tool = tools[options.toolName];
  if (!tool?.execute) {
    throw new Error(`Unknown or non-executable agent tool: ${options.toolName}`);
  }
  // Mastra's execution wrapper does not preserve arbitrary top-level compatibility
  // fields. Bind the durable call identity explicitly so request-scoped tools can
  // derive stable idempotency keys without serializing them into model arguments.
  options.requestContext.set(CONTEXT.toolCallId, options.toolCallId);
  return tool.execute(options.input, {
    ...(options.abortSignal ? { abortSignal: options.abortSignal } : {}),
    // Repository tools use requestContext for their runtime dependencies and
    // do not inspect Mastra's compatibility-layer message array.
    messages: [],
    requestContext: options.requestContext,
    toolCallId: options.toolCallId,
  });
}
