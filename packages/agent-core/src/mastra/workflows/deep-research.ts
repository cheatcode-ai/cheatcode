import { createDeepResearchWorkflow } from "./deep-research-workflow";
import { buildDeepResearchQueries } from "./research-support";

export const deepResearch = createDeepResearchWorkflow({
  buildQueries: (input) => buildDeepResearchQueries(input.topic, input.maxQueries),
  kind: "deep",
  queryPrompt: deepResearchPrompt,
  synthesisPrompt: (findings) => synthesisPrompt("deep research brief", findings),
});

function deepResearchPrompt(query: string): string {
  return [
    "Run a focused research pass for the query below.",
    "Use search_web_advanced for discovery and search_scrape for source pages that need extraction.",
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
