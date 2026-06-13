import {
  DEFAULT_OPENAI_MODEL_ID,
  type LlmModelSelection,
  type LlmProvider,
  resolveRequestedLlmModel,
} from "@cheatcode/agent-core";
import { getProviderKey } from "@cheatcode/byok";
import { createDb, type DatabaseHandle, withUserContext } from "@cheatcode/db";
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
    const apiKey = await withUserContext(dbHandle.db, UserId(userId), (db) =>
      getProviderKey(db, selection.provider),
    );
    if (!apiKey) {
      throw missingProviderKey(selection.provider);
    }
    logger.info("byok_provider_key_resolved", {
      modelId: selection.modelId,
      provider: selection.provider,
    });
    return { ...selection, apiKey };
  } finally {
    await closeDatabase(dbHandle, logger);
  }
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
