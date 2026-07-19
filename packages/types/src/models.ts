import { z } from "zod";

/** Open provider-prefixed product model ID; the provider-local suffix is intentionally free-form. */
export const LogicalModelIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(
    /^(?:anthropic|deepseek|google|openai|openrouter)\/\S+$/,
    "Use a supported provider-prefixed model id without whitespace.",
  )
  .brand<"LogicalModelId">();

export type LogicalModelId = z.infer<typeof LogicalModelIdSchema>;

function logicalModelId<const Value extends string>(value: Value): Value & LogicalModelId {
  return LogicalModelIdSchema.parse(value) as Value & LogicalModelId;
}

const RAW_CATALOG_MODEL_IDS = {
  claudeOpus: "anthropic/claude-opus-4-8",
  claudeSonnet: "anthropic/claude-sonnet-4-6",
  deepseekFlash: "deepseek/deepseek-v4-flash",
  gptMini: "openai/gpt-5.4-mini",
  gptThinking: "openai/gpt-5.4-thinking",
} as const;

const RAW_CATALOG_MODEL_ID_VALUES = [
  RAW_CATALOG_MODEL_IDS.claudeSonnet,
  RAW_CATALOG_MODEL_IDS.claudeOpus,
  RAW_CATALOG_MODEL_IDS.gptThinking,
  RAW_CATALOG_MODEL_IDS.gptMini,
  RAW_CATALOG_MODEL_IDS.deepseekFlash,
] as const;

/**
 * The single source of truth for the agent model catalog shown in the picker.
 *
 * Curated to the live Models list: Claude Sonnet 4.6, Claude Opus 4.8,
 * GPT-5.4 Thinking, GPT-5.4 Mini, and the included DeepSeek V4 model. Gemini 2.5
 * Flash and the standalone OpenRouter-Auto row stay reachable as provider-prefixed
 * request ids routed through OpenRouter, but are not drawn in the picker.
 *
 * Catalog order doubles as the resolution priority: the production default is first,
 * and Opus 4.8 is preferred over the GPT-5.4 entries when that default is disabled.
 */
export const AGENT_MODEL_CATALOG = [
  {
    id: logicalModelId(RAW_CATALOG_MODEL_IDS.claudeSonnet),
    label: "Claude Sonnet 4.6",
    provider: "anthropic",
    description: "Default code-building model for app and sandbox work.",
  },
  {
    id: logicalModelId(RAW_CATALOG_MODEL_IDS.claudeOpus),
    label: "Claude Opus 4.8",
    provider: "anthropic",
    description: "Highest-capability Anthropic model for complex planning and analysis.",
  },
  {
    id: logicalModelId(RAW_CATALOG_MODEL_IDS.gptThinking),
    label: "GPT-5.4 Thinking",
    provider: "openai",
    description: "Reasoning-heavy model for planning, research, and analysis.",
  },
  {
    id: logicalModelId(RAW_CATALOG_MODEL_IDS.gptMini),
    label: "GPT-5.4 Mini",
    provider: "openai",
    description: "Fast fallback model for lower-cost utility runs.",
  },
  {
    id: logicalModelId(RAW_CATALOG_MODEL_IDS.deepseekFlash),
    label: "DeepSeek V4",
    provider: "deepseek",
    description: "Included by Cheatcode with no provider key required.",
  },
] as const;

export type CatalogModelId = (typeof AGENT_MODEL_CATALOG)[number]["id"];

export const PRODUCTION_DEFAULT_MODEL_ID = logicalModelId(
  RAW_CATALOG_MODEL_IDS.claudeSonnet,
) satisfies CatalogModelId;
export const FALLBACK_MODEL_ID = logicalModelId(
  RAW_CATALOG_MODEL_IDS.gptMini,
) satisfies CatalogModelId;

/**
 * The platform-provided DeepSeek model. It is the zero-config option for users
 * without a provider key and the only model served by Cheatcode's DeepSeek key.
 */
export const INCLUDED_DEEPSEEK_MODEL_ID = logicalModelId(
  RAW_CATALOG_MODEL_IDS.deepseekFlash,
) satisfies CatalogModelId;

/** Validate against raw literals first; Zod enums cannot retain branded string tuples. */
export const CatalogModelIdSchema = z
  .enum(RAW_CATALOG_MODEL_ID_VALUES)
  .transform((value): CatalogModelId => logicalModelId(value) as CatalogModelId);
