import { APIError } from "@cheatcode/observability";
import { z } from "zod/v4";
import { requestResearchJson } from "./provider-http";
import type { ResearchRuntimeContext } from "./runtime";
import { requireResearchProviderKey } from "./runtime";
import {
  type FirecrawlExtractInput,
  FirecrawlExtractInputSchema,
  type FirecrawlExtractOutput,
  FirecrawlExtractOutputSchema,
  type FirecrawlScrapeInput,
  FirecrawlScrapeInputSchema,
  type FirecrawlScrapeOutput,
  FirecrawlScrapeOutputSchema,
  type FirecrawlSearchInput,
  FirecrawlSearchInputSchema,
  type FirecrawlSearchOutput,
  FirecrawlSearchOutputSchema,
} from "./schemas";

const FIRECRAWL_API_URL = "https://api.firecrawl.dev/v1";
const FIRECRAWL_DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
const FIRECRAWL_REQUEST_OVERHEAD_MS = 5_000;
const FIRECRAWL_RESPONSE_MAX_BYTES = 2 * 1024 * 1024;
const FIRECRAWL_EXTRACT_DATA_MAX_BYTES = 256 * 1024;
const FIRECRAWL_OUTPUT_CONTENT_MAX_CHARACTERS = 160_000;
const FIRECRAWL_EXTRACT_MAX_POLL_ATTEMPTS = 120;
const FIRECRAWL_EXTRACT_POLL_INTERVAL_MS = 1_000;

type FirecrawlScrapeFormat =
  | "markdown"
  | "html"
  | "rawHtml"
  | "links"
  | "screenshot"
  | "screenshot@fullPage";

interface FirecrawlScrapeParams {
  formats: FirecrawlScrapeFormat[];
  mobile?: boolean;
  onlyMainContent?: boolean;
  proxy?: "basic" | "stealth" | "auto";
  removeBase64Images?: boolean;
  timeout?: number;
  waitFor?: number;
}

interface FirecrawlSearchParams {
  country?: string;
  filter?: string;
  lang?: string;
  limit?: number;
  location?: string;
  scrapeOptions?: FirecrawlScrapeParams;
  tbs?: string;
  timeout: number;
}

interface FirecrawlExtractParams {
  allowExternalLinks?: boolean;
  enableWebSearch?: boolean;
  includeSubdomains?: boolean;
  prompt: string;
  schema?: Record<string, unknown>;
  showSources?: boolean;
  systemPrompt?: string;
  timeoutMs: number;
}

interface FirecrawlClientLike {
  extract(urls: string[], params: FirecrawlExtractParams): Promise<unknown>;
  scrapeUrl(url: string, params: FirecrawlScrapeParams): Promise<unknown>;
  search(query: string, params: FirecrawlSearchParams): Promise<unknown>;
}

interface CharacterLimiter {
  remaining: number;
  wasTruncated: boolean;
}

export async function executeFirecrawlScrape(
  input: unknown,
  runtimeContext: ResearchRuntimeContext,
  client: FirecrawlClientLike = createFirecrawlClient(runtimeContext),
): Promise<FirecrawlScrapeOutput> {
  const parsedInput = FirecrawlScrapeInputSchema.parse(input);
  const response = parseFirecrawlPayload(
    FirecrawlScrapeResponseSchema,
    await client.scrapeUrl(parsedInput.url, firecrawlScrapeParams(parsedInput)),
  );
  assertFirecrawlSuccess(response);
  const limiter = createCharacterLimiter();
  const document = normalizeDocument(response, parsedInput.url, limiter, 120_000);

  return FirecrawlScrapeOutputSchema.parse({
    ...document,
    url: document.url ?? parsedInput.url,
    warning: combinedWarning(response.warning, limiter),
  });
}

export async function executeFirecrawlSearch(
  input: unknown,
  runtimeContext: ResearchRuntimeContext,
  client: FirecrawlClientLike = createFirecrawlClient(runtimeContext),
): Promise<FirecrawlSearchOutput> {
  const parsedInput = FirecrawlSearchInputSchema.parse(input);
  const response = parseFirecrawlPayload(
    FirecrawlSearchResponseSchema,
    await client.search(parsedInput.query, firecrawlSearchParams(parsedInput)),
  );
  assertFirecrawlSuccess(response);
  const limiter = createCharacterLimiter();

  return FirecrawlSearchOutputSchema.parse({
    results: response.data.map((document) =>
      normalizeDocument(document, undefined, limiter, 80_000),
    ),
    warning: combinedWarning(response.warning, limiter),
  });
}

