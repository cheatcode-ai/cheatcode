import { z } from "zod/v4";

const domainSchema = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .regex(/^[a-z0-9.-]+$/i);

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const urlSchema = z
  .string()
  .url()
  .max(2_048)
  .refine(isHttpUrl, "Only HTTP and HTTPS URLs are supported.");
const warningSchema = z.string().max(2_000).optional();

const FIRECRAWL_EXTRACT_DATA_MAX_BYTES = 256 * 1024;
const FIRECRAWL_JSON_SCHEMA_MAX_BYTES = 32 * 1024;

const ExaSearchTypeSchema = z.enum(["auto", "fast", "instant"]);
const ExaCategorySchema = z.enum([
  "company",
  "people",
  "research paper",
  "news",
  "pdf",
  "github",
  "personal site",
  "financial report",
]);

type ExaCategory = z.infer<typeof ExaCategorySchema>;

interface ExaFilterCheckInput {
  category?: ExaCategory | undefined;
  endPublishedDate?: string | undefined;
  excludeDomains?: string[] | undefined;
  includeDomains?: string[] | undefined;
  startPublishedDate?: string | undefined;
}

function supportsExaCategoryFilters(input: ExaFilterCheckInput): boolean {
  if (input.category !== "company" && input.category !== "people") {
    return true;
  }
  return !(
    input.includeDomains ||
    input.excludeDomains ||
    input.startPublishedDate ||
    input.endPublishedDate
  );
}

export const ExaSearchInputSchema = z
  .object({
    query: z.string().trim().min(1).max(2_000),
    numResults: z.number().int().min(1).max(25).default(8),
    type: ExaSearchTypeSchema.default("auto"),
    category: ExaCategorySchema.optional(),
    includeDomains: z.array(domainSchema).max(25).optional(),
    excludeDomains: z.array(domainSchema).max(25).optional(),
    startPublishedDate: isoDateSchema.optional(),
    endPublishedDate: isoDateSchema.optional(),
    textMaxCharacters: z.number().int().min(250).max(10_000).default(4_000),
    includeHighlights: z.boolean().default(true),
    highlightQuery: z.string().trim().min(1).max(1_000).optional(),
    highlightMaxCharacters: z.number().int().min(100).max(2_000).default(600),
    includeSummary: z.boolean().default(false),
    summaryQuery: z.string().trim().min(1).max(1_000).optional(),
  })
  .strict()
  .refine((input) => !(input.includeDomains && input.excludeDomains), {
    message: "Use either includeDomains or excludeDomains, not both.",
    path: ["includeDomains"],
  })
  .refine((input) => supportsExaCategoryFilters(input), {
    message: "Exa company and people categories do not support domain or published-date filters.",
    path: ["category"],
  });

const ExaSearchResultSchema = z
  .object({
    author: z.string().max(500).nullable().optional(),
    highlights: z.array(z.string().max(2_000)).max(10).default([]),
    id: z.string().max(500),
    publishedDate: z.string().max(100).optional(),
    score: z.number().optional(),
    summary: z.string().max(4_000).optional(),
    text: z.string().max(10_000).optional(),
    title: z.string().max(1_000).nullable(),
    url: urlSchema,
  })
  .strict();

export const ExaSearchOutputSchema = z
  .object({
    requestId: z.string().max(500),
    results: z.array(ExaSearchResultSchema).max(25),
    warning: warningSchema,
  })
  .strict();

const FirecrawlScrapeFormatSchema = z.enum([
  "markdown",
  "html",
  "rawHtml",
  "links",
  "screenshot",
  "screenshot@fullPage",
]);

export const FirecrawlScrapeInputSchema = z
  .object({
    url: urlSchema,
    formats: z.array(FirecrawlScrapeFormatSchema).min(1).max(6).default(["markdown"]),
    onlyMainContent: z.boolean().default(true),
    waitFor: z.number().int().min(0).max(30_000).optional(),
    timeout: z.number().int().min(1_000).max(120_000).optional(),
    mobile: z.boolean().default(false),
    removeBase64Images: z.boolean().default(true),
    proxy: z.enum(["basic", "stealth", "auto"]).optional(),
  })
  .strict();

