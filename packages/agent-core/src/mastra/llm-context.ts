import {
  FALLBACK_MODEL_ID,
  INCLUDED_DEEPSEEK_MODEL_ID,
  PRODUCTION_DEFAULT_MODEL_ID,
} from "@cheatcode/types";

export const ANTHROPIC_API_KEY_CONTEXT_KEY = "anthropicApiKey";
export const GOOGLE_API_KEY_CONTEXT_KEY = "googleApiKey";
export const OPENAI_API_KEY_CONTEXT_KEY = "openaiApiKey";
export const OPENROUTER_API_KEY_CONTEXT_KEY = "openrouterApiKey";
export const DEEPSEEK_API_KEY_CONTEXT_KEY = "deepseekApiKey";
export const LLM_MODEL_ID_CONTEXT_KEY = "llmModelId";
export const LLM_PROVIDER_CONTEXT_KEY = "llmProvider";
export const DEFAULT_ANTHROPIC_MODEL_ID = providerLocalModelId(
  PRODUCTION_DEFAULT_MODEL_ID,
  "anthropic/",
);
export const DEFAULT_GOOGLE_MODEL_ID = "gemini-2.5-flash";
export const DEFAULT_OPENAI_MODEL_ID = providerLocalModelId(FALLBACK_MODEL_ID, "openai/");
export const DEFAULT_OPENROUTER_MODEL_ID = "openrouter/auto";
export const DEFAULT_DEEPSEEK_MODEL_ID = providerLocalModelId(
  INCLUDED_DEEPSEEK_MODEL_ID,
  "deepseek/",
);

export type LlmProvider = "anthropic" | "google" | "openai" | "openrouter" | "deepseek";

/** Provider-local selection used only to construct the outbound SDK transport. */
export interface LlmTransportSelection {
  provider: LlmProvider;
  modelId: string;
}

function providerLocalModelId(logicalModelId: string, prefix: string): string {
  if (!logicalModelId.startsWith(prefix) || logicalModelId.length === prefix.length) {
    throw new Error(`Logical model id must start with ${prefix}`);
  }
  return logicalModelId.slice(prefix.length);
}
