export const ANTHROPIC_API_KEY_CONTEXT_KEY = "anthropicApiKey";
export const GOOGLE_API_KEY_CONTEXT_KEY = "googleApiKey";
export const OPENAI_API_KEY_CONTEXT_KEY = "openaiApiKey";
export const OPENROUTER_API_KEY_CONTEXT_KEY = "openrouterApiKey";
export const DEEPSEEK_API_KEY_CONTEXT_KEY = "deepseekApiKey";
export const LLM_MODEL_ID_CONTEXT_KEY = "llmModelId";
export const LLM_PROVIDER_CONTEXT_KEY = "llmProvider";
export const DEFAULT_ANTHROPIC_MODEL_ID = "claude-sonnet-4-6";
export const DEFAULT_GOOGLE_MODEL_ID = "gemini-2.5-flash";
export const DEFAULT_OPENAI_MODEL_ID = "gpt-5.4-mini";
export const DEFAULT_OPENROUTER_MODEL_ID = "openrouter/auto";
export const DEFAULT_DEEPSEEK_MODEL_ID = "deepseek-v4-flash";

export type LlmProvider = "anthropic" | "google" | "openai" | "openrouter" | "deepseek";

export interface LlmModelSelection {
  provider: LlmProvider;
  modelId: string;
}
