import { createTool, type ToolExecutionContext } from "@mastra/core/tools";
import { z } from "zod/v4";
import { executeGenerateMarkdownPdf } from "../../tools/docs/execute";
import { GenerateMarkdownPdfOutputSchema } from "../../tools/docs/schemas";
import {
  ExaSearchInputSchema,
  ExaSearchOutputSchema,
  executeExaSearch,
  executeFirecrawlExtract,
  executeFirecrawlScrape,
  executeFirecrawlSearch,
  FirecrawlExtractInputSchema,
  FirecrawlExtractOutputSchema,
  FirecrawlScrapeInputSchema,
  FirecrawlScrapeOutputSchema,
  FirecrawlSearchInputSchema,
  FirecrawlSearchOutputSchema,
} from "../../tools/research";
import { CONTEXT } from "../context";
import {
  DeepResearchFanoutInputSchema,
  DeepResearchInputSchema,
  type ResearchReport,
  ResearchReportSchema,
} from "../workflows";
import { buildResearchMarkdownPdfInput } from "./research-report-document-support";
import { researchRuntimeFromContext, workspaceRuntimeFromContext } from "./tool-runtime-context";
import { WorkflowResultSchema } from "./tool-schemas";

const ResearchReportArtifactSchema = z.strictObject({
  artifact: GenerateMarkdownPdfOutputSchema,
  report: ResearchReportSchema.shape.report,
});

type RequestContextReader = { get(key: string): unknown };
type MutableRequestContext = RequestContextReader & {
  delete(key: string): boolean;
  has(key: string): boolean;
  set(key: string, value: unknown): void;
};
type WorkflowRunLike = {
  readonly runId: string;
  cancel(): Promise<void>;
  start(args: { inputData: unknown; requestContext?: unknown }): Promise<unknown>;
};
type WorkflowLike = {
  createRun(): Promise<WorkflowRunLike>;
  deleteWorkflowRunById(runId: string): Promise<void>;
};
type MastraWorkflowHost = {
  getWorkflow(workflowName: string): WorkflowLike;
};

function mastraFromToolContext(context: ToolExecutionContext): MastraWorkflowHost {
  const candidate = context.mastra;
  if (typeof candidate !== "object" || candidate === null) {
    throw new Error("Mastra instance is required for workflow tools.");
  }
  const getWorkflow = (candidate as { getWorkflow?: unknown }).getWorkflow;
  if (typeof getWorkflow !== "function") {
    throw new Error("Mastra instance does not expose getWorkflow().");
  }
  return candidate as MastraWorkflowHost;
}

async function runResearchWorkflow({
  context,
  inputData,
  workflowName,
}: {
  context: ToolExecutionContext;
  inputData: unknown;
  workflowName: "deepResearch" | "deepResearchFanout";
}): Promise<ResearchReport> {
  const requestContext = requestContextFromUnknownToolContext(context);
  if (researchWorkflowIsActive(requestContext)) {
    throw new Error("Nested research workflows are not allowed.");
  }
  if (researchWorkflowWasAttempted(requestContext)) {
    throw new Error("A research workflow was already attempted for this request.");
  }
  markResearchWorkflowAttempted(requestContext);
  const workflow = mastraFromToolContext(context).getWorkflow(workflowName);
  const run = await workflow.createRun();
  const cancellation = bindToolCancellation(context, run);
  const cleanupResearchFlag = markResearchWorkflowActive(requestContext);
  try {
    await cancellation.assertNotCanceled();
    const workflowResult = await run.start({
      inputData,
      ...(requestContext ? { requestContext } : {}),
    });
    await cancellation.assertNotCanceled();
    const result = WorkflowResultSchema.parse(workflowResult);
    if (result.status !== "success" || !result.result) {
      const message =
        result.error instanceof Error ? result.error.message : `${workflowName} workflow failed.`;
      throw new Error(message);
    }
    return ResearchReportSchema.parse(result.result);
  } finally {
    await cancellation.cleanup();
    cleanupResearchFlag();
    await workflow.deleteWorkflowRunById(run.runId);
  }
}

