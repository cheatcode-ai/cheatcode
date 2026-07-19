import {
  DEFAULT_DEEPSEEK_MODEL_ID,
  DEFAULT_OPENAI_MODEL_ID,
  type LlmProvider,
  type LlmTransportSelection,
  resolveRequestedLlmTransport,
} from "@cheatcode/agent-core";
import { getProviderKey } from "@cheatcode/byok";
import { createDb, type Database, type DatabaseHandle, withUserContext } from "@cheatcode/db";
import { resolveWorkerSecret, type WorkerSecret } from "@cheatcode/env";
import { APIError, type createLogger } from "@cheatcode/observability";
import {
  FALLBACK_MODEL_ID,
  INCLUDED_DEEPSEEK_MODEL_ID,
  type LogicalModelId,
  LogicalModelIdSchema,
  UserId,
} from "@cheatcode/types";
import { closeDatabaseBestEffort } from "./db-close";

interface LlmProviderEnv {
  DATABASE_CONTEXT_SIGNING_SECRET_AGENT: WorkerSecret;
  DEEPSEEK_PLATFORM_API_KEY?: WorkerSecret;
  HYPERDRIVE: Hyperdrive;
}

interface LlmProviderInput {
  model: LogicalModelId;
  userId: string;
  /** Whether the request or project settings pinned this model (vs Auto). */
  modelExplicit: boolean;
  /** Models the user disabled in settings; gates the included DeepSeek fallback. */
  disabledModels: readonly string[];
}

/** Request-scoped secret plus the product and transport model identities it authorizes. */
export interface LlmCredential {
  apiKey: string;
  logicalModelId: LogicalModelId;
  transportModelId: string;
  transportProvider: LlmProvider;
}

interface PlatformFallbackContext {
  platformDeepseekKey: string | undefined;
  modelExplicit: boolean;
  disabledModels: readonly string[];
}

interface ResolvedTransport {
  apiKey: string;
  logicalModelId: LogicalModelId;
  transportModelId: string;
  transportProvider: LlmProvider;
}

interface RequestedModel {
  logicalModelId: LogicalModelId;
  selection: LlmTransportSelection;
}

export async function resolveLlmCredential(
  env: LlmProviderEnv,
  input: LlmProviderInput,
  logger: ReturnType<typeof createLogger>,
): Promise<LlmCredential> {
  const requestedModel = resolveModelRequest(input.model);
  const platformDeepseekKey = await resolveWorkerSecret(env.DEEPSEEK_PLATFORM_API_KEY);
  return resolveProviderKey(env, input.userId, requestedModel, logger, {
    disabledModels: input.disabledModels,
    modelExplicit: input.modelExplicit,
    platformDeepseekKey,
  });
}

export async function resolveOpenAiFallbackCredential(
  env: LlmProviderEnv,
  input: LlmProviderInput,
  logger: ReturnType<typeof createLogger>,
): Promise<LlmCredential | null> {
  const requestedModel: RequestedModel = {
    logicalModelId: FALLBACK_MODEL_ID,
    selection: { provider: "openai", modelId: DEFAULT_OPENAI_MODEL_ID },
  };
  try {
    // The OpenAI fallback never receives the platform DeepSeek key.
    return await resolveProviderKey(env, input.userId, requestedModel, logger, {
      disabledModels: [],
      modelExplicit: true,
      platformDeepseekKey: undefined,
    });
  } catch (error) {
    if (error instanceof APIError && error.code === "byok_key_missing") {
      logger.warn("llm_provider_fallback_unavailable", { provider: "openai" });
      return null;
    }
    throw error;
  }
}

export function shouldFallbackToOpenAI(
  modelExplicit: boolean,
  primary: LlmCredential,
  hasVisibleOutput: boolean,
  error: unknown,
): boolean {
  // Restarting after visible output can duplicate a tool side effect or splice two answers.
  if (modelExplicit || hasVisibleOutput || primary.transportProvider !== "anthropic") {
    return false;
  }
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  const statusCode = readStatusCode(error);
  const providerFailure =
    message.includes("credit") ||
    message.includes("quota") ||
    message.includes("billing") ||
    message.includes("rate limit") ||
    message.includes("rate-limit") ||
    message.includes("insufficient");
  const opaqueProviderStreamFailure =
    message === "unknown mastra stream error." || message === "mastra stream error.";
  return (
    (providerFailure || opaqueProviderStreamFailure) &&
    (statusCode === null || [400, 401, 403, 429].includes(statusCode))
  );
}

/**
 * Classify why a primary provider stream failed, for the interactive fallback
 * card. Reuses the message heuristics of
 * {@link shouldFallbackToOpenAI} without changing its behavior. Returns a
 * coarse, enum-safe reason (never the raw provider text, which may embed
 * secrets).
 */
export function classifyFallbackReason(
  error: unknown,
): "provider_balance" | "provider_error" | "rate_limit" {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  const statusCode = readStatusCode(error);
  if (statusCode === 429 || message.includes("rate limit") || message.includes("rate-limit")) {
    return "rate_limit";
  }
  if (
    message.includes("credit") ||
    message.includes("quota") ||
    message.includes("billing") ||
    message.includes("insufficient")
  ) {
    return "provider_balance";
  }
  return "provider_error";
}