export async function executeFirecrawlExtract(
  input: unknown,
  runtimeContext: ResearchRuntimeContext,
  client: FirecrawlClientLike = createFirecrawlClient(runtimeContext),
): Promise<FirecrawlExtractOutput> {
  const parsedInput = FirecrawlExtractInputSchema.parse(input);
  const response = parseFirecrawlPayload(
    FirecrawlExtractResponseSchema,
    await client.extract(parsedInput.urls, firecrawlExtractParams(parsedInput)),
  );
  assertFirecrawlSuccess(response);
  assertExtractDataSize(response.data);

  return FirecrawlExtractOutputSchema.parse({
    data: response.data,
    sources: normalizeUrls(response.sources, 50),
    warning: response.warning?.slice(0, 2_000),
  });
}

function createFirecrawlClient(runtimeContext: ResearchRuntimeContext): FirecrawlClientLike {
  const apiKey = requireResearchProviderKey(runtimeContext, "firecrawl");
  return {
    extract: (urls, params) => executeFirecrawlExtractRequest(apiKey, urls, params),
    scrapeUrl: (url, params) => executeFirecrawlScrapeRequest(apiKey, url, params),
    search: (query, params) => executeFirecrawlSearchRequest(apiKey, query, params),
  };
}

async function executeFirecrawlScrapeRequest(
  apiKey: string,
  url: string,
  params: FirecrawlScrapeParams,
): Promise<unknown> {
  const value = await requestResearchJson({
    apiKey,
    body: { url, ...params },
    maxResponseBytes: FIRECRAWL_RESPONSE_MAX_BYTES,
    provider: "Firecrawl",
    timeoutMs:
      (params.timeout ?? FIRECRAWL_DEFAULT_REQUEST_TIMEOUT_MS) + FIRECRAWL_REQUEST_OVERHEAD_MS,
    url: `${FIRECRAWL_API_URL}/scrape`,
  });
  const response = parseFirecrawlPayload(FirecrawlScrapeApiResponseSchema, value);
  return response.data
    ? {
        ...response.data,
        error: response.error,
        success: response.success,
        warning: response.warning,
      }
    : response;
}

async function executeFirecrawlSearchRequest(
  apiKey: string,
  query: string,
  params: FirecrawlSearchParams,
): Promise<unknown> {
  return requestResearchJson({
    apiKey,
    body: { query, ...params },
    maxResponseBytes: FIRECRAWL_RESPONSE_MAX_BYTES,
    provider: "Firecrawl",
    timeoutMs: params.timeout + FIRECRAWL_REQUEST_OVERHEAD_MS,
    url: `${FIRECRAWL_API_URL}/search`,
  });
}

async function executeFirecrawlExtractRequest(
  apiKey: string,
  urls: string[],
  params: FirecrawlExtractParams,
): Promise<unknown> {
  const { timeoutMs, ...providerParams } = params;
  const deadline = Date.now() + timeoutMs;
  const started = parseFirecrawlPayload(
    FirecrawlExtractStartResponseSchema,
    await requestResearchJson({
      apiKey,
      body: { urls, ...providerParams },
      maxResponseBytes: FIRECRAWL_RESPONSE_MAX_BYTES,
      provider: "Firecrawl",
      timeoutMs: Math.min(30_000, timeoutMs),
      url: `${FIRECRAWL_API_URL}/extract`,
    }),
  );
  assertFirecrawlSuccess(started);
  return pollFirecrawlExtract(apiKey, started.id, deadline);
}

async function pollFirecrawlExtract(
  apiKey: string,
  jobId: string,
  deadline: number,
): Promise<unknown> {
  for (let attempt = 0; attempt < FIRECRAWL_EXTRACT_MAX_POLL_ATTEMPTS; attempt += 1) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      break;
    }
    const status = parseFirecrawlPayload(
      FirecrawlExtractStatusResponseSchema,
      await requestResearchJson({
        apiKey,
        maxResponseBytes: FIRECRAWL_RESPONSE_MAX_BYTES,
        method: "GET",
        provider: "Firecrawl",
        timeoutMs: Math.min(10_000, remainingMs),
        url: `${FIRECRAWL_API_URL}/extract/${encodeURIComponent(jobId)}`,
      }),
    );
    if (status.status === "completed") {
      return status;
    }
    if (status.status === "failed" || status.status === "cancelled") {
      return { ...status, success: false };
    }
    await delay(Math.min(FIRECRAWL_EXTRACT_POLL_INTERVAL_MS, remainingMs));
  }
  throw new APIError(504, "tool_timeout", "Firecrawl extraction timed out", {
    hint: "Retry with fewer URLs or a narrower extraction schema.",
    retriable: true,
  });
}

