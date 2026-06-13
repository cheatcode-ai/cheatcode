import { createStep, createWorkflow } from "@mastra/core/workflows";
import { stepCountIs } from "ai";
import { z } from "zod/v4";
import {
  DeepResearchInputSchema,
  ResearchFindingSchema,
  ResearchQueryListSchema,
  ResearchQuerySchema,
  ResearchReportSchema,
} from "./research-schemas";
import { buildDeepResearchQueries, extractSources, mergeSources } from "./research-utils";

const planDeepQueries = createStep({
  id: "plan-deep-research-queries",
  inputSchema: DeepResearchInputSchema,
  outputSchema: ResearchQueryListSchema,
  execute: async ({ inputData }) =>
    ResearchQueryListSchema.parse(buildDeepResearchQueries(inputData.topic, inputData.maxQueries)),
});

const runDeepQuery = createStep({
  id: "run-deep-research-query",
  inputSchema: ResearchQuerySchema,
  outputSchema: ResearchFindingSchema,
  execute: async ({ inputData, mastra, requestContext }) => {
    const agent = mastra.getAgent("general");
    const response = await agent.generate(deepResearchPrompt(inputData.query), {
      maxSteps: 8,
      requestContext,
      stopWhen: stepCountIs(8),
    });
    const findings = response.text.trim();
    return ResearchFindingSchema.parse({
      findings,
      query: inputData.query,
      sources: extractSources(findings),
    });
  },
});

const synthesizeDeepResearch = createStep({
  id: "synthesize-deep-research",
  inputSchema: z.array(ResearchFindingSchema),
  outputSchema: ResearchReportSchema,
  execute: async ({ inputData, mastra, requestContext }) => {
    const agent = mastra.getAgent("general");
    const response = await agent.generate(synthesisPrompt("deep research brief", inputData), {
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

export const deepResearch = createWorkflow({
  id: "deep-research",
  inputSchema: DeepResearchInputSchema,
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
    "Return concise findings with inline source URLs after each factual claim.",
    "",
    `Query: ${query}`,
  ].join("\n");
}

function synthesisPrompt(kind: string, findings: unknown): string {
  return [
    `Synthesize the following findings into a cited ${kind}.`,
    "Keep citations as source URLs in the relevant paragraphs and end with a source list.",
    "",
    JSON.stringify(findings, null, 2),
  ].join("\n");
}
