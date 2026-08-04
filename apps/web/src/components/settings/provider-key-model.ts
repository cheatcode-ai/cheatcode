import { type Provider, ProviderSchema } from "@cheatcode/types/api";
import { z } from "zod";

export const DEFAULT_PROVIDER: Provider = "anthropic";
export const ProviderKeyFormSchema = z.strictObject({
  key: z.string().trim().min(8, "Enter a provider key").max(4096),
  provider: ProviderSchema,
});
export type ProviderKeyFormValues = z.infer<typeof ProviderKeyFormSchema>;
export type ProviderKeyEditorStatus = "deleting" | "idle" | "saving";
export type SecretVisibility = "hidden" | "visible";

export const PROVIDER_META: Record<Provider, { description: string; label: string }> = {
  anthropic: { description: "Agent models and browser automation.", label: "Anthropic" },
  deepseek: { description: "Optional personal key for DeepSeek models.", label: "DeepSeek" },
  exa: { description: "Web research and source discovery.", label: "Exa" },
  firecrawl: { description: "Web search, scraping, and extraction.", label: "Firecrawl" },
  google: {
    description: "Tools only: images, Veo video, and browser automation.",
    label: "Google AI",
  },
  openai: { description: "Agent models and browser automation.", label: "OpenAI" },
  openrouter: {
    description: "Alternative routing for supported agent models.",
    label: "OpenRouter",
  },
};

export function providerPanelId(provider: Provider): string {
  return `provider-key-panel-${provider}`;
}

export function providerTabId(provider: Provider): string {
  return `provider-key-tab-${provider}`;
}
