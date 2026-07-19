import { ComposioClient } from "@cheatcode/composio";
import { createLogger } from "@cheatcode/observability";
import { IntegrationNameSchema } from "@cheatcode/types/integrations";
import { createTool } from "@mastra/core/tools";
import { z } from "zod/v4";
import {
  COMPOSIO_API_KEY_CONTEXT_KEY,
  COMPOSIO_CONNECTED_ACCOUNTS_CONTEXT_KEY,
  COMPOSIO_QUOTA_METER_CONTEXT_KEY,
  COMPOSIO_USER_ID_CONTEXT_KEY,
  ComposioConnectedAccountsSchema,
  type ComposioQuotaMeter,
} from "../composio-context";

const MAX_COMPOSIO_ARGUMENTS_JSON_CHARS = 100_000;
const MAX_COMPOSIO_OUTPUT_CHARS = 20_000;
const MAX_COMPOSIO_TOOL_PARAMETERS_CHARS = 10_000;
const MAX_COMPOSIO_OUTPUT_NODES = 2_000;
const MAX_COMPOSIO_OUTPUT_STRING_CHARS = 40_000;
const MAX_COMPOSIO_OUTPUT_DEPTH = 6;
// Composio's tool-list API silently returns only its small default page (~10) at the
// base toolkit version; request the documented max so large toolkits (github/gmail/
// notion) are not under-enumerated. Docs: docs.composio.dev/docs/tools-direct/fetching-tools.
const COMPOSIO_LIST_LIMIT = 1000;
const COMPOSIO_LIST_TIMEOUT_MS = 30_000;
const COMPOSIO_EXECUTE_TIMEOUT_MS = 120_000;
const requestContextReaderSchema = {
  parse(value: unknown): { get(key: string): unknown } {
    if (!value || typeof value !== "object") {
      throw new Error("Mastra request context is required for Composio tools.");
    }
    const candidate = value as { get?: unknown };
    if (typeof candidate.get !== "function") {
      throw new Error("Mastra request context does not expose get().");
    }
    return candidate as { get(key: string): unknown };
  },
};

const composioArgumentsSchema = z
  .record(z.string().min(1).max(120), z.unknown())
  .default({})
  .describe("Tool arguments to pass to Composio. Keep serialized JSON under 100KB.");

const composioListToolsInputSchema = z
  .object({
    integration: IntegrationNameSchema.describe(
      "Connected integration whose tools should be listed.",
    ),
    search: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .optional()
      .describe(
        "Optional keyword filter (e.g. 'create issue') to narrow large toolkits. Use this when a previous listing returned toolsTruncated=true.",
      ),
  })
  .strict();

const composioListToolsOutputSchema = z
  .object({
    error: z.string().max(1_000).nullable(),
    integration: IntegrationNameSchema,
    successful: z.boolean(),
    toolCount: z.number().int().nonnegative(),
    toolsJson: z.string().max(MAX_COMPOSIO_OUTPUT_CHARS),
    toolsTruncated: z.boolean(),
  })
  .strict();

const composioExecuteInputSchema = z
  .object({
    allowLatestVersion: z
      .boolean()
      .default(false)
      .describe("Set true only when the user accepts executing the latest Composio tool version."),
    arguments: composioArgumentsSchema,
    integration: IntegrationNameSchema.describe("Connected integration to use for this action."),
    toolSlug: z
      .string()
      .trim()
      .min(1)
      .max(160)
      .regex(/^[A-Z0-9_]+$/)
      .describe("Exact Composio tool slug, for example GITHUB_GET_REPO."),
    version: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .optional()
      .describe("Concrete Composio toolkit version. Prefer this over allowLatestVersion."),
  })
  .strict();

