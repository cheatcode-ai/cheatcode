import { z } from "zod";

/**
 * The single source of truth for the agent model catalog shown in the picker.
 *
 * Curated to the design's Models list (06b): Claude Sonnet 4.6, Claude Opus 4.8,
 * GPT-5.4 Thinking, GPT-5.4 Mini. Gemini 2.5 Flash and the standalone OpenRouter-Auto
 * row are intentionally NOT here — they stay reachable as free-string `body.model` ids
 * routed via OpenRouter, but are not drawn in the picker (decision #6).
 *
 * Catalog order doubles as the resolution priority (CATALOG_PRIORITY, S2): the production
 * default is first, Opus 4.8 second so it is preferred over the GPT-5.4 entries when the
 * default is disabled.
 */
export const AGENT_MODEL_CATALOG = [
  {
    id: "anthropic/claude-sonnet-4-6",
    label: "Claude Sonnet 4.6",
    provider: "anthropic",
    description: "Default code-building model for app and sandbox work.",
  },
  {
    id: "anthropic/claude-opus-4-8",
    label: "Claude Opus 4.8",
    provider: "anthropic",
    description: "Highest-capability Anthropic model for complex planning and analysis.",
  },
  {
    id: "openai/gpt-5.4-thinking",
    label: "GPT-5.4 Thinking",
    provider: "openai",
    description: "Reasoning-heavy model for planning, research, and analysis.",
  },
  {
    id: "openai/gpt-5.4-mini",
    label: "GPT-5.4 Mini",
    provider: "openai",
    description: "Fast fallback model for lower-cost utility runs.",
  },
] as const;

export type CatalogModelId = (typeof AGENT_MODEL_CATALOG)[number]["id"];

export const PRODUCTION_DEFAULT_MODEL_ID = "anthropic/claude-sonnet-4-6" satisfies CatalogModelId;
export const FALLBACK_MODEL_ID = "openai/gpt-5.4-mini" satisfies CatalogModelId;

const CATALOG_MODEL_IDS = AGENT_MODEL_CATALOG.map((entry) => entry.id) as [
  CatalogModelId,
  ...CatalogModelId[],
];

export const CatalogModelIdSchema = z.enum(CATALOG_MODEL_IDS);

export function isCatalogModelId(value: unknown): value is CatalogModelId {
  return typeof value === "string" && AGENT_MODEL_CATALOG.some((entry) => entry.id === value);
}
