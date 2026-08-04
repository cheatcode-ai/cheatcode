import { z } from "zod";

/** Open provider-prefixed product model ID; the provider-local suffix is intentionally free-form. */
export const LogicalModelIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(
    /^(?:anthropic|deepseek|openai|openrouter)\/\S+$/,
    "Use a supported provider-prefixed model id without whitespace.",
  )
  .brand<"LogicalModelId">();

export type LogicalModelId = z.infer<typeof LogicalModelIdSchema>;

function logicalModelId<const Value extends string>(value: Value): Value & LogicalModelId {
  return LogicalModelIdSchema.parse(value) as Value & LogicalModelId;
}

const RAW_CATALOG_MODEL_IDS = {
  claudeOpus: "anthropic/claude-opus-5",
  claudeSonnet: "anthropic/claude-sonnet-5",
  deepseekPro: "deepseek/deepseek-v4-pro",
  gptSol: "openai/gpt-5.6-sol",
  gptTerra: "openai/gpt-5.6-terra",
} as const;

const RAW_CATALOG_MODEL_ID_VALUES = [
  RAW_CATALOG_MODEL_IDS.claudeSonnet,
  RAW_CATALOG_MODEL_IDS.claudeOpus,
  RAW_CATALOG_MODEL_IDS.gptSol,
  RAW_CATALOG_MODEL_IDS.gptTerra,
  RAW_CATALOG_MODEL_IDS.deepseekPro,
] as const;

/**
 * The single source of truth for the agent model catalog shown in the picker.
 *
 * Curated to the live Models list: Claude Sonnet 5, Claude Opus 5,
 * GPT-5.6 Sol, GPT-5.6 Terra, and the included DeepSeek V4 Pro model. The standalone
 * OpenRouter-Auto row stays reachable as a provider-prefixed request id but is not
 * drawn in the picker. Google AI keys are tool-only and never select the chat model.
 *
 * Catalog order doubles as the resolution priority: the production default is first,
 * and Opus 5 is preferred over the GPT-5.6 entries when that default is disabled.
 */
export const AGENT_MODEL_CATALOG = [
  {
    id: logicalModelId(RAW_CATALOG_MODEL_IDS.claudeSonnet),
    label: "Claude Sonnet 5",
    provider: "anthropic",
    description: "Default code-building model for app and sandbox work.",
  },
  {
    id: logicalModelId(RAW_CATALOG_MODEL_IDS.claudeOpus),
    label: "Claude Opus 5",
    provider: "anthropic",
    description: "Highest-capability Anthropic model for complex planning and analysis.",
  },
  {
    id: logicalModelId(RAW_CATALOG_MODEL_IDS.gptSol),
    label: "GPT-5.6 Sol",
    provider: "openai",
    description: "Highest-capability OpenAI model for agentic work and complex reasoning.",
  },
  {
    id: logicalModelId(RAW_CATALOG_MODEL_IDS.gptTerra),
    label: "GPT-5.6 Terra",
    provider: "openai",
    description: "Balanced OpenAI fallback for fast, efficient utility runs.",
  },
  {
    id: logicalModelId(RAW_CATALOG_MODEL_IDS.deepseekPro),
    label: "DeepSeek V4 Pro",
    provider: "deepseek",
    description: "Included by Cheatcode with no provider key required.",
  },
] as const;

export type CatalogModelId = (typeof AGENT_MODEL_CATALOG)[number]["id"];

export const PRODUCTION_DEFAULT_MODEL_ID = logicalModelId(
  RAW_CATALOG_MODEL_IDS.claudeSonnet,
) satisfies CatalogModelId;
export const FALLBACK_MODEL_ID = logicalModelId(
  RAW_CATALOG_MODEL_IDS.gptTerra,
) satisfies CatalogModelId;

/**
 * The platform-provided DeepSeek model. It is the zero-config option for users
 * without a provider key and the only model served by Cheatcode's DeepSeek key.
 */
export const INCLUDED_DEEPSEEK_MODEL_ID = logicalModelId(
  RAW_CATALOG_MODEL_IDS.deepseekPro,
) satisfies CatalogModelId;

/** Validate against raw literals first; Zod enums cannot retain branded string tuples. */
export const CatalogModelIdSchema = z
  .enum(RAW_CATALOG_MODEL_ID_VALUES)
  .transform((value): CatalogModelId => logicalModelId(value) as CatalogModelId);