const composioExecuteOutputSchema = z
  .object({
    connectedAccountId: z.string().max(500).nullable(),
    data: z.string().max(MAX_COMPOSIO_OUTPUT_CHARS),
    dataTruncated: z.boolean(),
    error: z.string().max(1_000).nullable(),
    integration: IntegrationNameSchema,
    logId: z.string().max(500).nullable(),
    quota: z
      .object({
        limit: z.number().finite().nonnegative(),
        remaining: z.number().finite().nonnegative(),
      })
      .strict()
      .nullable(),
    successful: z.boolean(),
    toolSlug: z.string().max(160),
  })
  .strict();

const composioExecuteResponseSchema = z
  .object({
    data: z.unknown(),
    error: z.string().max(1_000).nullable(),
    logId: z.string().max(500).optional(),
    successful: z.boolean(),
  })
  .strip();

// The bounded REST client returns framework-agnostic tool definitions. This object
// schema projects each tool down to exactly what the agent needs for
// composio_execute: its canonical slug, input schema, version, and deprecation
// signal. Dropping output metadata keeps more actions within the output ceiling.
const composioRawToolSchema = z.object({
  slug: z.string().min(1).max(160),
  name: z.string().max(200).optional(),
  description: z.string().max(4_000).optional(),
  inputParameters: z.unknown().optional(),
  version: z.string().max(120).optional(),
  isDeprecated: z.boolean().optional(),
});

const composioRawToolListSchema = z.array(composioRawToolSchema).max(COMPOSIO_LIST_LIMIT);

type ComposioListToolsInput = z.infer<typeof composioListToolsInputSchema>;
type ComposioExecuteInput = z.infer<typeof composioExecuteInputSchema>;
type ComposioExecuteOutput = z.infer<typeof composioExecuteOutputSchema>;
type ComposioListToolsOutput = z.infer<typeof composioListToolsOutputSchema>;

export interface ComposioRuntimeContext {
  apiKey?: string | undefined;
  connectedAccounts: z.infer<typeof ComposioConnectedAccountsSchema>;
  quotaMeter?: ComposioQuotaMeter | undefined;
  userId?: string | undefined;
}

interface BoundedJson {
  text: string;
  truncated: boolean;
}

interface JsonPruneState {
  nodesRemaining: number;
  seen: WeakSet<object>;
  stringCharactersRemaining: number;
  wasTruncated: boolean;
}

interface ComposioExecutionTarget {
  apiKey: string;
  connectionId: string;
  userId: string;
  version: string;
}

function requestContextFromToolContext(context: unknown): { get(key: string): unknown } {
  return requestContextReaderSchema.parse(
    typeof context === "object" && context !== null
      ? (context as { requestContext?: unknown }).requestContext
      : undefined,
  );
}

function composioRuntimeFromContext(context: unknown): ComposioRuntimeContext {
  const requestContext = requestContextFromToolContext(context);
  const apiKey = requestContext.get(COMPOSIO_API_KEY_CONTEXT_KEY);
  const userId = requestContext.get(COMPOSIO_USER_ID_CONTEXT_KEY);
  const quotaMeter = requestContext.get(COMPOSIO_QUOTA_METER_CONTEXT_KEY);
  return {
    connectedAccounts: ComposioConnectedAccountsSchema.parse(
      requestContext.get(COMPOSIO_CONNECTED_ACCOUNTS_CONTEXT_KEY) ?? {},
    ),
    ...(typeof apiKey === "string" && apiKey.trim() ? { apiKey } : {}),
    ...(isComposioQuotaMeter(quotaMeter) ? { quotaMeter } : {}),
    ...(typeof userId === "string" && userId.trim() && userId.length <= 500 ? { userId } : {}),
  };
}

function isComposioQuotaMeter(value: unknown): value is ComposioQuotaMeter {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { consumeCall?: unknown }).consumeCall === "function"
  );
}

