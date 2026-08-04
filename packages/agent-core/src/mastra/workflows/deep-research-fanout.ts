import { createDeepResearchWorkflow } from "./deep-research-workflow";
import { buildFanoutQueries } from "./research-support";

export const deepResearchFanout = createDeepResearchWorkflow({
  buildQueries: buildFanoutQueries,
  kind: "fanout",
  queryPrompt: fanoutResearchPrompt,
  synthesisPrompt: fanoutSynthesisPrompt,
});

function fanoutResearchPrompt(query: string): string {
  return [
    "Analyze the breadth-first provider evidence pack for the query below.",
    "Return structured claims only from that evidence. Cite every claim with the exact Exa result ID and URL or exact Firecrawl URL present in the pack.",
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
