import { APIError } from "@cheatcode/observability";
import { CodeRuntimeContextSchema } from "@cheatcode/sandbox-contracts";
import type { BrowserProvider, BrowserRuntimeContext } from "../../tools/browser";
import { CONTEXT } from "../context";
import {
  DEFAULT_ANTHROPIC_MODEL_ID,
  DEFAULT_GOOGLE_MODEL_ID,
  DEFAULT_OPENAI_MODEL_ID,
} from "../llm-context";

const BROWSER_PROVIDER_CONFIG: Record<
  BrowserProvider,
  { apiKeyContext: string; defaultModelId: string }
> = {
  anthropic: {
    apiKeyContext: CONTEXT.anthropicApiKey,
    defaultModelId: DEFAULT_ANTHROPIC_MODEL_ID,
  },
  google: {
    apiKeyContext: CONTEXT.googleApiKey,
    defaultModelId: DEFAULT_GOOGLE_MODEL_ID,
  },
  openai: {
    apiKeyContext: CONTEXT.openaiApiKey,
    defaultModelId: DEFAULT_OPENAI_MODEL_ID,
  },
};
const BROWSER_PROVIDER_FALLBACK_ORDER: readonly BrowserProvider[] = [
  "anthropic",
  "openai",
  "google",
];

export interface RequestContextReader {
  get(key: string): unknown;
}

export function browserRuntimeFromRequestContext(
  requestContext: RequestContextReader,
): BrowserRuntimeContext {
  const runtimeContext = CodeRuntimeContextSchema.parse(requestContext.get(CONTEXT.codeRuntime));
  const runId = requestContext.get(CONTEXT.browserRunId);
  if (typeof runId !== "string" || runId.length === 0) {
    throw new APIError(
      500,
      "internal_service_error",
      "Browser runtime is missing its run identity.",
      {
        retriable: false,
      },
    );
  }
  return {
    ...(runtimeContext.artifacts ? { artifacts: runtimeContext.artifacts } : {}),
    credential: browserCredentialFromRequestContext(requestContext),
    runId,
    sandbox: runtimeContext.sandbox,
  };
}

function browserCredentialFromRequestContext(requestContext: RequestContextReader) {
  const requestedProvider = requestContext.get(CONTEXT.llmProvider);
  const modelId = requestContext.get(CONTEXT.llmModelId);
  if (isBrowserProvider(requestedProvider)) {
    const config = BROWSER_PROVIDER_CONFIG[requestedProvider];
    return providerCredential(
      requestedProvider,
      requestContext.get(config.apiKeyContext),
      modelId,
      config.defaultModelId,
    );
  }
  return fallbackBrowserCredential(requestContext);
}

function fallbackBrowserCredential(requestContext: RequestContextReader) {
  // Fallback for non-vision providers (for example, an included DeepSeek or OpenRouter run): browser
  // tools need a vision/CUA key, so prefer any the user has. The platform DeepSeek key is
  // never read here, so it can never reach the sandbox as a browser credential.
  for (const provider of BROWSER_PROVIDER_FALLBACK_ORDER) {
    const config = BROWSER_PROVIDER_CONFIG[provider];
    const apiKey = requestContext.get(config.apiKeyContext);
    if (typeof apiKey === "string" && apiKey.trim().length > 0) {
      return providerCredential(provider, apiKey, undefined, config.defaultModelId);
    }
  }
  throw new APIError(
    400,
    "byok_key_missing",
    "Browser automation needs an Anthropic, OpenAI, or Google API key.",
    {
      hint: "Add one in Settings → Models. The included DeepSeek model does not power browser tools.",
      retriable: false,
    },
  );
}

function isBrowserProvider(value: unknown): value is BrowserProvider {
  return value === "anthropic" || value === "google" || value === "openai";
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
