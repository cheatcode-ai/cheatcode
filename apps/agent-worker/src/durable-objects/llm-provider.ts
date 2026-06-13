import {
  DEFAULT_OPENAI_MODEL_ID,
  type LlmModelSelection,
  type LlmProvider,
  resolveRequestedLlmModel,
} from "@cheatcode/agent-core";
import { getProviderKey } from "@cheatcode/byok";
import { createDb, type Database, type DatabaseHandle, withUserContext } from "@cheatcode/db";
import { APIError, type createLogger } from "@cheatcode/observability";
import { UserId } from "@cheatcode/types";
import { closeDatabaseBestEffort } from "./db-close";

interface LlmProviderEnv {
  HYPERDRIVE: Hyperdrive;
}

interface LlmProviderInput {
  model?: string | undefined;
  userId: string;
}

export interface LlmCredential extends LlmModelSelection {
  apiKey: string;
}

export async function resolveLlmCredential(
  env: LlmProviderEnv,
  input: LlmProviderInput,
  logger: ReturnType<typeof createLogger>,
): Promise<LlmCredential> {
  const selection = resolveModelSelection(input.model);
  return resolveProviderKey(env, input.userId, selection, logger);
}

export async function resolveOpenAiFallbackCredential(
  env: LlmProviderEnv,
  input: LlmProviderInput,
  logger: ReturnType<typeof createLogger>,
): Promise<LlmCredential | null> {
  const selection = { provider: "openai", modelId: DEFAULT_OPENAI_MODEL_ID } as const;
  try {
    return await resolveProviderKey(env, input.userId, selection, logger);
  } catch (error) {
    if (error instanceof APIError && error.code === "byok_key_missing") {
      logger.warn("llm_provider_fallback_unavailable", { provider: "openai" });
      return null;
    }
    throw error;
  }
}

export function shouldFallbackToOpenAI(
  requestedModel: string | undefined,
  primary: LlmModelSelection,
  error: unknown,
): boolean {
  if (requestedModel?.trim() || primary.provider !== "anthropic") {
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
 * card (run-control §5.5). Reuses the message heuristics of
 * {@link shouldFallbackToOpenAI} without changing its behavior. Returns a
 * coarse, enum-safe reason (never the raw provider text, which may embed
 * secrets — see run-control §8 redaction rule).
 */
export function classifyFallbackReason(
  error: unknown,
): "credits" | "provider_error" | "rate_limit" {
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
    return "credits";
  }
  return "provider_error";
}

function resolveModelSelection(model: string | undefined): LlmModelSelection {
  try {
    return resolveRequestedLlmModel(model);
  } catch (error) {
    throw new APIError(400, "invalid_request_body", "Unsupported model selection.", {
      details: { message: error instanceof Error ? error.message : "Unknown model error" },
      hint: "Use a supported Anthropic, Google Gemini, OpenAI, or OpenRouter model id.",
      retriable: false,
    });
  }
}

async function resolveProviderKey(
  env: LlmProviderEnv,
  userId: string,
  selection: LlmModelSelection,
  logger: ReturnType<typeof createLogger>,
): Promise<LlmCredential> {
  const dbHandle = createDb(env.HYPERDRIVE);
  try {
    const resolved = await withUserContext(dbHandle.db, UserId(userId), (db) =>
      resolveTransportKey(db, selection),
    );
    logger.info("byok_provider_key_resolved", {
      modelId: resolved.selection.modelId,
      provider: resolved.selection.provider,
    });
    return { ...resolved.selection, apiKey: resolved.apiKey };
  } finally {
    await closeDatabase(dbHandle, logger);
  }
}

/**
 * D9 transport rule: prefer the user's direct provider key; otherwise route a
 * non-OpenRouter selection through OpenRouter (using the full `provider/model`
 * slug) when an OpenRouter key is present; otherwise the model is unavailable.
 * Runs inside the caller's already-open withUserContext connection — at most one
 * extra indexed get_provider_key call on the direct-key miss path.
 */
async function resolveTransportKey(
  db: Database,
  selection: LlmModelSelection,
): Promise<{ apiKey: string; selection: LlmModelSelection }> {
  const directKey = await getProviderKey(db, selection.provider);
  if (directKey) {
    return { apiKey: directKey, selection };
  }
  if (selection.provider !== "openrouter") {
    const openrouterKey = await getProviderKey(db, "openrouter");
    if (openrouterKey) {
      return {
        apiKey: openrouterKey,
        selection: { modelId: openRouterSlug(selection), provider: "openrouter" },
      };
    }
  }
  throw missingProviderKey(selection.provider);
}

function openRouterSlug(selection: LlmModelSelection): string {
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
