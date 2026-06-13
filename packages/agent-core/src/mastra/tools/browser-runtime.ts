import { APIError } from "@cheatcode/observability";
import type { BrowserProvider, BrowserRuntimeContext } from "@cheatcode/tools-browser";
import { CodeRuntimeContextSchema } from "@cheatcode/tools-code";
import {
  ANTHROPIC_API_KEY_CONTEXT_KEY,
  DEFAULT_ANTHROPIC_MODEL_ID,
  DEFAULT_GOOGLE_MODEL_ID,
  DEFAULT_OPENAI_MODEL_ID,
  GOOGLE_API_KEY_CONTEXT_KEY,
  LLM_MODEL_ID_CONTEXT_KEY,
  LLM_PROVIDER_CONTEXT_KEY,
  OPENAI_API_KEY_CONTEXT_KEY,
} from "../llm-context";

export interface RequestContextReader {
  get(key: string): unknown;
}

export function browserRuntimeFromRequestContext(
  requestContext: RequestContextReader,
): BrowserRuntimeContext {
  const runtimeContext = CodeRuntimeContextSchema.parse(requestContext.get("codeRuntime"));
  return {
    credential: browserCredentialFromRequestContext(requestContext),
    sandbox: runtimeContext.sandbox,
  };
}

function browserCredentialFromRequestContext(requestContext: RequestContextReader) {
  const requestedProvider = requestContext.get(LLM_PROVIDER_CONTEXT_KEY);
  const modelId = requestContext.get(LLM_MODEL_ID_CONTEXT_KEY);
  if (requestedProvider === "openai") {
    return providerCredential(
      "openai",
      requestContext.get(OPENAI_API_KEY_CONTEXT_KEY),
      modelId,
      DEFAULT_OPENAI_MODEL_ID,
    );
  }
  if (requestedProvider === "anthropic") {
    return providerCredential(
      "anthropic",
      requestContext.get(ANTHROPIC_API_KEY_CONTEXT_KEY),
      modelId,
      DEFAULT_ANTHROPIC_MODEL_ID,
    );
  }
  if (requestedProvider === "google") {
    return providerCredential(
      "google",
      requestContext.get(GOOGLE_API_KEY_CONTEXT_KEY),
      modelId,
      DEFAULT_GOOGLE_MODEL_ID,
    );
  }

  const anthropicKey = requestContext.get(ANTHROPIC_API_KEY_CONTEXT_KEY);
  if (typeof anthropicKey === "string" && anthropicKey.trim().length > 0) {
    return providerCredential("anthropic", anthropicKey, undefined, DEFAULT_ANTHROPIC_MODEL_ID);
  }
  return providerCredential(
    "openai",
    requestContext.get(OPENAI_API_KEY_CONTEXT_KEY),
    undefined,
    DEFAULT_OPENAI_MODEL_ID,
  );
}

function providerCredential(
  provider: BrowserProvider,
  apiKey: unknown,
  modelId: unknown,
  defaultModelId: string,
) {
  if (typeof apiKey !== "string" || apiKey.trim().length === 0) {
    const label = browserProviderLabel(provider);
    throw new APIError(
      400,
      "byok_key_missing",
      `Add a ${label} BYOK key before using browser tools.`,
      {
        details: { provider },
        hint: `Open BYOK Settings and save a ${label} API key.`,
        retriable: false,
      },
    );
  }
  return {
    apiKey: apiKey.trim(),
    modelId: typeof modelId === "string" && modelId.trim().length > 0 ? modelId : defaultModelId,
    provider,
  };
}

function browserProviderLabel(provider: BrowserProvider): string {
  if (provider === "anthropic") {
    return "Anthropic";
  }
  if (provider === "google") {
    return "Google Gemini";
  }
  return "OpenAI";
}
