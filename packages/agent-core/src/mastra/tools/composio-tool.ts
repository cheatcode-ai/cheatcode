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
// Composio's tool-list API silently returns only its small default page (~10) at the
// base toolkit version; request the documented max so large toolkits (github/gmail/
// notion) are not under-enumerated. Docs: docs.composio.dev/docs/tools-direct/fetching-tools.
const COMPOSIO_LIST_LIMIT = 500;
// The SDK default base URL is already backend.composio.dev; pin it explicitly so a
// future SDK default change can't silently repoint Workers at an unresolvable host.
const COMPOSIO_BASE_URL = "https://backend.composio.dev";
// Concrete toolkit versions pinned for deterministic discovery + execution. Without a
// pin the SDK uses base version 00000000_00 (which can expose fewer actions than the
// live toolkit), and "latest" would make manual tools.execute throw
// ComposioToolVersionRequiredError. Fetched from GET /api/v3/toolkits/<slug> -> meta.version
// on 2026-06-16; bump periodically. The LLM-supplied `version` in composio_execute still overrides.
const COMPOSIO_TOOLKIT_VERSIONS: Record<string, string> = {
  github: "20260501_01",
  gmail: "20260615_00",
  linear: "20260615_00",
  notion: "20260615_00",
  slack: "20260615_00",
};
const composioIntegrationNameSchema = z.enum(["github", "gmail", "slack", "notion", "linear"]);

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

export const composioListToolsInputSchema = z
  .object({
    integration: composioIntegrationNameSchema.describe(
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

export const composioListToolsOutputSchema = z
  .object({
    error: z.string().nullable(),
    integration: composioIntegrationNameSchema,
    successful: z.boolean(),
    toolCount: z.number().int().nonnegative(),
    toolsJson: z.string(),
    toolsTruncated: z.boolean(),
  })
  .strict();

export const composioExecuteInputSchema = z
  .object({
    allowLatestVersion: z
      .boolean()
      .default(false)
      .describe("Set true only when the user accepts executing the latest Composio tool version."),
    arguments: composioArgumentsSchema,
    integration: composioIntegrationNameSchema.describe(
      "Connected integration to use for this action.",
    ),
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

export const composioExecuteOutputSchema = z
  .object({
    connectedAccountId: z.string().nullable(),
    data: z.string(),
    dataTruncated: z.boolean(),
    error: z.string().nullable(),
    integration: composioIntegrationNameSchema,
    logId: z.string().nullable(),
    quota: z
      .object({
        limit: z.number().finite().nonnegative(),
        remaining: z.number().finite().nonnegative(),
      })
      .strict()
      .nullable(),
    successful: z.boolean(),
    toolSlug: z.string(),
  })
  .strict();

const composioExecuteResponseSchema = z
  .object({
    data: z.record(z.string(), z.unknown()),
    error: z.string().nullable(),
    logId: z.string().optional(),
    sessionInfo: z.unknown().optional(),
    successful: z.boolean(),
  })
  .strict();

// `getRawComposioTools` returns framework-agnostic tool definitions. The default
// object schema strips every other key, projecting each tool down to exactly what
// the agent needs to then call composio_execute: the canonical `slug`, the input
// argument schema, and the toolkit `version`/deprecation signal. Dropping
// `outputParameters`/`tags`/`toolkit` keeps more actions under MAX_COMPOSIO_OUTPUT_CHARS.
const composioRawToolSchema = z.object({
  slug: z.string(),
  name: z.string().optional(),
  description: z.string().optional(),
  inputParameters: z.unknown().optional(),
  version: z.string().optional(),
  isDeprecated: z.boolean().optional(),
});

const composioRawToolListSchema = z.array(composioRawToolSchema);

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

export interface ComposioToolClient {
  execute(slug: string, body: ComposioExecuteBody): Promise<unknown>;
  getRawTools(options: { limit?: number; search?: string; toolkits: string[] }): Promise<unknown>;
}

interface ComposioExecuteBody {
  arguments: Record<string, unknown>;
  connectedAccountId: string;
  dangerouslySkipVersionCheck?: boolean;
  userId: string;
  version?: string;
}

interface BoundedJson {
  text: string;
  truncated: boolean;
}

// Dynamically imported so the ~1.2 MB Composio SDK stays out of the agent-worker
// isolate's startup path (CF startup CPU limit). Only loaded when a Composio tool
// actually fires.
async function createComposioToolClient(apiKey: string): Promise<ComposioToolClient> {
  const { Composio } = await import("@composio/core");
  const composio = new Composio({
    allowTracking: false,
    apiKey,
    baseURL: COMPOSIO_BASE_URL,
    toolkitVersions: COMPOSIO_TOOLKIT_VERSIONS,
  });
  return {
    execute: (slug, body) => composio.tools.execute(slug, body),
    getRawTools: (options) => composio.tools.getRawComposioTools(options),
  };
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
    ...(typeof userId === "string" && userId.trim() ? { userId } : {}),
  };
}

function isComposioQuotaMeter(value: unknown): value is ComposioQuotaMeter {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { consumeCall?: unknown }).consumeCall === "function"
  );
}

export async function listComposioTools(
  input: ComposioListToolsInput,
  runtime: ComposioRuntimeContext,
  client?: ComposioToolClient,
): Promise<ComposioListToolsOutput> {
  if (!runtime.apiKey || !runtime.userId) {
    return composioListFailure(input, "Composio is not configured for this run.");
  }
  if (!runtime.connectedAccounts[input.integration]) {
    return composioListFailure(input, `Connect ${input.integration} in Settings first.`);
  }

  try {
    const toolClient = client ?? (await createComposioToolClient(runtime.apiKey));
    const rawTools = await toolClient.getRawTools(
      input.search
        ? { limit: COMPOSIO_LIST_LIMIT, search: input.search, toolkits: [input.integration] }
        : { limit: COMPOSIO_LIST_LIMIT, toolkits: [input.integration] },
    );
    const parsed = composioRawToolListSchema.safeParse(rawTools);
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
      toolsTruncated: bounded.truncated,
    });
  } catch (error) {
    return composioListFailure(input, externalErrorMessage(error));
  }
}