function firecrawlScrapeParams(input: FirecrawlScrapeInput): FirecrawlScrapeParams {
  return {
    formats: input.formats,
    mobile: input.mobile,
    onlyMainContent: input.onlyMainContent,
    removeBase64Images: input.removeBase64Images,
    ...(input.proxy ? { proxy: input.proxy } : {}),
    ...(input.timeout ? { timeout: input.timeout } : {}),
    ...(input.waitFor === undefined ? {} : { waitFor: input.waitFor }),
  };
}

function firecrawlSearchParams(input: FirecrawlSearchInput): FirecrawlSearchParams {
  return {
    limit: input.limit,
    timeout: FIRECRAWL_DEFAULT_REQUEST_TIMEOUT_MS,
    ...(input.country ? { country: input.country } : {}),
    ...(input.filter ? { filter: input.filter } : {}),
    ...(input.lang ? { lang: input.lang } : {}),
    ...(input.location ? { location: input.location } : {}),
    ...(input.tbs ? { tbs: input.tbs } : {}),
    ...(input.scrapeResults
      ? {
          scrapeOptions: {
            formats: ["markdown"],
            onlyMainContent: input.onlyMainContent,
            removeBase64Images: true,
          },
        }
      : {}),
  };
}

function firecrawlExtractParams(input: FirecrawlExtractInput): FirecrawlExtractParams {
  return {
    allowExternalLinks: input.allowExternalLinks,
    enableWebSearch: input.enableWebSearch,
    includeSubdomains: input.includeSubdomains,
    prompt: input.prompt,
    showSources: input.showSources,
    ...(input.jsonSchema ? { schema: input.jsonSchema } : {}),
    ...(input.systemPrompt ? { systemPrompt: input.systemPrompt } : {}),
    timeoutMs: input.timeoutMs,
  };
}

function normalizeDocument(
  document: FirecrawlRawDocument,
  fallbackUrl: string | undefined,
  limiter: CharacterLimiter,
  fieldMaxCharacters: number,
): FirecrawlSearchOutput["results"][number] {
  const metadata = normalizeMetadata(document.metadata, limiter);
  const output: FirecrawlSearchOutput["results"][number] = {
    links: normalizeUrls(document.links, 100),
    ...(metadata ? { metadata } : {}),
  };
  assignContent(output, "description", document.description, 2_000, limiter);
  assignContent(output, "html", document.html, fieldMaxCharacters, limiter);
  assignContent(output, "markdown", document.markdown, fieldMaxCharacters, limiter);
  assignContent(output, "rawHtml", document.rawHtml, fieldMaxCharacters, limiter);
  assignContent(output, "title", document.title, 1_000, limiter);
  const screenshot = normalizeUrl(document.screenshot);
  if (screenshot) {
    output.screenshot = screenshot;
  } else if (document.screenshot) {
    limiter.wasTruncated = true;
  }
  const url = firstUrl(document.url, metadata?.sourceURL, fallbackUrl);
  if (url) {
    output.url = url;
  }
  return output;
}

function normalizeMetadata(
  metadata: FirecrawlRawMetadata | undefined,
  limiter: CharacterLimiter,
): FirecrawlSearchOutput["results"][number]["metadata"] {
  if (!metadata) {
    return undefined;
  }
  const output: NonNullable<FirecrawlSearchOutput["results"][number]["metadata"]> = {};
  assignContent(output, "description", metadata.description, 2_000, limiter);
  assignContent(output, "title", metadata.title, 1_000, limiter);
  const sourceURL = normalizeUrl(metadata.sourceURL);
  if (sourceURL) {
    output.sourceURL = sourceURL;
  }
  if (metadata.statusCode !== undefined) {
    output.statusCode = metadata.statusCode;
  }
  return Object.keys(output).length > 0 ? output : undefined;
}

function assignContent<T extends object, K extends keyof T>(
  output: T,
  key: K,
  value: string | undefined,
  maxCharacters: number,
  limiter: CharacterLimiter,
): void {
  const normalized = takeContent(value, maxCharacters, limiter);
  if (normalized !== undefined) {
    output[key] = normalized as T[K];
  }
}

function takeContent(
  value: string | undefined,
  maxCharacters: number,
  limiter: CharacterLimiter,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const allowed = Math.min(maxCharacters, limiter.remaining);
  if (allowed <= 0 && value.length > 0) {
    limiter.wasTruncated = true;
    return undefined;
  }
  const normalized = value.slice(0, allowed);
  limiter.remaining -= normalized.length;
  if (normalized.length < value.length) {
    limiter.wasTruncated = true;
  }
  return normalized;
}

