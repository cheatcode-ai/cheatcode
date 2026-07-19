import { type Provider, ProviderSchema } from "@cheatcode/types";
import { z } from "zod";

export const DEFAULT_PROVIDER: Provider = "anthropic";
export const ProviderKeyFormSchema = z.strictObject({
  key: z.string().trim().min(8, "Enter a provider key").max(4096),
  provider: ProviderSchema,
});
export type ProviderKeyFormValues = z.infer<typeof ProviderKeyFormSchema>;
export type ProviderKeyEditorStatus = "deleting" | "idle" | "saving";
export type SecretVisibility = "hidden" | "visible";

export const PROVIDER_META: Record<Provider, { label: string }> = {
  anthropic: { label: "Anthropic" },
  deepseek: { label: "DeepSeek" },
  exa: { label: "Exa" },
  firecrawl: { label: "Firecrawl" },
  google: { label: "Gemini" },
  openai: { label: "OpenAI" },
  openrouter: { label: "OpenRouter" },
};

export function providerPanelId(provider: Provider): string {
  return `provider-key-panel-${provider}`;
}

export function providerTabId(provider: Provider): string {
  return `provider-key-tab-${provider}`;
}
