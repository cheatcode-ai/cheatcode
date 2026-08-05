import { APIError, createLogger } from "@cheatcode/observability";
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod/v4";
import {
  executeExaSearch,
  executeFirecrawlScrape,
  ResearchRuntimeContextSchema,
} from "../../tools/research";
import { CONTEXT } from "../context";
import {
  createResearchStepContext,
  exaSource,
  firecrawlSource,
  mergeResearchSources,
  ResearchPassDraftSchema,
  ResearchSynthesisDraftSchema,
  registerResearchSources,
  validateResearchPass,
  validateSynthesisClaims,
} from "./research-provenance";
import {
  DeepResearchFanoutInputSchema,
  DeepResearchInputSchema,
  ResearchFindingSchema,
  ResearchQueryListSchema,
  ResearchQuerySchema,
  ResearchReportSchema,
} from "./research-schemas";

const RESEARCH_QUERY_CONCURRENCY = 3;
const RESEARCH_RESULTS_PER_QUERY = 5;
const RESEARCH_RESULT_TEXT_CHARACTERS = 1_600;
const RESEARCH_EVIDENCE_CHARACTERS_PER_SOURCE = 3_000;
const RESEARCH_SCRAPE_CHARACTERS = 6_000;
const RESEARCH_PASS_MAX_OUTPUT_TOKENS = 2_048;
const RESEARCH_SYNTHESIS_MAX_OUTPUT_TOKENS = 4_096;
const RESEARCH_MODEL_TIMEOUT_MS = 75_000;
const RESEARCH_MODEL_ATTEMPTS = 2;
const RESEARCH_PROVIDER_OPTIONS = {
  anthropic: { structuredOutputMode: "outputFormat" as const },
};

interface ResearchEvidenceSource {
  content: string;
  provider: "exa" | "firecrawl";
  providerResultId?: string | undefined;
  sourceId: string;
  title?: string | null | undefined;
  url: string;
}

type RequestContextReader = { get(key: string): unknown };

interface ResearchWorkflowPrompts {
  queryPrompt(query: string): string;
  synthesisPrompt(findings: unknown): string;
}

interface DeepResearchWorkflowConfig extends ResearchWorkflowPrompts {
  buildQueries(input: z.output<typeof DeepResearchInputSchema>): Array<{ query: string }>;
  kind: "deep";
}

interface FanoutResearchWorkflowConfig extends ResearchWorkflowPrompts {
  buildQueries(input: z.output<typeof DeepResearchFanoutInputSchema>): Array<{ query: string }>;
  kind: "fanout";
}

type ResearchWorkflowConfig = DeepResearchWorkflowConfig | FanoutResearchWorkflowConfig;

export function createDeepResearchWorkflow(
  config: DeepResearchWorkflowConfig,
): ReturnType<typeof buildDeepResearchWorkflow>;
export function createDeepResearchWorkflow(
  config: FanoutResearchWorkflowConfig,
): ReturnType<typeof buildFanoutResearchWorkflow>;
export function createDeepResearchWorkflow(config: ResearchWorkflowConfig) {
  return config.kind === "deep"
    ? buildDeepResearchWorkflow(config)
    : buildFanoutResearchWorkflow(config);
}

function buildDeepResearchWorkflow(config: DeepResearchWorkflowConfig) {
  return createWorkflow({
    id: "deep-research",
    inputSchema: DeepResearchInputSchema,
    options: { shouldPersistSnapshot: () => false },
    outputSchema: ResearchReportSchema,
  })
    .then(createDeepPlanStep(config))
    .foreach(createQueryStep("run-deep-research-query", config), {
      concurrency: RESEARCH_QUERY_CONCURRENCY,
    })
    .then(createSynthesisStep("synthesize-deep-research", config))
    .commit();
}

function buildFanoutResearchWorkflow(config: FanoutResearchWorkflowConfig) {
  return createWorkflow({
    id: "deep-research-fanout",
    inputSchema: DeepResearchFanoutInputSchema,
    options: { shouldPersistSnapshot: () => false },
    outputSchema: ResearchReportSchema,
  })
    .then(createFanoutPlanStep(config))
    .foreach(createQueryStep("run-deep-research-fanout-query", config), {
      concurrency: RESEARCH_QUERY_CONCURRENCY,
    })
    .then(createSynthesisStep("synthesize-deep-research-fanout", config))
    .commit();
}

function createDeepPlanStep(config: DeepResearchWorkflowConfig) {
  return createStep({
    id: "plan-deep-research-queries",
    inputSchema: DeepResearchInputSchema,
    outputSchema: ResearchQueryListSchema,
    execute: async ({ abortSignal, inputData }) => {
      abortSignal.throwIfAborted();
      return ResearchQueryListSchema.parse(config.buildQueries(inputData));
    },
  });
}