async function listComposioTools(
  input: ComposioListToolsInput,
  runtime: ComposioRuntimeContext,
): Promise<ComposioListToolsOutput> {
  if (!runtime.apiKey || !runtime.userId) {
    return composioListFailure(input, "Composio is not configured for this run.");
  }
  if (!runtime.connectedAccounts[input.integration]) {
    return composioListFailure(input, `Connect ${input.integration} in Settings first.`);
  }

  try {
    const page = await new ComposioClient(runtime.apiKey).listTools(
      {
        limit: COMPOSIO_LIST_LIMIT,
        ...(input.search ? { search: input.search } : {}),
        toolkit: input.integration,
      },
      COMPOSIO_LIST_TIMEOUT_MS,
    );
    const parsed = composioRawToolListSchema.safeParse(page.items);
    if (!parsed.success) {
      return composioListFailure(input, "Composio returned an unexpected tool list shape.");
    }
    const bounded = boundedToolListJson(parsed.data, MAX_COMPOSIO_OUTPUT_CHARS);
    return composioListToolsOutputSchema.parse({
      error: null,
      integration: input.integration,
      successful: true,
      toolCount: parsed.data.length,
      toolsJson: bounded.text,
      toolsTruncated: bounded.truncated || page.nextCursor !== null,
    });
  } catch (error) {
    createLogger().warn("composio_tool_list_failed", { error });
    return composioListFailure(input, "Composio tool discovery failed.");
  }
}

async function executeComposioAction(
  input: ComposioExecuteInput,
  runtime: ComposioRuntimeContext,
  quotaEventId: string,
): Promise<ComposioExecuteOutput> {
  const preflight = composioExecutionPreflight(input, runtime);
  if ("failure" in preflight) {
    return preflight.failure;
  }
  const quota = await runtime.quotaMeter?.consumeCall(quotaEventId);
  if (quota && !quota.allowed) {
    return composioExecuteFailure(
      input,
      preflight.connectionId,
      "Composio monthly call quota exhausted.",
      { limit: quota.limit, remaining: quota.remaining },
    );
  }
  return executeMeteredComposioAction(input, preflight, quota ?? null);
}

function composioExecutionPreflight(
  input: ComposioExecuteInput,
  runtime: ComposioRuntimeContext,
): ComposioExecutionTarget | { failure: ComposioExecuteOutput } {
  const connectionId = runtime.connectedAccounts[input.integration] ?? null;
  if (!runtime.apiKey || !runtime.userId) {
    return preflightFailure(input, connectionId, "Composio is not configured for this run.");
  }
  if (!connectionId) {
    return preflightFailure(input, null, `Connect ${input.integration} in Settings first.`);
  }
  if (!serializedArgumentsAreWithinLimit(input.arguments)) {
    return preflightFailure(
      input,
      connectionId,
      "Composio arguments exceed safe size or structural limits.",
    );
  }
  const version = input.version ?? (input.allowLatestVersion ? "latest" : null);
  if (!version) {
    return preflightFailure(
      input,
      connectionId,
      "A concrete Composio toolkit version is required.",
    );
  }
  return { apiKey: runtime.apiKey, connectionId, userId: runtime.userId, version };
}

function preflightFailure(
  input: ComposioExecuteInput,
  connectionId: string | null,
  message: string,
): { failure: ComposioExecuteOutput } {
  return { failure: composioExecuteFailure(input, connectionId, message) };
}

async function executeMeteredComposioAction(
  input: ComposioExecuteInput,
  target: ComposioExecutionTarget,
  quota: { limit: number; remaining: number } | null,
): Promise<ComposioExecuteOutput> {
  try {
    const response = composioExecuteResponseSchema.parse(
      await new ComposioClient(target.apiKey).executeTool(
        input.toolSlug,
        {
          arguments: input.arguments,
          connectedAccountId: target.connectionId,
          userId: target.userId,
          version: target.version,
        },
        COMPOSIO_EXECUTE_TIMEOUT_MS,
      ),
    );
    const bounded = boundedJson(response.data, MAX_COMPOSIO_OUTPUT_CHARS);
    return composioExecuteOutputSchema.parse({
      connectedAccountId: target.connectionId,
      data: bounded.text,
      dataTruncated: bounded.truncated,
      error: response.error,
      integration: input.integration,
      logId: response.logId ?? null,
      quota: quota ? { limit: quota.limit, remaining: quota.remaining } : null,
      successful: response.successful,
      toolSlug: input.toolSlug,
    });
  } catch (error) {
    createLogger().warn("composio_tool_execution_failed", { error });
    return composioExecuteFailure(
      input,
      target.connectionId,
      "Composio tool execution failed.",
      quota,
    );
  }
}

