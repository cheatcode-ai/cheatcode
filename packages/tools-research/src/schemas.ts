import { z } from "zod/v4";

const domainSchema = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .regex(/^[a-z0-9.-]+$/i);

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const ExaSearchTypeSchema = z.enum(["auto", "fast", "instant"]);
export const ExaCategorySchema = z.enum([
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

export const ExaSearchResultSchema = z
  .object({
    author: z.string().nullable().optional(),
    highlights: z.array(z.string()).default([]),
    id: z.string(),
    publishedDate: z.string().optional(),
    score: z.number().optional(),
    summary: z.string().optional(),
    text: z.string().optional(),
    title: z.string().nullable(),
    url: z.string().url(),
  })
  .strict();

export const ExaSearchOutputSchema = z
  .object({
    requestId: z.string(),
    results: z.array(ExaSearchResultSchema),
  })
  .strict();

export const FirecrawlScrapeFormatSchema = z.enum([
  "markdown",
  "html",
  "rawHtml",
  "links",
  "screenshot",
  "screenshot@fullPage",
]);

export const FirecrawlScrapeInputSchema = z
  .object({
    url: z.string().url(),
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
    urls: z.array(z.string().url()).min(1).max(10),
    prompt: z.string().trim().min(1).max(4_000),
    jsonSchema: z.record(z.string(), z.unknown()).optional(),
    systemPrompt: z.string().trim().min(1).max(4_000).optional(),
    allowExternalLinks: z.boolean().default(false),
    enableWebSearch: z.boolean().default(false),
    includeSubdomains: z.boolean().default(false),
    showSources: z.boolean().default(true),
  })
  .strict();

export const FirecrawlDocumentMetadataSchema = z
  .object({
    description: z.string().optional(),
    sourceURL: z.string().optional(),
    statusCode: z.number().int().optional(),
    title: z.string().optional(),
  })
  .catchall(z.unknown());

export const FirecrawlDocumentSchema = z
  .object({
    description: z.string().optional(),
    html: z.string().optional(),
    links: z.array(z.string()).default([]),
    markdown: z.string().optional(),
    metadata: FirecrawlDocumentMetadataSchema.optional(),
    rawHtml: z.string().optional(),
    screenshot: z.string().optional(),
    title: z.string().optional(),
    url: z.string().optional(),
  })
  .catchall(z.unknown());

export const FirecrawlScrapeOutputSchema = z
  .object({
    description: z.string().optional(),
    html: z.string().optional(),
    links: z.array(z.string()).default([]),
    markdown: z.string().optional(),
    metadata: FirecrawlDocumentMetadataSchema.optional(),
    rawHtml: z.string().optional(),
    screenshot: z.string().optional(),
    title: z.string().optional(),
    url: z.string().url(),
    warning: z.string().optional(),
  })
  .strict();

export const FirecrawlSearchOutputSchema = z
  .object({
    results: z.array(FirecrawlDocumentSchema),
    warning: z.string().optional(),
  })
  .strict();

export const FirecrawlExtractOutputSchema = z
  .object({
    data: z.unknown(),
    sources: z.array(z.string()).default([]),
    warning: z.string().optional(),
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
