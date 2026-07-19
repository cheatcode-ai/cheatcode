import { APIError, readBoundedResponseJson } from "@cheatcode/observability";
import type { Provider } from "@cheatcode/types";
import { z } from "zod";

const VALIDATION_TIMEOUT_MS = 10_000;
const VALIDATION_RESPONSE_MAX_BYTES = 512 * 1024;
const providerModelSchema = z.object({ id: z.string().min(1).max(500) }).strip();
const providerModelListSchema = z.array(providerModelSchema).max(1_000);

const PROVIDER_VALIDATORS = {
  anthropic: {
    invalidStatuses: [401, 403],
    label: "Anthropic",
    method: "GET",
    schema: z.object({ data: providerModelListSchema }).strip(),
    url: "https://api.anthropic.com/v1/models?limit=1",
    headers: (key: string) => ({
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
      "x-api-key": key,
    }),
  },
  deepseek: {
    invalidStatuses: [401, 403],
    label: "DeepSeek",
    method: "GET",
    schema: z.object({ data: providerModelListSchema }).strip(),
    url: "https://api.deepseek.com/models",
    headers: (key: string) => ({
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    }),
  },
  exa: {
    body: () =>
      JSON.stringify({
        contents: { highlights: false },
        numResults: 1,
        query: "Cheatcode BYOK validation",
        type: "instant",
      }),
    invalidStatuses: [401, 403],
    label: "Exa",
    method: "POST",
    schema: z.object({ results: z.array(z.unknown()).max(10).optional() }).strip(),
    url: "https://api.exa.ai/search",
    headers: (key: string) => ({ "content-type": "application/json", "x-api-key": key }),
  },
  firecrawl: {
    invalidStatuses: [401, 403],
    label: "Firecrawl",
    method: "GET",
    schema: z.object({ data: z.object({}).strip(), success: z.literal(true) }).strip(),
    url: "https://api.firecrawl.dev/v2/team/credit-usage",
    headers: (key: string) => ({ authorization: `Bearer ${key}` }),
  },
  google: {
    invalidStatuses: [400, 401, 403],
    label: "Google Gemini",
    method: "GET",
    schema: z
      .object({
        models: z.array(z.object({ name: z.string().min(1).max(500) }).strip()).max(1_000),
      })
      .strip(),
    url: "https://generativelanguage.googleapis.com/v1beta/models",
    headers: (key: string) => ({ "x-goog-api-key": key }),
  },
  openai: {
    invalidStatuses: [401, 403],
    label: "OpenAI",
    method: "GET",
    schema: z.object({ data: providerModelListSchema }).strip(),
    url: "https://api.openai.com/v1/models",
    headers: (key: string) => ({
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    }),
  },
  openrouter: {
    invalidStatuses: [401, 403],
    label: "OpenRouter",
    method: "GET",
    schema: z.object({ data: z.object({}).strip() }).strip(),
    url: "https://openrouter.ai/api/v1/key",
    headers: (key: string) => ({ authorization: `Bearer ${key}` }),
  },
} as const satisfies Record<Provider, ProviderValidationSpec>;

interface ProviderValidationSpec {
  body?: () => string;
  headers: (key: string) => Record<string, string>;
  invalidStatuses: readonly number[];
  label: string;
  method: "GET" | "POST";
  schema: z.ZodType<unknown>;
  url: string;
}

export async function validateProviderKey(provider: Provider, key: string): Promise<void> {
  const spec = PROVIDER_VALIDATORS[provider];
  const body = "body" in spec ? spec.body() : undefined;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), VALIDATION_TIMEOUT_MS);
  try {
    const response = await fetch(spec.url, {
      headers: spec.headers(key),
      method: spec.method,
      signal: controller.signal,
      ...(body === undefined ? {} : { body }),
    });
    await assertValidationResponse(spec, response);
  } catch (error) {
    if (error instanceof APIError) {
      throw error;
    }
    if (error instanceof Error && error.name === "AbortError") {
      throw new APIError(504, "upstream_timeout_llm", `Timed out validating ${spec.label} key.`, {
        hint: `Retry after ${spec.label} API health recovers.`,
        retriable: true,
      });
    }
    throw new APIError(
      503,
      "upstream_provider_outage",
      `Unable to reach ${spec.label} validation.`,
      {
        hint: `Retry after ${spec.label} API health recovers.`,
        retriable: true,
      },
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

async function assertValidationResponse(
  spec: ProviderValidationSpec,
  response: Response,
): Promise<void> {
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
  }
  if (spec.invalidStatuses.includes(response.status)) {
    throw new APIError(400, "byok_key_invalid", `${spec.label} rejected this API key.`, {
      hint: `Create a fresh ${spec.label} API key and try again.`,
      retriable: false,
    });
  }
  if (response.status === 402 || response.status === 429) {
    throw new APIError(
      429,
      "byok_key_quota_exhausted",
      `${spec.label} quota blocked key validation.`,
      {
        hint: `Retry after the ${spec.label} quota or rate limit resets, then save the key again.`,
        retriable: true,
      },
    );
  }
  if (!response.ok) {
    throw new APIError(503, "upstream_provider_outage", `Unable to validate ${spec.label} key.`, {
      details: { status: response.status },
      hint: `Retry after ${spec.label} API health recovers.`,
      retriable: true,
    });
  }
  const parsed = spec.schema.safeParse(
    await readBoundedResponseJson(response, VALIDATION_RESPONSE_MAX_BYTES, spec.label),
  );
  if (!parsed.success) {
    throw new APIError(
      503,
      "upstream_provider_outage",
      `${spec.label} key validation returned an unexpected response.`,
      {
        hint: `Retry after ${spec.label} API health recovers.`,
        retriable: true,
      },
    );
  }
}
