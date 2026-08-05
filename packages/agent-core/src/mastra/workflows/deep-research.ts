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
    "Analyze the focused provider evidence pack for the query below.",
    "Return structured claims only from that evidence. Cite every claim with the exact Exa result ID and URL or exact Firecrawl URL present in the pack.",
    "Do not infer citation IDs from prose and do not cite a URL that no tool returned.",
    "",
    `Query: ${query}`,
  ].join("\n");
}

function synthesisPrompt(kind: string, findings: unknown): string {
  return [
    `Synthesize the following findings into a cited ${kind}.`,
    "Use only the source URLs present in the findings, and keep the report readable and evidence-bound.",
    "",
    JSON.stringify(findings, null, 2),
  ].join("\n");
}
