import {
  AGENT_MODEL_CATALOG,
  FALLBACK_MODEL_ID,
  INCLUDED_DEEPSEEK_MODEL_ID,
  type Provider,
  type ProviderKeySummary,
} from "@cheatcode/types";

export type CatalogModel = (typeof AGENT_MODEL_CATALOG)[number];
export type ModelAccessState = "active" | "disabled" | "error" | "included" | "loading" | "missing";
export interface ModelSourceChoice {
  id: string;
  label: string;
  active?: boolean;
  provider?: Provider;
  unavailableMessage?: string;
}

export const SETTINGS_KEY_PROVIDERS = [
  "openai",
  "anthropic",
  "google",
  "openrouter",
  "deepseek",
  "exa",
  "firecrawl",
  "llamaparse",
] as const satisfies readonly Provider[];

export const MODEL_KEY_PROVIDERS = new Set<Provider>([
  "anthropic",
  "deepseek",
  "google",
  "openai",
  "openrouter",
]);

export const CATALOG_PROVIDER_LABELS = {
  anthropic: "Anthropic",
  deepseek: "DeepSeek",
  openai: "OpenAI",
} satisfies Record<CatalogModel["provider"], string>;

const PROVIDER_LABELS = {
  anthropic: "Anthropic",
  deepseek: "DeepSeek",
  exa: "Exa",
  firecrawl: "Firecrawl",
  google: "Gemini",
  llamaparse: "LlamaParse",
  openai: "OpenAI",
  openrouter: "OpenRouter",
} satisfies Record<Provider, string>;

export const ORDERED_MODELS: readonly CatalogModel[] = [
  ...AGENT_MODEL_CATALOG.filter((model) => model.id !== INCLUDED_DEEPSEEK_MODEL_ID),
  ...AGENT_MODEL_CATALOG.filter((model) => model.id === INCLUDED_DEEPSEEK_MODEL_ID),
];

export function modelAccessState(
  model: CatalogModel,
  summaries: ProviderKeySummary[],
  isLoading: boolean,
  isError: boolean,
): ModelAccessState {
  if (model.id === INCLUDED_DEEPSEEK_MODEL_ID) {
    return "included";
  }
  if (isLoading) {
    return "loading";
  }
  if (isError) {
    return "error";
  }
  const summary = summaries.find((item) => item.provider === model.provider);
  if (!summary) {
    return "missing";
  }
  return summary.disabledAt === null ? "active" : "disabled";
}

export function isModelUsable(accessState: ModelAccessState): boolean {
  return accessState === "active" || accessState === "included";
}

export function modelSourceLabel(model: CatalogModel, accessState: ModelAccessState): string {
  if (accessState === "included") {
    return "Included by Cheatcode";
  }
  if (accessState === "loading") {
    return "checking key status";
  }
  if (accessState === "error") {
    return "key status unavailable";
  }
  const providerLabel = CATALOG_PROVIDER_LABELS[model.provider];
  if (accessState === "missing") {
    return `Add ${providerLabel} API key`;
  }
  if (accessState === "disabled") {
    return `${providerLabel} API key disabled`;
  }
  return model.id === FALLBACK_MODEL_ID
    ? `fallback via ${providerLabel} API key`
    : `via ${providerLabel} API key`;
}

export function modelSourceChoices(
  model: CatalogModel,
  accessState: ModelAccessState,
  summaries: ProviderKeySummary[],
): ModelSourceChoice[] {
  const providers = modelSourceProviders(model);
  const choices: ModelSourceChoice[] = [];
  if (accessState === "included") {
    choices.push({ active: true, id: "included", label: "Included by Cheatcode" });
  }
  choices.push(
    ...providers.map((provider) => ({
      active: provider === model.provider && accessState === "active",
      id: provider,
      label: `${PROVIDER_LABELS[provider]} API key`,
      provider,
    })),
  );
  return choices.map((choice) => withSummaryStatus(choice, summaries));
}

function modelSourceProviders(model: CatalogModel): Provider[] {
  if (model.provider === "anthropic") {
    return ["anthropic", "openrouter"];
  }
  if (model.provider === "openai") {
    return ["openai", "openrouter"];
  }
  return model.provider === "deepseek" ? ["deepseek"] : [];
}

function withSummaryStatus(
  choice: ModelSourceChoice,
  summaries: ProviderKeySummary[],
): ModelSourceChoice {
  if (!choice.provider) {
    return choice;
  }
  const summary = summaries.find((item) => item.provider === choice.provider);
  return { ...choice, active: choice.active || summary?.disabledAt === null };
}

export function shortModelLabel(label: string): string {
  return label.replace("Claude ", "").replace("GPT-", "GPT-");
}