export async function executeComposioAction(
  input: ComposioExecuteInput,
  runtime: ComposioRuntimeContext,
  client?: ComposioToolClient,
): Promise<ComposioExecuteOutput> {
  const connectionId = runtime.connectedAccounts[input.integration] ?? null;
  if (!runtime.apiKey || !runtime.userId) {
    return composioExecuteFailure(input, connectionId, "Composio is not configured for this run.");
  }
  if (!connectionId) {
    return composioExecuteFailure(input, null, `Connect ${input.integration} in Settings first.`);
  }
  if (!serializedArgumentsAreWithinLimit(input.arguments)) {
    return composioExecuteFailure(input, connectionId, "Composio arguments exceed 100KB.");
  }

  const quota = await runtime.quotaMeter?.consumeCall();
  if (quota && !quota.allowed) {
    return composioExecuteFailure(input, connectionId, "Composio monthly call quota exhausted.", {
      limit: quota.limit,
      remaining: quota.remaining,
    });
  }

  try {
    const toolClient = client ?? (await createComposioToolClient(runtime.apiKey));
    const response = composioExecuteResponseSchema.parse(
      await toolClient.execute(input.toolSlug, executeBody(input, runtime.userId, connectionId)),
    );
    const bounded = boundedJson(response.data, MAX_COMPOSIO_OUTPUT_CHARS);
    return composioExecuteOutputSchema.parse({
      connectedAccountId: connectionId,
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
    return composioExecuteFailure(input, connectionId, externalErrorMessage(error), quota ?? null);
  }
}

function executeBody(
  input: ComposioExecuteInput,
  userId: string,
  connectedAccountId: string,
): ComposioExecuteBody {
  return {
    arguments: input.arguments,
    connectedAccountId,
    ...(input.allowLatestVersion ? { dangerouslySkipVersionCheck: true } : {}),
    userId,
    ...(input.version ? { version: input.version } : {}),
  };
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
    return JSON.stringify(args).length <= MAX_COMPOSIO_ARGUMENTS_JSON_CHARS;
  } catch {
    return false;
  }
}

function boundedJson(value: unknown, maxChars: number): BoundedJson {
  const text = stringifyJson(value);
  if (text.length <= maxChars) {
    return { text, truncated: false };
  }
  return { text: text.slice(0, maxChars), truncated: true };
}

// Serializes tools into a VALID JSON array bounded by char budget — it drops whole
// tools rather than slicing mid-object (which boundedJson's substring would, handing
// the model malformed JSON it cannot parse for slugs). Truncation is surfaced via
// toolsTruncated so the model knows to re-list with a narrower `search`.
function boundedToolListJson(tools: readonly unknown[], maxChars: number): BoundedJson {
  const serialized: string[] = [];
  let size = 2; // surrounding "[]"
  for (const tool of tools) {
    const entry = stringifyJson(tool);
    const addition = entry.length + (serialized.length > 0 ? 1 : 0); // comma separator
    if (size + addition > maxChars) {
      return { text: `[${serialized.join(",")}]`, truncated: true };
    }
    serialized.push(entry);
    size += addition;
  }
  return { text: `[${serialized.join(",")}]`, truncated: false };
}

function stringifyJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "null";
  } catch {
    return JSON.stringify({ error: "Composio result was not JSON serializable." });
  }
}

function externalErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return "Composio tool execution failed.";
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
  execute: async (input, context) =>
    executeComposioAction(
      composioExecuteInputSchema.parse(input),
      composioRuntimeFromContext(context),
    ),
});