function createFanoutPlanStep(config: FanoutResearchWorkflowConfig) {
  return createStep({
    id: "plan-deep-research-fanout-queries",
    inputSchema: DeepResearchFanoutInputSchema,
    outputSchema: ResearchQueryListSchema,
    execute: async ({ abortSignal, inputData }) => {
      abortSignal.throwIfAborted();
      return ResearchQueryListSchema.parse(config.buildQueries(inputData));
    },
  });
}

function createQueryStep(id: string, config: ResearchWorkflowPrompts) {
  return createStep({
    id,
    inputSchema: ResearchQuerySchema,
    outputSchema: ResearchFindingSchema,
    retries: 0,
    execute: async ({ abortSignal, inputData, mastra, requestContext }) => {
      const agent = mastra.getAgent("general");
      const research = createResearchStepContext(requestContext);
      const evidence = await fetchResearchEvidence(
        inputData.query,
        research.requestContext,
        abortSignal,
      );
      const response = await generateResearchOutput(abortSignal, (generationSignal) =>
        agent.generate(researchPassPrompt(config, inputData.query, evidence), {
          activeTools: [],
          abortSignal: generationSignal,
          modelSettings: { maxOutputTokens: RESEARCH_PASS_MAX_OUTPUT_TOKENS },
          providerOptions: RESEARCH_PROVIDER_OPTIONS,
          requestContext: research.requestContext,
          structuredOutput: { schema: ResearchPassDraftSchema },
        }),
      );
      return validateResearchPass(
        parseResearchPassDraft(response.object),
        inputData.query,
        research.collector,
      );
    },
  });
}

function createSynthesisStep(id: string, config: ResearchWorkflowPrompts) {
  return createStep({
    id,
    inputSchema: z.array(ResearchFindingSchema),
    outputSchema: ResearchReportSchema,
    retries: 0,
    execute: async ({ abortSignal, inputData, mastra, requestContext }) => {
      const agent = mastra.getAgent("general");
      const sources = mergeResearchSources(inputData);
      const response = await generateResearchOutput(abortSignal, (generationSignal) =>
        agent.generate(researchSynthesisPrompt(config, inputData), {
          activeTools: [],
          abortSignal: generationSignal,
          modelSettings: { maxOutputTokens: RESEARCH_SYNTHESIS_MAX_OUTPUT_TOKENS },
          providerOptions: RESEARCH_PROVIDER_OPTIONS,
          requestContext,
          structuredOutput: { schema: ResearchSynthesisDraftSchema },
        }),
      );
      const draft = parseResearchSynthesisDraft(response.object);
      return ResearchReportSchema.parse({
        claims: validateSynthesisClaims(draft.claims, sources),
        findings: inputData,
        report: draft.report,
        sources,
      });
    },
  });
}

async function fetchResearchEvidence(
  query: string,
  requestContext: RequestContextReader,
  abortSignal: AbortSignal,
): Promise<ResearchEvidenceSource[]> {
  abortSignal.throwIfAborted();
  const runtime = ResearchRuntimeContextSchema.parse({
    exaApiKey: requestContext.get(CONTEXT.exaApiKey),
    firecrawlApiKey: requestContext.get(CONTEXT.firecrawlApiKey),
  });
  const search = await executeExaSearch(
    {
      highlightMaxCharacters: 800,
      highlightQuery: query,
      includeHighlights: true,
      includeSummary: true,
      numResults: RESEARCH_RESULTS_PER_QUERY,
      query,
      summaryQuery: query,
      textMaxCharacters: RESEARCH_RESULT_TEXT_CHARACTERS,
      type: "auto",
    },
    runtime,
    abortSignal,
  );
  const primary = search.results[0];
  if (!primary) {
    throw new APIError(502, "upstream_provider_outage", "Research search returned no sources", {
      retriable: true,
    });
  }
  const evidence = search.results.map((result) => exaEvidenceSource(search.requestId, result));
  registerResearchSources(
    { requestContext },
    search.results.map((result) => exaSource({ ...result, requestId: search.requestId })),
  );
  const scraped = await fetchPrimaryPageEvidence(primary, runtime, abortSignal);
  if (scraped) {
    evidence.push(scraped);
    registerResearchSources({ requestContext }, [
      firecrawlSource({ title: scraped.title ?? undefined, url: scraped.url }),
    ]);
  }
  return evidence;
}

function exaEvidenceSource(
  requestId: string,
  result: Awaited<ReturnType<typeof executeExaSearch>>["results"][number],
): ResearchEvidenceSource {
  const content = [result.summary, ...result.highlights, result.text]
    .filter((value): value is string => Boolean(value))
    .join("\n\n")
    .slice(0, RESEARCH_EVIDENCE_CHARACTERS_PER_SOURCE);
  return {
    content,
    provider: "exa",
    providerResultId: result.id,
    sourceId: exaSource({ ...result, requestId }).id,
    title: result.title,
    url: result.url,
  };
}