function resolveModelRequest(model: LogicalModelId): RequestedModel {
  try {
    const selection = resolveRequestedLlmTransport(model);
    return {
      logicalModelId: logicalModelIdForSelection(selection),
      selection,
    };
  } catch (error) {
    throw new APIError(400, "invalid_request_body", "Unsupported model selection.", {
      details: { message: error instanceof Error ? error.message : "Unknown model error" },
      hint: "Use a supported Anthropic, Google Gemini, OpenAI, DeepSeek, or OpenRouter model id.",
      retriable: false,
    });
  }
}

async function resolveProviderKey(
  env: LlmProviderEnv,
  userId: string,
  requestedModel: RequestedModel,
  logger: ReturnType<typeof createLogger>,
  platformFallback: PlatformFallbackContext,
): Promise<LlmCredential> {
  const dbHandle = createDb(env.HYPERDRIVE, {
    audience: "app_agent",
    signingSecret: env.DATABASE_CONTEXT_SIGNING_SECRET_AGENT,
  });
  const brandedUserId = UserId(userId);
  try {
    const resolved = await withUserContext(dbHandle.db, brandedUserId, (db) =>
      resolveTransportKey(db, requestedModel, platformFallback),
    );
    logger.info("byok_provider_key_resolved", {
      logicalModelId: resolved.logicalModelId,
      transportModelId: resolved.transportModelId,
      transportProvider: resolved.transportProvider,
    });
    return resolved;
  } finally {
    await closeDatabase(dbHandle, logger);
  }
}

/**
 * Transport rule: (a) the user's direct provider key
 * always wins. The platform DeepSeek key then serves the `deepseek-v4-flash` SKU —
 * before OpenRouter when the user explicitly picked it, or after OpenRouter as the last
 * resort for an Auto/implicit run with no usable key. (c) Otherwise a non-OpenRouter
 * selection routes through OpenRouter when a key is present. Runs inside the caller's
 * withUserContext connection. The platform SKU never silently downgrades a
 * `deepseek-v4-pro` request, and an explicit model pick is never replaced.
 */
async function resolveTransportKey(
  db: Database,
  requestedModel: RequestedModel,
  platformFallback: PlatformFallbackContext,
): Promise<ResolvedTransport> {
  const { logicalModelId, selection } = requestedModel;
  // (a) The user's own direct provider key always wins (incl. their own DeepSeek key).
  const directKey = await getProviderKey(db, selection.provider);
  if (directKey) {
    return transportCredential(directKey, logicalModelId, selection);
  }

  const wantsPlatformFlash =
    selection.provider === "deepseek" && selection.modelId === DEFAULT_DEEPSEEK_MODEL_ID;
  const platformKey = allowedPlatformKey(platformFallback);

  // (b) Explicit platform-model pick → platform key before OpenRouter.
  if (wantsPlatformFlash && platformKey) {
    return platformTransport(platformKey);
  }

  // (c) Route through OpenRouter when the user configured it.
  if (selection.provider !== "openrouter") {
    const openrouterKey = await getProviderKey(db, "openrouter");
    if (openrouterKey) {
      return {
        apiKey: openrouterKey,
        logicalModelId,
        transportModelId: openRouterSlug(selection),
        transportProvider: "openrouter",
      };
    }
  }

  // (d) Auto/implicit run with no usable key → platform model as a last resort.
  if (!platformFallback.modelExplicit && platformKey) {
    return platformTransport(platformKey);
  }

  throw missingProviderKey(selection.provider);
}

function allowedPlatformKey(fallback: PlatformFallbackContext): string | undefined {
  if (fallback.disabledModels.includes(INCLUDED_DEEPSEEK_MODEL_ID)) {
    return undefined;
  }
  return fallback.platformDeepseekKey;
}

function platformTransport(apiKey: string): ResolvedTransport {
  return {
    apiKey,
    logicalModelId: INCLUDED_DEEPSEEK_MODEL_ID,
    transportModelId: DEFAULT_DEEPSEEK_MODEL_ID,
    transportProvider: "deepseek",
  };
}

function transportCredential(
  apiKey: string,
  logicalModelId: LogicalModelId,
  selection: LlmTransportSelection,
): ResolvedTransport {
  return {
    apiKey,
    logicalModelId,
    transportModelId: selection.modelId,
    transportProvider: selection.provider,
  };
}

function logicalModelIdForSelection(selection: LlmTransportSelection): LogicalModelId {
  return LogicalModelIdSchema.parse(`${selection.provider}/${selection.modelId}`);
}

function openRouterSlug(selection: LlmTransportSelection): string {
  return `${selection.provider}/${selection.modelId}`;
}

function missingProviderKey(provider: LlmProvider): APIError {
  const label = providerLabel(provider);
  return new APIError(400, "byok_key_missing", `Add a ${label} BYOK key before starting a run.`, {
    hint: `Open BYOK Settings and save a ${label} API key.`,
    retriable: false,
  });
}

function providerLabel(provider: LlmProvider): string {
  if (provider === "anthropic") {
    return "Anthropic";
  }
  if (provider === "openai") {
    return "OpenAI";
  }
  if (provider === "google") {
    return "Google Gemini";
  }
  if (provider === "deepseek") {
    return "DeepSeek";
  }
  return "OpenRouter";
}

function readStatusCode(error: unknown): number | null {
  if (!isRecord(error)) {
    return null;
  }
  const statusCode = error["statusCode"] ?? error["status"];
  return typeof statusCode === "number" ? statusCode : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function closeDatabase(
  dbHandle: DatabaseHandle,
  logger: ReturnType<typeof createLogger>,
): Promise<void> {
  await closeDatabaseBestEffort({ dbHandle, logger, operation: "resolve_llm_credentials" });
}
