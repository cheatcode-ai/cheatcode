import { APIError } from "@cheatcode/observability";
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
const RESEARCH_RESULTS_PER_QUERY = 6;
const RESEARCH_RESULT_TEXT_CHARACTERS = 2_500;
const RESEARCH_SCRAPE_CHARACTERS = 12_000;

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
      const response = await agent.generate(researchPassPrompt(config, inputData.query, evidence), {
        abortSignal,
        requestContext: research.requestContext,
        structuredOutput: { schema: ResearchPassDraftSchema },
        toolChoice: "none",
      });
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
      const response = await agent.generate(config.synthesisPrompt(inputData), {
        abortSignal,
        requestContext,
        structuredOutput: { schema: ResearchSynthesisDraftSchema },
        toolChoice: "none",
      });
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
    .join("\n\n");
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
    "Do not cite sourceId directly and do not add sources that are absent from this evidence pack.",
    "",
    JSON.stringify(evidence, null, 2),
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

function providerStatusIsSuccessful(statusCode: number | undefined): boolean {
  return statusCode === undefined || (statusCode >= 200 && statusCode < 400);
}