async function fetchPrimaryPageEvidence(
  primary: Awaited<ReturnType<typeof executeExaSearch>>["results"][number],
  runtime: z.output<typeof ResearchRuntimeContextSchema>,
  abortSignal: AbortSignal,
): Promise<ResearchEvidenceSource | undefined> {
  if (!runtime.firecrawlApiKey) {
    return undefined;
  }
  try {
    const page = await executeFirecrawlScrape(
      { formats: ["markdown"], onlyMainContent: true, timeout: 30_000, url: primary.url },
      runtime,
      abortSignal,
    );
    if (!providerStatusIsSuccessful(page.metadata?.statusCode)) {
      return undefined;
    }
    const content = (page.markdown ?? page.description ?? "").slice(0, RESEARCH_SCRAPE_CHARACTERS);
    return {
      content,
      provider: "firecrawl",
      sourceId: firecrawlSource({ url: page.url }).id,
      title: page.title ?? page.metadata?.title,
      url: page.url,
    };
  } catch {
    abortSignal.throwIfAborted();
    return undefined;
  }
}

function researchPassPrompt(
  config: ResearchWorkflowPrompts,
  query: string,
  evidence: ResearchEvidenceSource[],
): string {
  return [
    config.queryPrompt(query),
    "Use only the provider evidence below. For Exa citations, copy providerResultId and URL exactly. For Firecrawl citations, copy the URL exactly.",
    "Set providerResultId to an empty string for every Firecrawl citation.",
    "Return 4-6 distinct, synthesis-ready claims, no more than 3 sources per claim, and a concise summary. Prioritize the strongest guidance instead of exhaustively restating the evidence.",
    "Do not cite sourceId directly and do not add sources that are absent from this evidence pack.",
    "",
    JSON.stringify(evidence, null, 2),
  ].join("\n");
}

function researchSynthesisPrompt(
  config: ResearchWorkflowPrompts,
  findings: z.output<typeof ResearchFindingSchema>[],
): string {
  return [
    config.synthesisPrompt(findings),
    "Consolidate overlapping evidence into at most 16 distinct claims with no more than 4 source IDs per claim.",
    "Keep the report focused and complete within 2,000 words while retaining actionable findings and citations.",
    "Write report as polished GitHub-flavored Markdown for direct display and PDF rendering. Preserve a clear heading hierarchy, lists, and comparison tables where useful.",
    "Cite factual claims with descriptive Markdown links to the exact source URLs in the findings, and finish with a Sources heading containing only sources used in the report.",
  ].join("\n");
}

function parseResearchPassDraft(value: unknown) {
  const parsed = ResearchPassDraftSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }
  throw invalidStructuredResearchOutput("research pass");
}

function parseResearchSynthesisDraft(value: unknown) {
  const parsed = ResearchSynthesisDraftSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }
  throw invalidStructuredResearchOutput("research synthesis");
}

function invalidStructuredResearchOutput(stage: string): APIError {
  return new APIError(
    502,
    "upstream_provider_outage",
    `The ${stage} returned invalid structured output`,
    { retriable: true },
  );
}

async function generateResearchOutput<T>(
  abortSignal: AbortSignal,
  generate: (generationSignal: AbortSignal) => Promise<T>,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < RESEARCH_MODEL_ATTEMPTS; attempt += 1) {
    abortSignal.throwIfAborted();
    const generationSignal = AbortSignal.any([
      abortSignal,
      AbortSignal.timeout(RESEARCH_MODEL_TIMEOUT_MS),
    ]);
    try {
      return await generate(generationSignal);
    } catch (error) {
      abortSignal.throwIfAborted();
      lastError = error;
      if (!isRetriableModelError(error) || attempt === RESEARCH_MODEL_ATTEMPTS - 1) {
        throw error;
      }
      createLogger().warn("research_model_generation_retrying", {
        attempt: attempt + 1,
        error,
      });
    }
  }
  throw lastError;
}

function isRetriableModelError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  if (error.name === "TimeoutError") {
    return true;
  }
  const record = error as Error & { isRetryable?: unknown; statusCode?: unknown };
  if (record.isRetryable === true) {
    return true;
  }
  return (
    typeof record.statusCode === "number" &&
    (record.statusCode === 408 || record.statusCode === 429 || record.statusCode >= 500)
  );
}

function providerStatusIsSuccessful(statusCode: number | undefined): boolean {
  return statusCode === undefined || (statusCode >= 200 && statusCode < 400);
}
