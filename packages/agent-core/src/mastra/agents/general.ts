import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { APIError } from "@cheatcode/observability";
import { Agent } from "@mastra/core/agent";
import type { MastraModelConfig } from "@mastra/core/llm";
import type { RequestContext } from "@mastra/core/request-context";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import {
  ANTHROPIC_API_KEY_CONTEXT_KEY,
  DEFAULT_ANTHROPIC_MODEL_ID,
  DEFAULT_GOOGLE_MODEL_ID,
  DEFAULT_OPENAI_MODEL_ID,
  DEFAULT_OPENROUTER_MODEL_ID,
  GOOGLE_API_KEY_CONTEXT_KEY,
  LLM_MODEL_ID_CONTEXT_KEY,
  LLM_PROVIDER_CONTEXT_KEY,
  type LlmModelSelection,
  type LlmProvider,
  OPENAI_API_KEY_CONTEXT_KEY,
  OPENROUTER_API_KEY_CONTEXT_KEY,
} from "../llm-context";
import { buildSystemPrompt, promptRuntimeContextFromRequestContext } from "../system-prompt";
import { cheatcodeTools } from "../tools/tool-set";

export type { LlmModelSelection, LlmProvider } from "../llm-context";
export {
  ANTHROPIC_API_KEY_CONTEXT_KEY,
  DEFAULT_ANTHROPIC_MODEL_ID,
  DEFAULT_GOOGLE_MODEL_ID,
  DEFAULT_OPENAI_MODEL_ID,
  DEFAULT_OPENROUTER_MODEL_ID,
  GOOGLE_API_KEY_CONTEXT_KEY,
  LLM_MODEL_ID_CONTEXT_KEY,
  LLM_PROVIDER_CONTEXT_KEY,
  OPENAI_API_KEY_CONTEXT_KEY,
  OPENROUTER_API_KEY_CONTEXT_KEY,
} from "../llm-context";

export function createAnthropicByokModel(
  apiKey: string,
  modelId = DEFAULT_ANTHROPIC_MODEL_ID,
): MastraModelConfig {
  const trimmed = apiKey.trim();
  if (trimmed.length === 0) {
    throw new Error("Anthropic BYOK key is required.");
  }
  return createAnthropic({ apiKey: trimmed })(modelId);
}

export function createOpenAiByokModel(
  apiKey: string,
  modelId = DEFAULT_OPENAI_MODEL_ID,
): MastraModelConfig {
  const trimmed = apiKey.trim();
  if (trimmed.length === 0) {
    throw new Error("OpenAI BYOK key is required.");
  }
  return createOpenAI({ apiKey: trimmed }).responses(modelId);
}

export function createGoogleByokModel(
  apiKey: string,
  modelId = DEFAULT_GOOGLE_MODEL_ID,
): MastraModelConfig {
  const trimmed = apiKey.trim();
  if (trimmed.length === 0) {
    throw new Error("Google BYOK key is required.");
  }
  return createGoogleGenerativeAI({ apiKey: trimmed })(modelId);
}

export function createOpenRouterByokModel(
  apiKey: string,
  modelId = DEFAULT_OPENROUTER_MODEL_ID,
): MastraModelConfig {
  const trimmed = apiKey.trim();
  if (trimmed.length === 0) {
    throw new Error("OpenRouter BYOK key is required.");
  }
  return createOpenRouter({
    apiKey: trimmed,
    appName: "Cheatcode",
    appUrl: "https://trycheatcode.com",
    compatibility: "strict",
  }).chat(modelId);
}

export function resolveRequestedLlmModel(model: string | null | undefined): LlmModelSelection {
  const requested = model?.trim();
  if (!requested) {
    return { provider: "anthropic", modelId: DEFAULT_ANTHROPIC_MODEL_ID };
  }

  if (requested.startsWith("anthropic/")) {
    return requestedModel("anthropic", requested.slice("anthropic/".length));
  }
  if (requested.startsWith("openai/")) {
    return requestedModel("openai", requested.slice("openai/".length));
  }
  if (requested.startsWith("google/")) {
    return requestedModel("google", requested.slice("google/".length));
  }
  if (requested.startsWith("openrouter/")) {
    return requestedModel("openrouter", requested.slice("openrouter/".length));
  }
  if (requested.startsWith("claude-")) {
    return requestedModel("anthropic", requested);
  }
  if (requested.startsWith("gpt-") || requested.startsWith("o1") || requested.startsWith("o3")) {
    return requestedModel("openai", requested);
  }
  if (requested.startsWith("gemini-")) {
    return requestedModel("google", requested);
  }

  throw new Error(`Unsupported model selection: ${requested}`);
}

function requestedModel(provider: LlmProvider, modelId: string): LlmModelSelection {
  const trimmedModelId = modelId.trim();
  if (trimmedModelId.length === 0) {
    throw new Error(`Missing ${provider} model id.`);
  }
  return { provider, modelId: trimmedModelId };
}

function resolveGeneralModel({
  requestContext,
}: {
  requestContext: RequestContext;
}): MastraModelConfig {
  const provider = resolveLlmProvider(requestContext.get(LLM_PROVIDER_CONTEXT_KEY));
  const modelId = requestContext.get(LLM_MODEL_ID_CONTEXT_KEY);

  switch (provider) {
    case "openai":
      return createOpenAiByokModel(
        requiredProviderKey(requestContext, OPENAI_API_KEY_CONTEXT_KEY, "OpenAI", provider),
        requestedModelId(modelId, DEFAULT_OPENAI_MODEL_ID),
      );
    case "openrouter":
      return createOpenRouterByokModel(
        requiredProviderKey(requestContext, OPENROUTER_API_KEY_CONTEXT_KEY, "OpenRouter", provider),
        requestedModelId(modelId, DEFAULT_OPENROUTER_MODEL_ID),
      );
    case "google":
      return createGoogleByokModel(
        requiredProviderKey(requestContext, GOOGLE_API_KEY_CONTEXT_KEY, "Google Gemini", provider),
        requestedModelId(modelId, DEFAULT_GOOGLE_MODEL_ID),
      );
    case "anthropic":
      return createAnthropicByokModel(
        requiredProviderKey(requestContext, ANTHROPIC_API_KEY_CONTEXT_KEY, "Anthropic", provider),
        requestedModelId(modelId, DEFAULT_ANTHROPIC_MODEL_ID),
      );
  }
}

function resolveLlmProvider(value: unknown): LlmProvider {
  if (value === "google" || value === "openai" || value === "openrouter") {
    return value;
  }
  return "anthropic";
}

function requestedModelId(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function requiredProviderKey(
  requestContext: RequestContext,
  contextKey: string,
  label: string,
  provider: LlmProvider,
): string {
  const apiKey = requestContext.get(contextKey);
  if (typeof apiKey !== "string" || apiKey.trim().length === 0) {
    throw missingProviderKey(label, provider);
  }
  return apiKey;
}

function missingProviderKey(label: string, provider: LlmProvider): APIError {
  return new APIError(400, "byok_key_missing", `Add a ${label} BYOK key before starting a run.`, {
    details: { provider },
    hint: `Open BYOK Settings and save a ${label} API key.`,
    retriable: false,
  });
}

export const generalAgent = new Agent({
  id: "general",
  name: "general",
  instructions: ({ requestContext }: { requestContext?: RequestContext }) =>
    buildSystemPrompt(promptRuntimeContextFromRequestContext(requestContext)),
  model: resolveGeneralModel,
  tools: cheatcodeTools,
});
