import type { ContentsOptions, RegularSearchOptions } from "exa-js";
import type { ResearchRuntimeContext } from "./runtime";
import { requireResearchProviderKey } from "./runtime";
import {
  type ExaSearchInput,
  ExaSearchInputSchema,
  type ExaSearchOutput,
  ExaSearchOutputSchema,
} from "./schemas";

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

export interface ExaClientLike {
  search(query: string, options: ExaToolSearchOptions): Promise<ExaRawSearchResponse>;
}

export async function executeExaSearch(
  input: unknown,
  runtimeContext: ResearchRuntimeContext,
  client?: ExaClientLike,
): Promise<ExaSearchOutput> {
  const resolvedClient = client ?? (await createExaClient(runtimeContext));
  const parsedInput = ExaSearchInputSchema.parse(input);
  const response = await resolvedClient.search(parsedInput.query, exaSearchOptions(parsedInput));

  return ExaSearchOutputSchema.parse({
    requestId: response.requestId,
    results: response.results.map(normalizeExaResult),
  });
}

// Dynamically imported so the Exa SDK stays out of the agent-worker isolate's
// startup path (CF startup CPU limit). Only loaded when the research tool fires.
async function createExaClient(runtimeContext: ResearchRuntimeContext): Promise<ExaClientLike> {
  const { default: Exa } = await import("exa-js");
  const client = new Exa(requireResearchProviderKey(runtimeContext, "exa"));
  return {
    search: (query, options) =>
      client.search(
        query,
        options as RegularSearchOptions & { contents: ContentsOptions },
      ) as Promise<ExaRawSearchResponse>,
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

function normalizeExaResult(result: ExaRawSearchResult): ExaSearchOutput["results"][number] {
  const normalized: ExaSearchOutput["results"][number] = {
    highlights: result.highlights ?? [],
    id: result.id,
    title: result.title ?? null,
    url: result.url,
  };
  if (result.author !== undefined) {
    normalized.author = result.author;
  }
  if (result.publishedDate !== undefined) {
    normalized.publishedDate = result.publishedDate;
  }
  if (result.score !== undefined) {
    normalized.score = result.score;
  }
  if (result.summary !== undefined) {
    normalized.summary = result.summary;
  }
  if (result.text !== undefined) {
    normalized.text = result.text;
  }
  return normalized;
}

interface ExaRawSearchResponse {
  requestId: string;
  results: ExaRawSearchResult[];
}

interface ExaRawSearchResult {
  author?: string | null | undefined;
  highlights?: string[] | undefined;
  id: string;
  publishedDate?: string | undefined;
  score?: number | undefined;
  summary?: string | undefined;
  text?: string | undefined;
  title: string | null;
  url: string;
}
