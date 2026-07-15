import { APIError, readBoundedResponseJson } from "@cheatcode/observability";

interface ResearchJsonRequest {
  apiKey: string;
  body?: unknown;
  maxResponseBytes: number;
  method?: "GET" | "POST";
  provider: "Exa" | "Firecrawl";
  timeoutMs: number;
  url: string;
}

const RESEARCH_REQUEST_MAX_BYTES = 256 * 1024;

export async function requestResearchJson(input: ResearchJsonRequest): Promise<unknown> {
  try {
    const body = input.body === undefined ? undefined : boundedResearchBody(input.body);
    const response = await fetch(input.url, {
      headers: providerHeaders(input.provider, input.apiKey),
      method: input.method ?? "POST",
      signal: AbortSignal.timeout(input.timeoutMs),
      ...(body === undefined ? {} : { body }),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw providerStatusError(input.provider, response.status);
    }
    return await readBoundedResponseJson(response, input.maxResponseBytes, `${input.provider} API`);
  } catch (error) {
    if (error instanceof APIError) {
      throw error;
    }
    if (isTimeoutError(error)) {
      throw new APIError(504, "tool_timeout", `${input.provider} request timed out`, {
        hint: "Retry with a narrower research request.",
        retriable: true,
      });
    }
    throw new APIError(503, "upstream_provider_outage", `${input.provider} request failed`, {
      hint: `Retry after ${input.provider} API health recovers.`,
      retriable: true,
    });
  }
}

function boundedResearchBody(value: unknown): string {
  let body: string;
  try {
    body = JSON.stringify(value);
  } catch {
    throw new APIError(400, "tool_validation_failed", "Research request is not serializable", {
      retriable: false,
    });
  }
  if (new TextEncoder().encode(body).byteLength > RESEARCH_REQUEST_MAX_BYTES) {
    throw new APIError(400, "tool_validation_failed", "Research request is too large", {
      hint: "Retry with fewer URLs or a smaller extraction schema.",
      retriable: false,
    });
  }
  return body;
}

function providerHeaders(provider: ResearchJsonRequest["provider"], apiKey: string): Headers {
  const headers = new Headers({ "content-type": "application/json" });
  if (provider === "Exa") {
    headers.set("x-api-key", apiKey);
  } else {
    headers.set("authorization", `Bearer ${apiKey}`);
  }
  return headers;
}

function providerStatusError(provider: ResearchJsonRequest["provider"], status: number): APIError {
  if (status === 401 || status === 403) {
    return new APIError(400, "byok_key_invalid", `${provider} rejected this API key`, {
      hint: `Replace the ${provider} key in Models settings.`,
      retriable: false,
    });
  }
  if (status === 402 || status === 429) {
    return new APIError(429, "rate_limit_exceeded", `${provider} quota blocked this request`, {
      hint: `Retry after the ${provider} quota or rate limit resets.`,
      retriable: true,
    });
  }
  return new APIError(502, "upstream_provider_outage", `${provider} request was rejected`, {
    details: { status },
    hint: `Retry after ${provider} API health recovers.`,
    retriable: status >= 500,
  });
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}