function normalizeUrls(values: string[] | undefined, maxItems: number): string[] {
  const output: string[] = [];
  for (const value of values ?? []) {
    const url = normalizeUrl(value);
    if (url && !output.includes(url)) {
      output.push(url);
    }
    if (output.length >= maxItems) {
      break;
    }
  }
  return output;
}

function firstUrl(...values: (string | undefined)[]): string | undefined {
  for (const value of values) {
    const url = normalizeUrl(value);
    if (url) {
      return url;
    }
  }
  return undefined;
}

function normalizeUrl(value: string | undefined): string | undefined {
  if (!value || value.length > 2_048) {
    return undefined;
  }
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function createCharacterLimiter(): CharacterLimiter {
  return { remaining: FIRECRAWL_OUTPUT_CONTENT_MAX_CHARACTERS, wasTruncated: false };
}

function combinedWarning(
  upstreamWarning: string | undefined,
  limiter: CharacterLimiter,
): string | undefined {
  const truncatedWarning = limiter.wasTruncated
    ? "Firecrawl content was truncated or omitted to keep the research result within safe size."
    : undefined;
  return (
    [upstreamWarning?.slice(0, 1_000), truncatedWarning].filter(Boolean).join(" ") || undefined
  );
}

function assertExtractDataSize(value: unknown): void {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    serialized = undefined;
  }
  if (
    serialized === undefined ||
    new TextEncoder().encode(serialized).byteLength > FIRECRAWL_EXTRACT_DATA_MAX_BYTES
  ) {
    throw new APIError(502, "tool_execution_failed", "Firecrawl extracted data is too large", {
      hint: "Use fewer URLs or a narrower extraction schema.",
      retriable: false,
    });
  }
}

function assertFirecrawlSuccess(response: {
  error?: string | undefined;
  success?: boolean | undefined;
}): void {
  if (response.success === false) {
    throw new APIError(502, "upstream_provider_outage", "Firecrawl request failed", {
      details: { reason: response.error?.slice(0, 500) ?? "unknown" },
      retriable: true,
    });
  }
}

function parseFirecrawlPayload<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }
  throw new APIError(502, "upstream_provider_outage", "Firecrawl returned an invalid response", {
    hint: "Retry after Firecrawl API health recovers.",
    retriable: true,
  });
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

const FirecrawlRawMetadataSchema = z
  .object({
    description: z.string().optional(),
    sourceURL: z.string().optional(),
    statusCode: z.number().int().optional(),
    title: z.string().optional(),
  })
  .strip();

const FirecrawlRawDocumentSchema = z
  .object({
    description: z.string().optional(),
    html: z.string().optional(),
    links: z.array(z.string()).max(1_000).optional(),
    markdown: z.string().optional(),
    metadata: FirecrawlRawMetadataSchema.optional(),
    rawHtml: z.string().optional(),
    screenshot: z.string().optional(),
    title: z.string().optional(),
    url: z.string().optional(),
  })
  .strip();

const FirecrawlScrapeResponseSchema = FirecrawlRawDocumentSchema.extend({
  error: z.string().max(2_000).optional(),
  success: z.boolean().optional(),
  warning: z.string().optional(),
});

const FirecrawlScrapeApiResponseSchema = z
  .object({
    data: FirecrawlRawDocumentSchema.optional(),
    error: z.string().max(2_000).optional(),
    success: z.boolean(),
    warning: z.string().optional(),
  })
  .strip();

const FirecrawlSearchResponseSchema = z
  .object({
    data: z.array(FirecrawlRawDocumentSchema).max(25).default([]),
    error: z.string().max(2_000).optional(),
    success: z.boolean(),
    warning: z.string().optional(),
  })
  .strip();

const FirecrawlExtractStartResponseSchema = z
  .object({
    error: z.string().max(2_000).optional(),
    id: z.string().min(1).max(500),
    success: z.boolean().optional(),
  })
  .strip();

const FirecrawlExtractStatusResponseSchema = z
  .object({
    data: z.unknown().optional(),
    error: z.string().max(2_000).optional(),
    sources: z.array(z.string()).max(1_000).optional(),
    status: z.enum(["processing", "completed", "failed", "cancelled"]),
    success: z.boolean().optional(),
    warning: z.string().optional(),
  })
  .strip();

const FirecrawlExtractResponseSchema = z
  .object({
    data: z.unknown(),
    error: z.string().max(2_000).optional(),
    sources: z.array(z.string()).max(1_000).optional(),
    success: z.boolean().optional(),
    warning: z.string().optional(),
  })
  .strip();

type FirecrawlRawMetadata = z.infer<typeof FirecrawlRawMetadataSchema>;
type FirecrawlRawDocument = z.infer<typeof FirecrawlRawDocumentSchema>;
