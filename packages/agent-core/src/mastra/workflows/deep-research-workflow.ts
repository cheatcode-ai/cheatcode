import { APIError, createLogger } from "@cheatcode/observability";
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod/v4";
import {
  executeExaSearch,
  executeFirecrawlScrape,
  ResearchRuntimeContextSchema,
} from "../../tools/research";
import { CONTEXT } from "../context";
import { parseResearchMarkdown } from "./research-markdown";
import {
  exaSource,
  firecrawlSource,
  mergeResearchClaims,
  mergeResearchSources,
  validateSynthesisClaims,
} from "./research-provenance";
import {
  DeepResearchFanoutInputSchema,
  DeepResearchInputSchema,
  ResearchFindingSchema,
  ResearchQueryListSchema,
  ResearchQuerySchema,
  ResearchReportSchema,
  type ResearchSource,
} from "./research-schemas";

const RESEARCH_QUERY_CONCURRENCY = 3;
const RESEARCH_RESULTS_PER_QUERY = 5;
const RESEARCH_RESULT_TEXT_CHARACTERS = 1_600;
const RESEARCH_EVIDENCE_CHARACTERS_PER_SOURCE = 3_000;
const RESEARCH_SYNTHESIS_EVIDENCE_CHARACTERS_PER_SOURCE = 1_200;
const RESEARCH_SCRAPE_CHARACTERS = 6_000;
const RESEARCH_SYNTHESIS_MAX_OUTPUT_TOKENS = 8_192;
const RESEARCH_MODEL_TIMEOUT_MS = 75_000;
const RESEARCH_MODEL_ATTEMPTS = 2;

interface ResearchEvidenceSource {
  content: string;
  source: ResearchSource;
}

type RequestContextReader = { get(key: string): unknown };

interface ResearchWorkflowPrompts {
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
    .foreach(createQueryStep("run-deep-research-query"), {
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
    .foreach(createQueryStep("run-deep-research-fanout-query"), {
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

function createQueryStep(id: string) {
  return createStep({
    id,
    inputSchema: ResearchQuerySchema,
    outputSchema: ResearchFindingSchema,
    retries: 0,
    execute: async ({ abortSignal, inputData, requestContext }) => {
      const evidence = await fetchResearchEvidence(inputData.query, requestContext, abortSignal);
      return researchFindingFromEvidence(inputData.query, evidence);
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
      const claims = validateSynthesisClaims(mergeResearchClaims(inputData), sources);
      return generateResearchOutput(abortSignal, async (generationSignal) => {
        const response = await agent.generate(
          researchSynthesisPrompt(
            config,
            synthesisEvidence(inputData),
            taskMessageFromContext(requestContext),
          ),
          {
            activeTools: [],
            abortSignal: generationSignal,
            modelSettings: { maxOutputTokens: RESEARCH_SYNTHESIS_MAX_OUTPUT_TOKENS },
            requestContext,
          },
        );
        return ResearchReportSchema.parse({
          claims,
          findings: inputData,
          report: parseResearchMarkdown({
            finishReason: response.finishReason,
            sources,
            value: response.text,
          }),
          sources,
        });
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
  const scraped = await fetchPrimaryPageEvidence(primary, runtime, abortSignal);
  if (scraped) {
    evidence.push(scraped);
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
    source: exaSource({ ...result, requestId }),
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
      source: firecrawlSource({
        title: page.title ?? page.metadata?.title,
        url: page.url,
      }),
    };
  } catch {
    abortSignal.throwIfAborted();
    return undefined;
  }
}

function researchSynthesisPrompt(
  config: ResearchWorkflowPrompts,
  evidence: unknown,
  taskMessage: string | undefined,
): string {
  return [
    config.synthesisPrompt(evidence),
    taskMessage
      ? `The user's exact request is ${JSON.stringify(taskMessage)}. Preserve every requested scope, count, distinction, title, and output constraint exactly. Do not expand a deliberately narrow answer into the default long-form template.`
      : "",
    "Return only the complete report Markdown, with no JSON wrapper, preamble, or enclosing code fence.",
    "Start with one level-one heading. The returned Markdown is displayed unchanged in chat and rendered unchanged into the PDF.",
    "Keep the report focused and complete within 1,200 words while retaining actionable findings and citations.",
    "Write report as polished GitHub-flavored Markdown for direct display and PDF rendering. Preserve a clear heading hierarchy, lists, and comparison tables where useful.",
    "Cite factual claims with descriptive Markdown links to the exact source URLs in the evidence.",
    "Finish with exactly one level-two Sources heading. Under it, include one bullet per cited URL, formatted only as a descriptive Markdown link. Every inline citation must appear in that list, and every listed source must be cited inline.",
  ]
    .filter((part) => part.length > 0)
    .join("\n");
}

function taskMessageFromContext(requestContext: RequestContextReader): string | undefined {
  const value = requestContext.get(CONTEXT.promptTaskMessage);
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function researchFindingFromEvidence(
  query: string,
  evidence: ResearchEvidenceSource[],
): z.output<typeof ResearchFindingSchema> {
  const claims = evidence.map(({ content, source }) => ({
    claim: compactEvidence(content),
    sourceIds: [source.id],
  }));
  return ResearchFindingSchema.parse({
    claims,
    query,
    sources: evidence.map(({ source }) => source),
    summary: claims
      .slice(0, 2)
      .map(({ claim }) => claim)
      .join(" ")
      .slice(0, 1_200),
  });
}

function synthesisEvidence(findings: z.output<typeof ResearchFindingSchema>[]) {
  return findings.map((finding) => {
    const sources = new Map(finding.sources.map((source) => [source.id, source]));
    return {
      evidence: finding.claims.flatMap((claim) => {
        const source = sources.get(claim.sourceIds[0] ?? "");
        return source ? [{ excerpt: claim.claim, title: source.title, url: source.url }] : [];
      }),
      query: finding.query,
    };
  });
}

function compactEvidence(value: string): string {
  return value
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, RESEARCH_SYNTHESIS_EVIDENCE_CHARACTERS_PER_SOURCE);
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
  const record = error as Error & {
    code?: unknown;
    id?: unknown;
    isRetryable?: unknown;
    retriable?: unknown;
    statusCode?: unknown;
  };
  if (
    record.isRetryable === true ||
    record.retriable === true ||
    record.id === "STRUCTURED_OUTPUT_SCHEMA_VALIDATION_FAILED" ||
    record.code === "STRUCTURED_OUTPUT_SCHEMA_VALIDATION_FAILED"
  ) {
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
