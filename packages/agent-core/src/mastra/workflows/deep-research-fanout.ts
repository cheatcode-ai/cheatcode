import { createStep, createWorkflow } from "@mastra/core/workflows";
import { stepCountIs } from "ai";
import { z } from "zod/v4";
import {
  DeepResearchFanoutInputSchema,
  ResearchFindingSchema,
  ResearchQueryListSchema,
  ResearchQuerySchema,
  ResearchReportSchema,
} from "./research-schemas";
import { buildFanoutQueries, extractSources, mergeSources } from "./research-utils";

const planFanoutQueries = createStep({
  id: "plan-deep-research-fanout-queries",
  inputSchema: DeepResearchFanoutInputSchema,
  outputSchema: ResearchQueryListSchema,
  execute: async ({ inputData }) => ResearchQueryListSchema.parse(buildFanoutQueries(inputData)),
});

const runFanoutQuery = createStep({
  id: "run-deep-research-fanout-query",
  inputSchema: ResearchQuerySchema,
  outputSchema: ResearchFindingSchema,
  execute: async ({ inputData, mastra, requestContext }) => {
    const agent = mastra.getAgent("general");
    const response = await agent.generate(fanoutResearchPrompt(inputData.query), {
      maxSteps: 6,
      requestContext,
      stopWhen: stepCountIs(6),
    });
    const findings = response.text.trim();
    return ResearchFindingSchema.parse({
      findings,
      query: inputData.query,
      sources: extractSources(findings),
    });
  },
});

const synthesizeFanoutResearch = createStep({
  id: "synthesize-deep-research-fanout",
  inputSchema: z.array(ResearchFindingSchema),
  outputSchema: ResearchReportSchema,
  execute: async ({ inputData, mastra, requestContext }) => {
    const agent = mastra.getAgent("general");
    const response = await agent.generate(fanoutSynthesisPrompt(inputData), {
      maxSteps: 4,
      requestContext,
      stopWhen: stepCountIs(4),
    });
    return ResearchReportSchema.parse({
      findings: inputData,
      report: response.text.trim(),
      sources: mergeSources(inputData),
    });
  },
});

export const deepResearchFanout = createWorkflow({
  id: "deep-research-fanout",
  inputSchema: DeepResearchFanoutInputSchema,
  outputSchema: ResearchReportSchema,
})
  .then(planFanoutQueries)
  .foreach(runFanoutQuery, { concurrency: 25 })
  .then(synthesizeFanoutResearch)
  .commit();

function fanoutResearchPrompt(query: string): string {
  return [
    "Run a breadth-first research pass for the query below.",
    "Prefer search_web or search_company for discovery, then firecrawl_scrape for official pages.",
    "Do not call research_deep or research_fanout from inside this workflow step.",
    "Return compact findings with source URLs and emphasize comparable facts.",
    "",
    `Query: ${query}`,
  ].join("\n");
}

function fanoutSynthesisPrompt(findings: unknown): string {
  return [
    "Synthesize the following parallel research findings into a comparison-oriented report.",
    "Include a comparison matrix when the findings cover multiple entities.",
    "Keep source URLs attached to the claims they support.",
    "",
    JSON.stringify(findings, null, 2),
  ].join("\n");
}
