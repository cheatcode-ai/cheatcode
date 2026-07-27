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
  DeepResearchInputSchema,
  ResearchFindingSchema,
  ResearchQueryListSchema,
  ResearchQuerySchema,
  ResearchReportSchema,
} from "./research-schemas";

const RESEARCH_CHILD_TOOLS = [
  "firecrawl_extract",
  "firecrawl_scrape",
  "firecrawl_search",
  "search_company",
  "search_web",
  "search_web_advanced",
] as const;

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
    .foreach(createQueryStep("run-deep-research-query", config), { concurrency: 5 })
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
    .foreach(createQueryStep("run-deep-research-fanout-query", config), { concurrency: 5 })
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
    execute: async ({ abortSignal, inputData, mastra, requestContext }) => {
      const agent = mastra.getAgent("general");
      const research = createResearchStepContext(requestContext);
      const response = await agent.generate(config.queryPrompt(inputData.query), {
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
}

function createSynthesisStep(id: string, config: ResearchWorkflowPrompts) {
  return createStep({
    id,
    inputSchema: z.array(ResearchFindingSchema),
    outputSchema: ResearchReportSchema,
    execute: async ({ abortSignal, inputData, mastra, requestContext }) => {
      const agent = mastra.getAgent("general");
      const sources = mergeResearchSources(inputData);
      const response = await agent.generate(config.synthesisPrompt(inputData), {
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
}