function bindToolCancellation(
  context: ToolExecutionContext,
  run: WorkflowRunLike,
): {
  assertNotCanceled(): Promise<void>;
  cleanup(): Promise<void>;
} {
  const signal = abortSignalFromToolContext(context);
  let cancelPromise: Promise<void> | undefined;
  const cancelOnce = () => {
    cancelPromise ??= run.cancel().catch(() => undefined);
    return cancelPromise;
  };
  const onAbort = () => void cancelOnce();
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) {
    onAbort();
  }
  return {
    async assertNotCanceled() {
      if (signal?.aborted) {
        await cancelOnce();
        signal.throwIfAborted();
      }
    },
    async cleanup() {
      signal?.removeEventListener("abort", onAbort);
      await cancelPromise;
    },
  };
}

function requestContextFromUnknownToolContext(context: ToolExecutionContext): unknown {
  return context.requestContext;
}

function researchWorkflowIsActive(requestContext: unknown): boolean {
  return mutableRequestContext(requestContext)?.get(CONTEXT.researchWorkflowActive) === true;
}

function researchWorkflowWasAttempted(requestContext: unknown): boolean {
  return mutableRequestContext(requestContext)?.get(CONTEXT.researchWorkflowAttempted) === true;
}

function markResearchWorkflowAttempted(requestContext: unknown): void {
  mutableRequestContext(requestContext)?.set(CONTEXT.researchWorkflowAttempted, true);
}

function markResearchWorkflowActive(requestContext: unknown): () => void {
  const mutableContext = mutableRequestContext(requestContext);
  if (!mutableContext) {
    return () => undefined;
  }
  const hadPrevious = mutableContext.has(CONTEXT.researchWorkflowActive);
  const previous = mutableContext.get(CONTEXT.researchWorkflowActive);
  mutableContext.set(CONTEXT.researchWorkflowActive, true);
  return () => {
    if (hadPrevious) {
      mutableContext.set(CONTEXT.researchWorkflowActive, previous);
      return;
    }
    mutableContext.delete(CONTEXT.researchWorkflowActive);
  };
}

function mutableRequestContext(value: unknown): MutableRequestContext | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const candidate = value as {
    delete?: unknown;
    get?: unknown;
    has?: unknown;
    set?: unknown;
  };
  if (
    typeof candidate.delete === "function" &&
    typeof candidate.get === "function" &&
    typeof candidate.has === "function" &&
    typeof candidate.set === "function"
  ) {
    return candidate as MutableRequestContext;
  }
  return null;
}

export const mastraSearchWeb = createTool({
  id: "search_web",
  description:
    "Search the web with Exa and return cited source snippets, highlights, and optional summaries.",
  inputSchema: ExaSearchInputSchema,
  outputSchema: ExaSearchOutputSchema,
  execute: executeExaTool,
});

export const mastraSearchWebAdvanced = createTool({
  id: "search_web_advanced",
  description:
    "Run filtered Exa research search with domains, dates, categories, highlights, and summaries.",
  inputSchema: ExaSearchInputSchema,
  outputSchema: ExaSearchOutputSchema,
  execute: executeExaTool,
});

export const mastraSearchCompany = createTool({
  id: "search_company",
  description:
    "Search Exa's company category for company intel, competitor analysis, and market research.",
  inputSchema: ExaSearchInputSchema,
  outputSchema: ExaSearchOutputSchema,
  execute: async (input, context) => {
    const parsedInput = ExaSearchInputSchema.parse(input);
    return executeExaSearch(
      { ...parsedInput, category: "company" },
      researchRuntimeFromContext(context),
      abortSignalFromToolContext(context),
    );
  },
});

export const mastraFirecrawlScrape = createTool({
  id: "search_scrape",
  description:
    "Scrape a known URL with Firecrawl and return markdown, links, metadata, or screenshots.",
  inputSchema: FirecrawlScrapeInputSchema,
  outputSchema: FirecrawlScrapeOutputSchema,
  execute: executeFirecrawlScrapeTool,
});