export const FirecrawlSearchInputSchema = z
  .object({
    query: z.string().trim().min(1).max(2_000),
    limit: z.number().int().min(1).max(25).default(5),
    tbs: z.string().trim().min(1).max(100).optional(),
    filter: z.string().trim().min(1).max(500).optional(),
    lang: z.string().trim().min(2).max(20).optional(),
    country: z.string().trim().min(2).max(80).optional(),
    location: z.string().trim().min(2).max(200).optional(),
    scrapeResults: z.boolean().default(false),
    onlyMainContent: z.boolean().default(true),
  })
  .strict();

export const FirecrawlExtractInputSchema = z
  .object({
    urls: z.array(urlSchema).min(1).max(10),
    prompt: z.string().trim().min(1).max(4_000),
    jsonSchema: z
      .record(z.string(), z.unknown())
      .refine((value) => serializedSizeWithin(value, FIRECRAWL_JSON_SCHEMA_MAX_BYTES), {
        message: "JSON schema is too large.",
      })
      .optional(),
    systemPrompt: z.string().trim().min(1).max(4_000).optional(),
    allowExternalLinks: z.boolean().default(false),
    enableWebSearch: z.boolean().default(false),
    includeSubdomains: z.boolean().default(false),
    showSources: z.boolean().default(true),
    timeoutMs: z.number().int().min(10_000).max(120_000).default(120_000),
  })
  .strict();

const FirecrawlDocumentMetadataSchema = z
  .object({
    description: z.string().max(2_000).optional(),
    sourceURL: urlSchema.optional(),
    statusCode: z.number().int().optional(),
    title: z.string().max(1_000).optional(),
  })
  .strict();

const FirecrawlDocumentSchema = z
  .object({
    description: z.string().max(2_000).optional(),
    html: z.string().max(80_000).optional(),
    links: z.array(urlSchema).max(100).default([]),
    markdown: z.string().max(80_000).optional(),
    metadata: FirecrawlDocumentMetadataSchema.optional(),
    rawHtml: z.string().max(80_000).optional(),
    screenshot: urlSchema.optional(),
    title: z.string().max(1_000).optional(),
    url: urlSchema.optional(),
  })
  .strict();

export const FirecrawlScrapeOutputSchema = z
  .object({
    description: z.string().max(2_000).optional(),
    html: z.string().max(120_000).optional(),
    links: z.array(urlSchema).max(100).default([]),
    markdown: z.string().max(120_000).optional(),
    metadata: FirecrawlDocumentMetadataSchema.optional(),
    rawHtml: z.string().max(120_000).optional(),
    screenshot: urlSchema.optional(),
    title: z.string().max(1_000).optional(),
    url: urlSchema,
    warning: warningSchema,
  })
  .strict();

export const FirecrawlSearchOutputSchema = z
  .object({
    results: z.array(FirecrawlDocumentSchema).max(25),
    warning: warningSchema,
  })
  .strict();

export const FirecrawlExtractOutputSchema = z
  .object({
    data: z
      .unknown()
      .refine((value) => serializedSizeWithin(value, FIRECRAWL_EXTRACT_DATA_MAX_BYTES), {
        message: "Extracted data is too large.",
      }),
    sources: z.array(urlSchema).max(50).default([]),
    warning: warningSchema,
  })
  .strict();

export type ExaSearchInput = z.infer<typeof ExaSearchInputSchema>;
export type ExaSearchOutput = z.infer<typeof ExaSearchOutputSchema>;
export type FirecrawlScrapeInput = z.infer<typeof FirecrawlScrapeInputSchema>;
export type FirecrawlScrapeOutput = z.infer<typeof FirecrawlScrapeOutputSchema>;
export type FirecrawlSearchInput = z.infer<typeof FirecrawlSearchInputSchema>;
export type FirecrawlSearchOutput = z.infer<typeof FirecrawlSearchOutputSchema>;
export type FirecrawlExtractInput = z.infer<typeof FirecrawlExtractInputSchema>;
export type FirecrawlExtractOutput = z.infer<typeof FirecrawlExtractOutputSchema>;

function serializedSizeWithin(value: unknown, maxBytes: number): boolean {
  try {
    const serialized = JSON.stringify(value);
    return serialized !== undefined && new TextEncoder().encode(serialized).byteLength <= maxBytes;
  } catch {
    return false;
  }
}

function isHttpUrl(value: string): boolean {
  const protocol = new URL(value).protocol;
  return protocol === "http:" || protocol === "https:";
}
