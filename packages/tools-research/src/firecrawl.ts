import FirecrawlApp from "@mendable/firecrawl-js";
import { z } from "zod/v4";
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
}

interface FirecrawlExtractParams {
  allowExternalLinks?: boolean;
  enableWebSearch?: boolean;
  includeSubdomains?: boolean;
  prompt: string;
  schema?: Record<string, unknown>;
  showSources?: boolean;
  systemPrompt?: string;
}

export interface FirecrawlClientLike {
  extract(urls?: string[], params?: FirecrawlExtractParams): Promise<unknown>;
  scrapeUrl(url: string, params?: FirecrawlScrapeParams): Promise<unknown>;
  search(query: string, params?: FirecrawlSearchParams): Promise<unknown>;
}

export async function executeFirecrawlScrape(
  input: unknown,
  runtimeContext: ResearchRuntimeContext,
  client: FirecrawlClientLike = createFirecrawlClient(runtimeContext),
): Promise<FirecrawlScrapeOutput> {
  const parsedInput = FirecrawlScrapeInputSchema.parse(input);
  const response = await client.scrapeUrl(parsedInput.url, firecrawlScrapeParams(parsedInput));
  const document = FirecrawlScrapeResponseSchema.parse(response);
  assertFirecrawlSuccess(document);

  return FirecrawlScrapeOutputSchema.parse({
    description: document.description ?? document.metadata?.description,
    html: document.html,
    links: document.links ?? [],
    markdown: document.markdown,
    metadata: document.metadata,
    rawHtml: document.rawHtml,
    screenshot: document.screenshot,
    title: document.title ?? document.metadata?.title,
    url: document.url ?? document.metadata?.sourceURL ?? parsedInput.url,
    warning: document.warning,
  });
}

export async function executeFirecrawlSearch(
  input: unknown,
  runtimeContext: ResearchRuntimeContext,
  client: FirecrawlClientLike = createFirecrawlClient(runtimeContext),
): Promise<FirecrawlSearchOutput> {
  const parsedInput = FirecrawlSearchInputSchema.parse(input);
  const response = await client.search(parsedInput.query, firecrawlSearchParams(parsedInput));
  const parsedResponse = FirecrawlSearchResponseSchema.parse(response);
  assertFirecrawlSuccess(parsedResponse);

  return FirecrawlSearchOutputSchema.parse({
    results: parsedResponse.data,
    warning: parsedResponse.warning,
  });
}

export async function executeFirecrawlExtract(
  input: unknown,
  runtimeContext: ResearchRuntimeContext,
  client: FirecrawlClientLike = createFirecrawlClient(runtimeContext),
): Promise<FirecrawlExtractOutput> {
  const parsedInput = FirecrawlExtractInputSchema.parse(input);
  const response = await client.extract(parsedInput.urls, firecrawlExtractParams(parsedInput));
  const parsedResponse = FirecrawlExtractResponseSchema.parse(response);
  assertFirecrawlSuccess(parsedResponse);

  return FirecrawlExtractOutputSchema.parse({
    data: parsedResponse.data,
    sources: parsedResponse.sources ?? [],
    warning: parsedResponse.warning,
  });
}

function createFirecrawlClient(runtimeContext: ResearchRuntimeContext): FirecrawlClientLike {
  const app = new FirecrawlApp({
    apiKey: requireResearchProviderKey(runtimeContext, "firecrawl"),
  });

  return {
    extract: (urls, params) => app.extract(urls, params),
    scrapeUrl: (url, params) => app.scrapeUrl(url, params),
    search: (query, params) => app.search(query, params),
  };
}

function firecrawlScrapeParams(input: FirecrawlScrapeInput): FirecrawlScrapeParams {
  const params: FirecrawlScrapeParams = {
    formats: input.formats,
    mobile: input.mobile,
    onlyMainContent: input.onlyMainContent,
    removeBase64Images: input.removeBase64Images,
  };
  if (input.proxy) {
    params.proxy = input.proxy;
  }
  if (input.timeout) {
    params.timeout = input.timeout;
  }
  if (input.waitFor !== undefined) {
    params.waitFor = input.waitFor;
  }
  return params;
}

function firecrawlSearchParams(input: FirecrawlSearchInput): FirecrawlSearchParams {
  const params: FirecrawlSearchParams = {
    limit: input.limit,
  };
  if (input.country) {
    params.country = input.country;
  }
  if (input.filter) {
    params.filter = input.filter;
  }
  if (input.lang) {
    params.lang = input.lang;
  }
  if (input.location) {
    params.location = input.location;
  }
  if (input.tbs) {
    params.tbs = input.tbs;
  }
  if (input.scrapeResults) {
    params.scrapeOptions = {
      formats: ["markdown"],
      onlyMainContent: input.onlyMainContent,
      removeBase64Images: true,
    };
  }
  return params;
}

function firecrawlExtractParams(input: FirecrawlExtractInput): FirecrawlExtractParams {
  const params: FirecrawlExtractParams = {
    allowExternalLinks: input.allowExternalLinks,
    enableWebSearch: input.enableWebSearch,
    includeSubdomains: input.includeSubdomains,
    prompt: input.prompt,
    showSources: input.showSources,
  };
  if (input.jsonSchema) {
    params.schema = input.jsonSchema;
  }
  if (input.systemPrompt) {
    params.systemPrompt = input.systemPrompt;
  }
  return params;
}

const FirecrawlMetadataSchema = z
  .object({
    description: z.string().optional(),
    sourceURL: z.string().optional(),
    title: z.string().optional(),
  })
  .catchall(z.unknown());

const FirecrawlDocumentBaseSchema = z
  .object({
    description: z.string().optional(),
    html: z.string().optional(),
    links: z.array(z.string()).optional(),
    markdown: z.string().optional(),
    metadata: FirecrawlMetadataSchema.optional(),
    rawHtml: z.string().optional(),
    screenshot: z.string().optional(),
    title: z.string().optional(),
    url: z.string().optional(),
  })
  .catchall(z.unknown());

const FirecrawlScrapeResponseSchema = FirecrawlDocumentBaseSchema.extend({
  success: z.boolean().optional(),
  warning: z.string().optional(),
});

const FirecrawlSearchResponseSchema = z
  .object({
    data: z.array(FirecrawlDocumentBaseSchema).default([]),
    error: z.string().optional(),
    success: z.boolean(),
    warning: z.string().optional(),
  })
  .catchall(z.unknown());

const FirecrawlExtractResponseSchema = z
  .object({
    data: z.unknown(),
    error: z.string().optional(),
    sources: z.array(z.string()).optional(),
    success: z.boolean(),
    warning: z.string().optional(),
  })
  .catchall(z.unknown());

function assertFirecrawlSuccess(response: {
  error?: string | undefined;
  success?: boolean | undefined;
}): void {
  if (response.success === false) {
    throw new Error(response.error || "Firecrawl request failed.");
  }
}
