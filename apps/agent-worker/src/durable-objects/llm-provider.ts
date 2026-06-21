import {
  DEFAULT_DEEPSEEK_MODEL_ID,
  DEFAULT_OPENAI_MODEL_ID,
  type LlmModelSelection,
  type LlmProvider,
  resolveRequestedLlmModel,
} from "@cheatcode/agent-core";
import { getProviderKey } from "@cheatcode/byok";
import {
  createDb,
  type Database,
  type DatabaseHandle,
  getFreeDeepseekUsage,
  withUserContext,
} from "@cheatcode/db";
import { resolveWorkerSecret, type WorkerSecret } from "@cheatcode/env";
import { APIError, type createLogger } from "@cheatcode/observability";
import { FREE_DEEPSEEK_MODEL_ID, UserId } from "@cheatcode/types";
import { closeDatabaseBestEffort } from "./db-close";

interface LlmProviderEnv {
  HYPERDRIVE: Hyperdrive;
  DEEPSEEK_PLATFORM_API_KEY?: WorkerSecret;
}

interface LlmProviderInput {
  model?: string | undefined;
  userId: string;
  /** Whether the user explicitly chose this model (vs an Auto/implicit default). */
  modelExplicit?: boolean | undefined;
  /** Models the user disabled in settings; gates the free-DeepSeek fallback. */
  disabledModels?: readonly string[] | undefined;
}

export type CreditSource = "byok" | "platform_free";

export interface LlmCredential extends LlmModelSelection {
  apiKey: string;
  creditSource: CreditSource;
  /** For platform_free runs: the user's free-token count at resolution (DO hard-stop baseline). */
  freeTokensUsedAtResolve?: number;
}

interface FreeTierContext {
  platformDeepseekKey: string | undefined;
  modelExplicit: boolean;
  disabledModels: readonly string[];
}

interface ResolvedTransport {
  apiKey: string;
  selection: LlmModelSelection;
  creditSource: CreditSource;
  freeTokensUsed?: number;
}

export async function resolveLlmCredential(
  env: LlmProviderEnv,
  input: LlmProviderInput,
  logger: ReturnType<typeof createLogger>,
): Promise<LlmCredential> {
  const selection = resolveModelSelection(input.model);
  const platformDeepseekKey = await resolveWorkerSecret(env.DEEPSEEK_PLATFORM_API_KEY);
  return resolveProviderKey(env, input.userId, selection, logger, {
    disabledModels: input.disabledModels ?? [],
    modelExplicit: input.modelExplicit ?? Boolean(input.model?.trim()),
    platformDeepseekKey,
  });
}

export async function resolveOpenAiFallbackCredential(
  env: LlmProviderEnv,
  input: LlmProviderInput,
  logger: ReturnType<typeof createLogger>,
): Promise<LlmCredential | null> {
  const selection = { provider: "openai", modelId: DEFAULT_OPENAI_MODEL_ID } as const;
  try {
    // The OpenAI fallback never rides free DeepSeek credits (platform key withheld).
    return await resolveProviderKey(env, input.userId, selection, logger, {
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
      hint: "Use a supported Anthropic, Google Gemini, OpenAI, DeepSeek, or OpenRouter model id.",
      retriable: false,
    });
  }
}

async function resolveProviderKey(
  env: LlmProviderEnv,
  userId: string,
  selection: LlmModelSelection,
  logger: ReturnType<typeof createLogger>,
  freeTier: FreeTierContext,
): Promise<LlmCredential> {
  const dbHandle = createDb(env.HYPERDRIVE);
  const brandedUserId = UserId(userId);
  try {
    const resolved = await withUserContext(dbHandle.db, brandedUserId, (db) =>
      resolveTransportKey(db, brandedUserId, selection, freeTier),
    );
    logger.info("byok_provider_key_resolved", {
      creditSource: resolved.creditSource,
      modelId: resolved.selection.modelId,
      provider: resolved.selection.provider,
    });
    return {
      ...resolved.selection,
      apiKey: resolved.apiKey,
      creditSource: resolved.creditSource,
      ...(resolved.freeTokensUsed === undefined
        ? {}
        : { freeTokensUsedAtResolve: resolved.freeTokensUsed }),
    };
  } finally {
    await closeDatabase(dbHandle, logger);
  }
}