export const mastraFirecrawlSearch = createTool({
  id: "search_web_content",
  description:
    "Search the web with Firecrawl, optionally scraping markdown for each returned result.",
  inputSchema: FirecrawlSearchInputSchema,
  outputSchema: FirecrawlSearchOutputSchema,
  execute: executeFirecrawlSearchTool,
});

export const mastraFirecrawlExtract = createTool({
  id: "search_extract",
  description:
    "Extract structured JSON from one or more URLs with Firecrawl using a prompt and optional JSON schema.",
  inputSchema: FirecrawlExtractInputSchema,
  outputSchema: FirecrawlExtractOutputSchema,
  execute: executeFirecrawlExtractTool,
});

export const mastraDeepResearch = createTool({
  id: "research_deep",
  description:
    "Run focused Deep Research for one complex topic and save the cited report as a project PDF. Use 3 queries for concise or narrow reports, 4 by default, and 5-6 only when the user explicitly requests deeper coverage; use research_fanout for broad multi-entity scans.",
  inputSchema: DeepResearchInputSchema,
  outputSchema: ResearchReportArtifactSchema,
  execute: async (input, context) => {
    const parsedInput = DeepResearchInputSchema.parse(input);
    const report = await runResearchWorkflow({
      context,
      inputData: parsedInput,
      workflowName: "deepResearch",
    });
    return createResearchReportArtifact(report, parsedInput.topic, context);
  },
});

export const mastraResearchFanout = createTool({
  id: "research_fanout",
  description:
    "Run Deep Research across four or more independent entities or genuinely separate angles. Pass entities as an array of separate short names. For comparisons of a few sources or standards within one topic, use research_deep. The workflow returns a cited comparison report and saves the complete report as a PDF deliverable in the project.",
  inputSchema: DeepResearchFanoutInputSchema,
  outputSchema: ResearchReportArtifactSchema,
  execute: async (input, context) => {
    const parsedInput = DeepResearchFanoutInputSchema.parse(input);
    const report = await runResearchWorkflow({
      context,
      inputData: parsedInput,
      workflowName: "deepResearchFanout",
    });
    return createResearchReportArtifact(report, parsedInput.goal, context);
  },
});

async function createResearchReportArtifact(
  report: ResearchReport,
  topic: string,
  context: ToolExecutionContext,
) {
  context.abortSignal?.throwIfAborted();
  const artifact = await executeGenerateMarkdownPdf(
    buildResearchMarkdownPdfInput(report.report, topic),
    await workspaceRuntimeFromContext(context),
  );
  return ResearchReportArtifactSchema.parse({ artifact, report: report.report });
}

async function executeExaTool(input: unknown, context: ToolExecutionContext) {
  return executeExaSearch(
    ExaSearchInputSchema.parse(input),
    researchRuntimeFromContext(context),
    abortSignalFromToolContext(context),
  );
}

async function executeFirecrawlScrapeTool(input: unknown, context: ToolExecutionContext) {
  return executeFirecrawlScrape(
    FirecrawlScrapeInputSchema.parse(input),
    researchRuntimeFromContext(context),
    abortSignalFromToolContext(context),
  );
}

async function executeFirecrawlSearchTool(input: unknown, context: ToolExecutionContext) {
  return executeFirecrawlSearch(
    FirecrawlSearchInputSchema.parse(input),
    researchRuntimeFromContext(context),
    abortSignalFromToolContext(context),
  );
}

async function executeFirecrawlExtractTool(input: unknown, context: ToolExecutionContext) {
  return executeFirecrawlExtract(
    FirecrawlExtractInputSchema.parse(input),
    researchRuntimeFromContext(context),
    abortSignalFromToolContext(context),
  );
}

function abortSignalFromToolContext(context: ToolExecutionContext): AbortSignal | undefined {
  return context.abortSignal;
}