function composioListFailure(
  input: ComposioListToolsInput,
  error: string,
): ComposioListToolsOutput {
  return composioListToolsOutputSchema.parse({
    error,
    integration: input.integration,
    successful: false,
    toolCount: 0,
    toolsJson: "[]",
    toolsTruncated: false,
  });
}

function composioExecuteFailure(
  input: ComposioExecuteInput,
  connectedAccountId: string | null,
  error: string,
  quota: { limit: number; remaining: number } | null = null,
): ComposioExecuteOutput {
  return composioExecuteOutputSchema.parse({
    connectedAccountId,
    data: "{}",
    dataTruncated: false,
    error,
    integration: input.integration,
    logId: null,
    quota,
    successful: false,
    toolSlug: input.toolSlug,
  });
}

function serializedArgumentsAreWithinLimit(args: Record<string, unknown>): boolean {
  try {
    const bounded = boundedJson(args, MAX_COMPOSIO_ARGUMENTS_JSON_CHARS);
    return !bounded.truncated && bounded.text.length <= MAX_COMPOSIO_ARGUMENTS_JSON_CHARS;
  } catch {
    return false;
  }
}

function boundedJson(value: unknown, maxChars: number): BoundedJson {
  const state: JsonPruneState = {
    nodesRemaining: MAX_COMPOSIO_OUTPUT_NODES,
    seen: new WeakSet(),
    stringCharactersRemaining: MAX_COMPOSIO_OUTPUT_STRING_CHARS,
    wasTruncated: false,
  };
  const text = stringifyJson(pruneJsonValue(value, state, 0));
  if (text.length <= maxChars) {
    return { text, truncated: state.wasTruncated };
  }
  return { text: truncatedJsonEnvelope(text, maxChars), truncated: true };
}

// Serializes tools into a valid bounded JSON array and drops whole tools when the
// next definition will not fit. The model can re-list with a narrower `search`.
function boundedToolListJson(tools: readonly unknown[], maxChars: number): BoundedJson {
  const serialized: string[] = [];
  let size = 2; // surrounding "[]"
  let wasTruncated = false;
  for (const tool of tools) {
    const normalized = normalizeToolForOutput(tool);
    const entry = stringifyJson(normalized.value);
    wasTruncated ||= normalized.truncated;
    const addition = entry.length + (serialized.length > 0 ? 1 : 0); // comma separator
    if (size + addition > maxChars) {
      return { text: `[${serialized.join(",")}]`, truncated: true };
    }
    serialized.push(entry);
    size += addition;
  }
  return { text: `[${serialized.join(",")}]`, truncated: wasTruncated };
}

function normalizeToolForOutput(value: unknown): { truncated: boolean; value: unknown } {
  if (!isRecord(value) || value["inputParameters"] === undefined) {
    return { truncated: false, value };
  }
  const parameters = boundedJson(value["inputParameters"], MAX_COMPOSIO_TOOL_PARAMETERS_CHARS);
  return {
    truncated: parameters.truncated,
    value: {
      ...value,
      inputParameters: JSON.parse(parameters.text) as unknown,
    },
  };
}

