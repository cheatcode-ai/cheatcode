import { createStep, createWorkflow } from "@mastra/core/workflows";
import { stepCountIs } from "ai";
import { z } from "zod/v4";
import {
  createResearchStepContext,
  mergeResearchSources,
  ResearchPassDraftSchema,
  ResearchSynthesisDraftSchema,
  validateResearchPass,
  validateSynthesisClaims,
} from "./research-provenance";
import {
  DeepResearchInputSchema,
  ResearchFindingSchema,
  ResearchQueryListSchema,
  ResearchQuerySchema,
  ResearchReportSchema,
} from "./research-schemas";
import { buildDeepResearchQueries } from "./research-utils";

const RESEARCH_CHILD_TOOLS = [
  "firecrawl_extract",
  "firecrawl_scrape",
  "firecrawl_search",
  "search_company",
  "search_web",
  "search_web_advanced",
] as const;

const planDeepQueries = createStep({
  id: "plan-deep-research-queries",
  inputSchema: DeepResearchInputSchema,
  outputSchema: ResearchQueryListSchema,
  execute: async ({ abortSignal, inputData }) => {
    abortSignal.throwIfAborted();
    return ResearchQueryListSchema.parse(
      buildDeepResearchQueries(inputData.topic, inputData.maxQueries),
    );
  },
});

const runDeepQuery = createStep({
  id: "run-deep-research-query",
  inputSchema: ResearchQuerySchema,
  outputSchema: ResearchFindingSchema,
  execute: async ({ abortSignal, inputData, mastra, requestContext }) => {
    const agent = mastra.getAgent("general");
    const research = createResearchStepContext(requestContext);
    const response = await agent.generate(deepResearchPrompt(inputData.query), {
      abortSignal,
      requestContext: research.requestContext,
      activeTools: [...RESEARCH_CHILD_TOOLS],
      stopWhen: stepCountIs(6),
      structuredOutput: { schema: ResearchPassDraftSchema },
    });
    return validateResearchPass(
      ResearchPassDraftSchema.parse(response.object),
      inputData.query,
      research.collector,
    );
  },
});

const synthesizeDeepResearch = createStep({
  id: "synthesize-deep-research",
  inputSchema: z.array(ResearchFindingSchema),
  outputSchema: ResearchReportSchema,
  execute: async ({ abortSignal, inputData, mastra, requestContext }) => {
    const agent = mastra.getAgent("general");
    const sources = mergeResearchSources(inputData);
    const response = await agent.generate(synthesisPrompt("deep research brief", inputData), {
      abortSignal,
      requestContext,
      stopWhen: stepCountIs(6),
      structuredOutput: { schema: ResearchSynthesisDraftSchema },
      toolChoice: "none",
    });
    const draft = ResearchSynthesisDraftSchema.parse(response.object);
    return ResearchReportSchema.parse({
      claims: validateSynthesisClaims(draft.claims, sources),
      findings: inputData,
      report: draft.report,
      sources,
    });
  },
});

export const deepResearch = createWorkflow({
  id: "deep-research",
  inputSchema: DeepResearchInputSchema,
  options: { shouldPersistSnapshot: () => false },
  outputSchema: ResearchReportSchema,
})
  .then(planDeepQueries)
  .foreach(runDeepQuery, { concurrency: 5 })
  .then(synthesizeDeepResearch)
  .commit();

function deepResearchPrompt(query: string): string {
  return [
    "Run a focused research pass for the query below.",
    "Use search_web_advanced for discovery and firecrawl_scrape for source pages that need extraction.",
    "Do not call research_deep or research_fanout from inside this workflow step.",
    "Return structured claims only from provider results. Cite every claim with the exact Exa result ID and URL or exact Firecrawl URL returned by the tools.",
    "Do not infer citation IDs from prose and do not cite a URL that no tool returned.",
    "",
    `Query: ${query}`,
  ].join("\n");
}

function synthesisPrompt(kind: string, findings: unknown): string {
  return [
    `Synthesize the following findings into a cited ${kind}.`,
    "The claim sourceIds must exactly match IDs in the input sources. Do not invent or rewrite IDs.",
    "The structured claim map is authoritative provenance; keep the report readable and evidence-bound.",
    "",
    JSON.stringify(findings, null, 2),
  ].join("\n");
}
