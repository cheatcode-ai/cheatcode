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
  DeepResearchFanoutInputSchema,
  ResearchFindingSchema,
  ResearchQueryListSchema,
  ResearchQuerySchema,
  ResearchReportSchema,
} from "./research-schemas";
import { buildFanoutQueries } from "./research-utils";

const RESEARCH_CHILD_TOOLS = [
  "firecrawl_extract",
  "firecrawl_scrape",
  "firecrawl_search",
  "search_company",
  "search_web",
  "search_web_advanced",
] as const;

const planFanoutQueries = createStep({
  id: "plan-deep-research-fanout-queries",
  inputSchema: DeepResearchFanoutInputSchema,
  outputSchema: ResearchQueryListSchema,
  execute: async ({ abortSignal, inputData }) => {
    abortSignal.throwIfAborted();
    return ResearchQueryListSchema.parse(buildFanoutQueries(inputData));
  },
});

const runFanoutQuery = createStep({
  id: "run-deep-research-fanout-query",
  inputSchema: ResearchQuerySchema,
  outputSchema: ResearchFindingSchema,
  execute: async ({ abortSignal, inputData, mastra, requestContext }) => {
    const agent = mastra.getAgent("general");
    const research = createResearchStepContext(requestContext);
    const response = await agent.generate(fanoutResearchPrompt(inputData.query), {
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

const synthesizeFanoutResearch = createStep({
  id: "synthesize-deep-research-fanout",
  inputSchema: z.array(ResearchFindingSchema),
  outputSchema: ResearchReportSchema,
  execute: async ({ abortSignal, inputData, mastra, requestContext }) => {
    const agent = mastra.getAgent("general");
    const sources = mergeResearchSources(inputData);
    const response = await agent.generate(fanoutSynthesisPrompt(inputData), {
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

export const deepResearchFanout = createWorkflow({
  id: "deep-research-fanout",
  inputSchema: DeepResearchFanoutInputSchema,
  options: { shouldPersistSnapshot: () => false },
  outputSchema: ResearchReportSchema,
})
  .then(planFanoutQueries)
  .foreach(runFanoutQuery, { concurrency: 5 })
  .then(synthesizeFanoutResearch)
  .commit();

function fanoutResearchPrompt(query: string): string {
  return [
    "Run a breadth-first research pass for the query below.",
    "Prefer search_web or search_company for discovery, then firecrawl_scrape for official pages.",
    "Do not call research_deep or research_fanout from inside this workflow step.",
    "Return structured claims only from provider results. Cite every claim with the exact Exa result ID and URL or exact Firecrawl URL returned by the tools.",
    "Do not infer citation IDs from prose and do not cite a URL that no tool returned.",
    "",
    `Query: ${query}`,
  ].join("\n");
}

function fanoutSynthesisPrompt(findings: unknown): string {
  return [
    "Synthesize the following parallel research findings into a comparison-oriented report.",
    "Include a comparison matrix when the findings cover multiple entities.",
    "The claim sourceIds must exactly match IDs in the input sources. Do not invent or rewrite IDs.",
    "The structured claim map is authoritative provenance; keep the report readable and evidence-bound.",
    "",
    JSON.stringify(findings, null, 2),
  ].join("\n");
}