function pruneJsonValue(value: unknown, state: JsonPruneState, depth: number): unknown {
  if (state.nodesRemaining <= 0 || depth > MAX_COMPOSIO_OUTPUT_DEPTH) {
    state.wasTruncated = true;
    return "[Truncated]";
  }
  state.nodesRemaining -= 1;
  if (typeof value === "string") {
    return pruneJsonString(value, state);
  }
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value !== "object") {
    state.wasTruncated = true;
    return String(value);
  }
  if (state.seen.has(value)) {
    state.wasTruncated = true;
    return "[Circular]";
  }
  state.seen.add(value);
  const output = Array.isArray(value)
    ? pruneJsonArray(value, state, depth)
    : pruneJsonRecord(value as Record<string, unknown>, state, depth);
  state.seen.delete(value);
  return output;
}

function pruneJsonString(value: string, state: JsonPruneState): string {
  const allowed = Math.min(value.length, 5_000, state.stringCharactersRemaining);
  const output = value.slice(0, allowed);
  state.stringCharactersRemaining -= output.length;
  if (output.length < value.length) {
    state.wasTruncated = true;
  }
  return output;
}

function pruneJsonArray(value: unknown[], state: JsonPruneState, depth: number): unknown[] {
  const items = value.slice(0, 100).map((item) => pruneJsonValue(item, state, depth + 1));
  if (items.length < value.length) {
    state.wasTruncated = true;
  }
  return items;
}

function pruneJsonRecord(
  value: Record<string, unknown>,
  state: JsonPruneState,
  depth: number,
): Record<string, unknown> {
  const output = Object.create(null) as Record<string, unknown>;
  let keyCount = 0;
  for (const key in value) {
    if (!Object.hasOwn(value, key)) {
      continue;
    }
    if (keyCount >= 100) {
      state.wasTruncated = true;
      break;
    }
    keyCount += 1;
    const normalizedKey = key.slice(0, 200);
    if (normalizedKey.length < key.length || Object.hasOwn(output, normalizedKey)) {
      state.wasTruncated = true;
    }
    if (!Object.hasOwn(output, normalizedKey)) {
      output[normalizedKey] = pruneJsonValue(value[key], state, depth + 1);
    }
  }
  return output;
}

function truncatedJsonEnvelope(text: string, maxChars: number): string {
  let low = 0;
  let high = Math.min(text.length, maxChars);
  let best = JSON.stringify({ preview: "", truncated: true });
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = JSON.stringify({ preview: text.slice(0, middle), truncated: true });
    if (candidate.length <= maxChars) {
      best = candidate;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return best;
}

function stringifyJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "null";
  } catch {
    return JSON.stringify({ error: "Composio result was not JSON serializable." });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const mastraComposioListTools = createTool({
  id: "composio_list_tools",
  description:
    "List available Composio action tools for a user-connected integration before choosing an exact action slug. If toolsTruncated is true, call again with a `search` keyword to narrow to the action you need.",
  inputSchema: composioListToolsInputSchema,
  outputSchema: composioListToolsOutputSchema,
  execute: async (input, context) => listComposioTools(input, composioRuntimeFromContext(context)),
});

export const mastraComposioExecute = createTool({
  id: "composio_execute",
  description:
    "Execute an explicit user-requested action through a connected Composio OAuth integration. Use only when the user asks Cheatcode to act in that external app.",
  inputSchema: composioExecuteInputSchema,
  outputSchema: composioExecuteOutputSchema,
  execute: async (input, context) => {
    const parsedInput = composioExecuteInputSchema.parse(input);
    const runtime = composioRuntimeFromContext(context);
    return executeComposioAction(parsedInput, runtime, composioQuotaEventId(context));
  },
});

function composioQuotaEventId(context: unknown): string {
  const record = typeof context === "object" && context !== null ? context : {};
  const candidate = (record as Record<string, unknown>)["toolCallId"];
  if (typeof candidate !== "string" || candidate.length === 0 || candidate.length > 180) {
    throw new Error("Composio execution requires a bounded tool-call id.");
  }
  return `composio:${candidate}`;
}
