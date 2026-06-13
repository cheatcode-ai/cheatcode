import { z } from "zod";

interface ModelPricing {
  inputUsdPerToken: number;
  outputUsdPerToken: number;
}

interface TokenUsageCostInput {
  modelId: string;
  tokensIn: number;
  tokensOut: number;
}

// Public, keyless OpenRouter catalog — every routable model with authoritative per-token USD pricing.
// We never hard-code prices: the gateway-reported cost is preferred upstream (see usageFromMastraChunk),
// and this map is the fallback estimator used only when a usage event arrives without a cost.
const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const PRICING_MEMO_TTL_MS = 6 * 60 * 60 * 1_000;
const PRICING_FETCH_TIMEOUT_MS = 5_000;
const EDGE_CACHE_TTL_SECONDS = 86_400;

const OpenRouterModelsResponseSchema = z.object({
  data: z.array(
    z
      .object({
        id: z.string().min(1),
        pricing: z
          .object({
            completion: z.string().optional(),
            prompt: z.string().optional(),
          })
          .passthrough(),
      })
      .passthrough(),
  ),
});

let pricingMemo: { atMs: number; map: Map<string, ModelPricing> } | null = null;

export async function estimateTokenUsageUsd(input: TokenUsageCostInput): Promise<number> {
  const map = await loadModelPricing();
  const pricing = map.get(input.modelId) ?? map.get(normalizeModelId(input.modelId));
  if (!pricing) {
    return 0;
  }
  const cost =
    input.tokensIn * pricing.inputUsdPerToken + input.tokensOut * pricing.outputUsdPerToken;
  return Math.round(cost * 1_000_000) / 1_000_000;
}

async function loadModelPricing(): Promise<Map<string, ModelPricing>> {
  if (pricingMemo && Date.now() - pricingMemo.atMs < PRICING_MEMO_TTL_MS) {
    return pricingMemo.map;
  }
  const fetched = await fetchModelPricing();
  if (fetched) {
    pricingMemo = { atMs: Date.now(), map: fetched };
    return fetched;
  }
  // On a fetch/parse failure keep serving the last good map (or empty → estimate 0, same as an unknown model).
  return pricingMemo?.map ?? new Map();
}

async function fetchModelPricing(): Promise<Map<string, ModelPricing> | null> {
  try {
    const response = await fetch(OPENROUTER_MODELS_URL, {
      cf: { cacheEverything: true, cacheTtl: EDGE_CACHE_TTL_SECONDS },
      signal: AbortSignal.timeout(PRICING_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      return null;
    }
    const parsed = OpenRouterModelsResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      return null;
    }
    return buildPricingMap(parsed.data.data);
  } catch {
    return null;
  }
}

function buildPricingMap(
  models: z.infer<typeof OpenRouterModelsResponseSchema>["data"],
): Map<string, ModelPricing> {
  const map = new Map<string, ModelPricing>();
  for (const model of models) {
    const inputUsdPerToken = parsePrice(model.pricing.prompt);
    const outputUsdPerToken = parsePrice(model.pricing.completion);
    if (inputUsdPerToken === null || outputUsdPerToken === null) {
      continue;
    }
    map.set(model.id, { inputUsdPerToken, outputUsdPerToken });
  }
  return map;
}

function parsePrice(value: string | undefined): number | null {
  if (value === undefined) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function normalizeModelId(modelId: string): string {
  const trimmed = modelId.trim();
  if (trimmed.includes("/")) {
    return trimmed.split("/").at(-1) ?? trimmed;
  }
  return trimmed;
}
