import { ComposioClient } from "@cheatcode/composio";
import { createLogger } from "@cheatcode/observability";
import { IntegrationNameSchema } from "@cheatcode/types/integrations";
import { createTool } from "@mastra/core/tools";
import { z } from "zod/v4";
import { ComposioConnectedAccountsSchema, type ComposioQuotaMeter } from "../composio-context";
import { CONTEXT } from "../context";

const MAX_COMPOSIO_ARGUMENTS_JSON_CHARS = 100_000;
const MAX_COMPOSIO_OUTPUT_CHARS = 20_000;
const MAX_COMPOSIO_TOOL_PARAMETERS_CHARS = 10_000;
const MAX_COMPOSIO_OUTPUT_NODES = 2_000;
const MAX_COMPOSIO_OUTPUT_STRING_CHARS = 40_000;
const MAX_COMPOSIO_OUTPUT_DEPTH = 6;
const COMPOSIO_RELAXED_MATCH_LIMIT = 12;
// Composio's tool-list API silently returns only its small default page (~10) at the
// base toolkit version; request the documented max so large toolkits (github/gmail/
// notion) are not under-enumerated. Docs: docs.composio.dev/docs/tools-direct/fetching-tools.
const COMPOSIO_LIST_LIMIT = 1000;
const COMPOSIO_LIST_TIMEOUT_MS = 30_000;
const COMPOSIO_EXECUTE_TIMEOUT_MS = 120_000;
const RequestContextReaderSchema = {
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

const ComposioArgumentsSchema = z
  .record(z.string().min(1).max(120), z.unknown())
  .default({})
  .describe("Tool arguments to pass to Composio. Keep serialized JSON under 100KB.");

const ComposioListToolsInputSchema = z.strictObject({
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
});

const ComposioListToolsOutputSchema = z.strictObject({
  error: z.string().max(1_000).nullable(),
  integration: IntegrationNameSchema,
  searchRelaxed: z.boolean(),
  success: z.boolean(),
  toolCount: z.number().int().nonnegative(),
  toolsJson: z.string().max(MAX_COMPOSIO_OUTPUT_CHARS),
  toolsTruncated: z.boolean(),
});

const ComposioExecuteInputSchema = z.strictObject({
  allowLatestVersion: z
    .boolean()
    .default(false)
    .describe("Set true only when the user accepts executing the latest Composio tool version."),
  arguments: ComposioArgumentsSchema,
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
});

const ComposioExecuteOutputSchema = z.strictObject({
  connectedAccountId: z.string().max(500).nullable(),
  data: z.string().max(MAX_COMPOSIO_OUTPUT_CHARS),
  dataTruncated: z.boolean(),
  error: z.string().max(1_000).nullable(),
  integration: IntegrationNameSchema,
  logId: z.string().max(500).nullable(),
  quota: z
    .strictObject({
      limit: z.number().finite().nonnegative(),
      remaining: z.number().finite().nonnegative(),
    })

    .nullable(),
  success: z.boolean(),
  toolSlug: z.string().max(160),
});

const ComposioExecuteResponseSchema = z
  .object({
    data: z.unknown(),
    error: z.string().max(1_000).nullable(),
    logId: z.string().max(500).optional(),
    success: z.boolean(),
  })
  .strip();

// The bounded REST client returns framework-agnostic tool definitions. This object
// schema projects each tool down to exactly what the agent needs for
// composio_execute: its canonical slug, input schema, version, and deprecation
// signal. Dropping output metadata keeps more actions within the output ceiling.
const ComposioRawToolSchema = z.object({
  slug: z.string().min(1).max(160),
  name: z.string().max(200).optional(),
  description: z.string().max(4_000).optional(),
  inputParameters: z.unknown().optional(),
  version: z.string().max(120).optional(),
  isDeprecated: z.boolean().optional(),
});

const ComposioRawToolListSchema = z.array(ComposioRawToolSchema).max(COMPOSIO_LIST_LIMIT);

type ComposioRawTool = z.infer<typeof ComposioRawToolSchema>;
type ComposioListToolsInput = z.infer<typeof ComposioListToolsInputSchema>;
type ComposioExecuteInput = z.infer<typeof ComposioExecuteInputSchema>;
type ComposioExecuteOutput = z.infer<typeof ComposioExecuteOutputSchema>;
type ComposioListToolsOutput = z.infer<typeof ComposioListToolsOutputSchema>;

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

interface ComposioToolDiscovery {
  hasMore: boolean;
  searchRelaxed: boolean;
  tools: ComposioRawTool[];
}

function requestContextFromToolContext(context: unknown): { get(key: string): unknown } {
  return RequestContextReaderSchema.parse(
    typeof context === "object" && context !== null
      ? (context as { requestContext?: unknown }).requestContext
      : undefined,
  );
}

function composioRuntimeFromContext(context: unknown): ComposioRuntimeContext {
  const requestContext = requestContextFromToolContext(context);
  const apiKey = requestContext.get(CONTEXT.composioApiKey);
  const userId = requestContext.get(CONTEXT.composioUserId);
  const quotaMeter = requestContext.get(CONTEXT.composioQuotaMeter);
  return {
    connectedAccounts: ComposioConnectedAccountsSchema.parse(
      requestContext.get(CONTEXT.composioConnectedAccounts) ?? {},
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
    const discovery = await discoverComposioTools(new ComposioClient(runtime.apiKey), input);
    const bounded = boundedToolListJson(discovery.tools, MAX_COMPOSIO_OUTPUT_CHARS);
    return ComposioListToolsOutputSchema.parse({
      error: null,
      integration: input.integration,
      searchRelaxed: discovery.searchRelaxed,
      success: true,
      toolCount: discovery.tools.length,
      toolsJson: bounded.text,
      toolsTruncated: bounded.truncated || discovery.hasMore,
    });
  } catch (error) {
    createLogger().warn("composio_tool_list_failed", { error });
    return composioListFailure(input, "Composio tool discovery failed.");
  }
}

async function discoverComposioTools(
  client: ComposioClient,
  input: ComposioListToolsInput,
): Promise<ComposioToolDiscovery> {
  const page = await client.listTools(
    {
      limit: COMPOSIO_LIST_LIMIT,
      ...(input.search ? { search: input.search } : {}),
      toolkit: input.integration,
    },
    COMPOSIO_LIST_TIMEOUT_MS,
  );
  const tools = ComposioRawToolListSchema.parse(page.items);
  if (tools.length > 0 || !input.search) {
    return { hasMore: page.nextCursor !== null, searchRelaxed: false, tools };
  }
  const broadPage = await client.listTools(
    { limit: COMPOSIO_LIST_LIMIT, toolkit: input.integration },
    COMPOSIO_LIST_TIMEOUT_MS,
  );
  const broadTools = ComposioRawToolListSchema.parse(broadPage.items);
  const ranked = rankComposioTools(broadTools, input.search);
  return {
    hasMore: ranked.length < broadTools.length || broadPage.nextCursor !== null,
    searchRelaxed: true,
    tools: ranked,
  };
}

function rankComposioTools(tools: readonly ComposioRawTool[], search: string): ComposioRawTool[] {
  const terms = searchTerms(search);
  const scored = tools
    .filter((tool) => tool.isDeprecated !== true)
    .map((tool, index) => ({ index, score: toolSearchScore(tool, terms), tool }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, COMPOSIO_RELAXED_MATCH_LIMIT)
    .map((entry) => entry.tool);
  return scored.length > 0
    ? scored
    : tools.filter((tool) => tool.isDeprecated !== true).slice(0, COMPOSIO_RELAXED_MATCH_LIMIT);
}

function toolSearchScore(tool: ComposioRawTool, terms: ReadonlySet<string>): number {
  const slug = searchTerms(tool.slug);
  const name = searchTerms(tool.name ?? "");
  const description = searchTerms(tool.description ?? "");
  let score = 0;
  for (const term of terms) {
    if (slug.has(term)) score += 12;
    if (name.has(term)) score += 8;
    if (description.has(term)) score += 2;
  }
  return score;
}

function searchTerms(value: string): Set<string> {
  return new Set(
    (value.toLowerCase().match(/[a-z0-9]+/gu) ?? [])
      .map(normalizeSearchTerm)
      .filter((term) => term.length > 1),
  );
}

function normalizeSearchTerm(term: string): string {
  if (term.length > 4 && term.endsWith("ies")) return `${term.slice(0, -3)}y`;
  return term.length > 3 && term.endsWith("s") ? term.slice(0, -1) : term;
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
    const response = ComposioExecuteResponseSchema.parse(
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
    return ComposioExecuteOutputSchema.parse({
      connectedAccountId: target.connectionId,
      data: bounded.text,
      dataTruncated: bounded.truncated,
      error: response.error,
      integration: input.integration,
      logId: response.logId ?? null,
      quota: quota ? { limit: quota.limit, remaining: quota.remaining } : null,
      success: response.success,
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
  return ComposioListToolsOutputSchema.parse({
    error,
    integration: input.integration,
    searchRelaxed: false,
    success: false,
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
  return ComposioExecuteOutputSchema.parse({
    connectedAccountId,
    data: "{}",
    dataTruncated: false,
    error,
    integration: input.integration,
    logId: null,
    quota,
    success: false,
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
    "List available Composio action tools for a user-connected integration before choosing an exact action slug. Natural-language searches that are too strict are relaxed automatically; inspect searchRelaxed and the returned candidates. If toolsTruncated is true and no candidate fits, call again with a shorter action or object keyword.",
  inputSchema: ComposioListToolsInputSchema,
  outputSchema: ComposioListToolsOutputSchema,
  execute: async (input, context) => listComposioTools(input, composioRuntimeFromContext(context)),
});

export const mastraComposioExecute = createTool({
  id: "composio_execute",
  description:
    "Execute an explicit user-requested action through a connected Composio OAuth integration. Use only when the user asks Cheatcode to act in that external app.",
  inputSchema: ComposioExecuteInputSchema,
  outputSchema: ComposioExecuteOutputSchema,
  execute: async (input, context) => {
    const parsedInput = ComposioExecuteInputSchema.parse(input);
    const runtime = composioRuntimeFromContext(context);
    return executeComposioAction(parsedInput, runtime, composioQuotaEventId(context));
  },
});

function composioQuotaEventId(context: unknown): string {
  const requestContext = requestContextFromToolContext(context);
  const candidate = requestContext.get(CONTEXT.toolCallId);
  if (typeof candidate !== "string" || candidate.length === 0 || candidate.length > 180) {
    throw new Error("Composio execution requires a bounded tool-call id.");
  }
  return `composio:${candidate}`;
}
