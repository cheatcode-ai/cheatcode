import { APIError } from "@cheatcode/observability";
import { z } from "zod/v4";
import {
  type CharacterLimiter,
  createCharacterLimiter,
  takeLimitedContent,
} from "./output-limiter";
import { requestResearchJson } from "./provider-http";
import type { ResearchRuntimeContext } from "./runtime";
import { requireResearchProviderKey } from "./runtime";
import {
  type ExaSearchInput,
  ExaSearchInputSchema,
  type ExaSearchOutput,
  ExaSearchOutputSchema,
} from "./schemas";

const EXA_SEARCH_URL = "https://api.exa.ai/search";
const EXA_REQUEST_TIMEOUT_MS = 30_000;
const EXA_RESPONSE_MAX_BYTES = 1024 * 1024;
const EXA_OUTPUT_CONTENT_MAX_CHARACTERS = 160_000;

type ExaToolContentsOptions = {
  highlights?: true | { maxCharacters: number; query?: string };
  summary?: true | { query?: string };
  text: { maxCharacters: number };
};

type ExaToolSearchOptions = {
  category?: NonNullable<ExaSearchInput["category"]>;
  contents: ExaToolContentsOptions;
  endPublishedDate?: string;
  excludeDomains?: string[];
  includeDomains?: string[];
  numResults: number;
  startPublishedDate?: string;
  type: ExaSearchInput["type"];
};

interface ExaClientLike {
  search(query: string, options: ExaToolSearchOptions): Promise<unknown>;
}

export async function executeExaSearch(
  input: unknown,
  runtimeContext: ResearchRuntimeContext,
  abortSignal?: AbortSignal,
): Promise<ExaSearchOutput> {
  const parsedInput = ExaSearchInputSchema.parse(input);
  const client = createExaClient(runtimeContext, abortSignal);
  const response = parseExaResponse(
    await client.search(parsedInput.query, exaSearchOptions(parsedInput)),
  );
  const limiter = createCharacterLimiter(EXA_OUTPUT_CONTENT_MAX_CHARACTERS);
  const results = response.results.map((result) =>
    normalizeExaResult(result, parsedInput, limiter),
  );

  return ExaSearchOutputSchema.parse({
    requestId: truncate(response.requestId, 500),
    results,
    ...(limiter.wasTruncated
      ? { warning: "Exa content was truncated to keep the research result within safe size." }
      : {}),
  });
}

function createExaClient(
  runtimeContext: ResearchRuntimeContext,
  abortSignal: AbortSignal | undefined,
): ExaClientLike {
  const apiKey = requireResearchProviderKey(runtimeContext, "exa");
  return {
    search: (query, options) =>
      requestResearchJson({
        abortSignal,
        apiKey,
        body: { query, ...options },
        maxResponseBytes: EXA_RESPONSE_MAX_BYTES,
        provider: "Exa",
        timeoutMs: EXA_REQUEST_TIMEOUT_MS,
        url: EXA_SEARCH_URL,
      }),
  };
}

function exaSearchOptions(input: ExaSearchInput): ExaToolSearchOptions {
  const options: ExaToolSearchOptions = {
    contents: {
      text: { maxCharacters: input.textMaxCharacters },
    },
    numResults: input.numResults,
    type: input.type,
  };

  if (input.category) {
    options.category = input.category;
  }
  if (input.includeDomains) {
    options.includeDomains = input.includeDomains;
  }
  if (input.excludeDomains) {
    options.excludeDomains = input.excludeDomains;
  }
  if (input.startPublishedDate) {
    options.startPublishedDate = input.startPublishedDate;
  }
  if (input.endPublishedDate) {
    options.endPublishedDate = input.endPublishedDate;
  }
  if (input.includeHighlights) {
    options.contents.highlights = input.highlightQuery
      ? { maxCharacters: input.highlightMaxCharacters, query: input.highlightQuery }
      : { maxCharacters: input.highlightMaxCharacters };
  }
  if (input.includeSummary) {
    options.contents.summary = input.summaryQuery ? { query: input.summaryQuery } : true;
  }

  return options;
}

function normalizeExaResult(
  result: ExaRawSearchResult,
  input: ExaSearchInput,
  limiter: CharacterLimiter,
): ExaSearchOutput["results"][number] {
  const normalized: ExaSearchOutput["results"][number] = {
    highlights: normalizeHighlights(result.highlights, input.highlightMaxCharacters, limiter),
    id: truncate(result.id, 500),
    title:
      result.title === null || result.title === undefined ? null : truncate(result.title, 1_000),
    url: result.url,
  };
  if (result.author !== undefined) {
    normalized.author = result.author === null ? null : truncate(result.author, 500);
  }
  if (result.publishedDate !== undefined) {
    normalized.publishedDate = truncate(result.publishedDate, 100);
  }
  if (result.score !== undefined) {
    normalized.score = result.score;
  }
  const summary = takeLimitedContent(result.summary, 4_000, limiter);
  if (summary !== undefined) {
    normalized.summary = summary;
  }
  const text = takeLimitedContent(result.text, input.textMaxCharacters, limiter);
  if (text !== undefined) {
    normalized.text = text;
  }
  return normalized;
}

function normalizeHighlights(
  highlights: string[] | undefined,
  maxCharacters: number,
  limiter: CharacterLimiter,
): string[] {
  const output: string[] = [];
  let remaining = maxCharacters;
  for (const highlight of highlights?.slice(0, 10) ?? []) {
    if (remaining <= 0 || limiter.remaining <= 0) {
      limiter.wasTruncated = true;
      break;
    }
    const normalized = takeLimitedContent(highlight, Math.min(2_000, remaining), limiter);
    if (normalized !== undefined) {
      output.push(normalized);
      remaining -= normalized.length;
    }
  }
  if ((highlights?.length ?? 0) > output.length) {
    limiter.wasTruncated = true;
  }
  return output;
}

function truncate(value: string, maxCharacters: number): string {
  return value.slice(0, maxCharacters);
}

const ExaRawSearchResultSchema = z
  .object({
    author: z.string().nullable().optional(),
    highlights: z.array(z.string()).optional(),
    id: z.string().min(1),
    publishedDate: z.string().optional(),
    score: z.number().finite().optional(),
    summary: z.string().optional(),
    text: z.string().optional(),
    title: z.string().nullable().optional(),
    url: z
      .string()
      .url()
      .max(2_048)
      .refine((value) => {
        const protocol = new URL(value).protocol;
        return protocol === "http:" || protocol === "https:";
      }),
  })
  .strip();

const ExaRawSearchResponseSchema = z
  .object({
    requestId: z.string().min(1),
    results: z.array(ExaRawSearchResultSchema).max(25),
  })
  .strip();

type ExaRawSearchResult = z.infer<typeof ExaRawSearchResultSchema>;
type ExaRawSearchResponse = z.infer<typeof ExaRawSearchResponseSchema>;

function parseExaResponse(value: unknown): ExaRawSearchResponse {
  const parsed = ExaRawSearchResponseSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }
  throw new APIError(502, "upstream_provider_outage", "Exa returned an invalid response", {
    hint: "Retry after Exa API health recovers.",
    retriable: true,
  });
}