/**
 * Transport rule (plan §"Credential resolution"): (a) the user's direct provider key
 * always wins. The platform free DeepSeek key then serves the `deepseek-v4-flash` SKU —
 * before OpenRouter when the user explicitly picked it, or after OpenRouter as the last
 * resort for an Auto/implicit run with no usable key. (c) Otherwise a non-OpenRouter
 * selection routes through OpenRouter when a key is present. Runs inside the caller's
 * withUserContext connection. The free SKU never silently downgrades a `deepseek-v4-pro`
 * request, and an explicit non-free pick is never swapped to free credits.
 */
async function resolveTransportKey(
  db: Database,
  userId: UserId,
  selection: LlmModelSelection,
  freeTier: FreeTierContext,
): Promise<ResolvedTransport> {
  // (a) The user's own direct provider key always wins (incl. their own DeepSeek key).
  const directKey = await getProviderKey(db, selection.provider);
  if (directKey) {
    return { apiKey: directKey, creditSource: "byok", selection };
  }

  const wantsFreeFlash =
    selection.provider === "deepseek" && selection.modelId === DEFAULT_DEEPSEEK_MODEL_ID;
  const platformKey = freeTier.platformDeepseekKey;
  const freeModelAllowed =
    platformKey !== undefined && !freeTier.disabledModels.includes(FREE_DEEPSEEK_MODEL_ID);
  // Memoize the allowance read so the gate costs at most one query per resolution.
  let freeUsage: { limit: number; used: number } | undefined;
  const tryPlatformFree = async (): Promise<ResolvedTransport | null> => {
    if (!freeModelAllowed || platformKey === undefined) {
      return null;
    }
    if (freeUsage === undefined) {
      freeUsage = await getFreeDeepseekUsage(db, userId);
    }
    return freeUsage.used < freeUsage.limit
      ? platformFreeTransport(platformKey, freeUsage.used)
      : null;
  };

  // (b) Explicit free-flash pick → platform free before OpenRouter.
  if (wantsFreeFlash) {
    const free = await tryPlatformFree();
    if (free) {
      return free;
    }
  }

  // (c) OpenRouter fallback (existing D9 rule).
  if (selection.provider !== "openrouter") {
    const openrouterKey = await getProviderKey(db, "openrouter");
    if (openrouterKey) {
      return {
        apiKey: openrouterKey,
        creditSource: "byok",
        selection: { modelId: openRouterSlug(selection), provider: "openrouter" },
      };
    }
  }

  // (d) Auto/implicit run with no usable key → platform free as a last resort.
  if (!freeTier.modelExplicit) {
    const free = await tryPlatformFree();
    if (free) {
      return free;
    }
  }

  // The free path was attempted but the allowance is spent → a clear "used up" error
  // (vs a generic missing-key error) so the user knows to add their own key.
  if (freeUsage !== undefined && freeUsage.used >= freeUsage.limit) {
    throw freeDeepseekQuotaExhausted();
  }
  throw missingProviderKey(selection.provider);
}

function platformFreeTransport(apiKey: string, freeTokensUsed: number): ResolvedTransport {
  return {
    apiKey,
    creditSource: "platform_free",
    freeTokensUsed,
    selection: { modelId: DEFAULT_DEEPSEEK_MODEL_ID, provider: "deepseek" },
  };
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
  if (provider === "deepseek") {
    return "DeepSeek";
  }
  return "OpenRouter";
}

function freeDeepseekQuotaExhausted(): APIError {
  return new APIError(
    402,
    "deepseek_free_quota_exhausted",
    "Your 200,000 free DeepSeek tokens are used up.",
    {
      hint: "Add your own DeepSeek (or Anthropic/OpenAI) key in Settings → Models to keep building.",
      retriable: false,
    },
  );
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
