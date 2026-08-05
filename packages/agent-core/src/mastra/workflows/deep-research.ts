import { createDeepResearchWorkflow } from "./deep-research-workflow";
import { buildDeepResearchQueries } from "./research-support";

export const deepResearch = createDeepResearchWorkflow({
  buildQueries: (input) => buildDeepResearchQueries(input.topic, input.maxQueries),
  kind: "deep",
  synthesisPrompt: (findings) => synthesisPrompt("deep research brief", findings),
});

function synthesisPrompt(kind: string, findings: unknown): string {
  return [
    `Synthesize the following findings into a cited ${kind}.`,
    "Use only the source URLs present in the findings, and keep the report readable and evidence-bound.",
    "",
    JSON.stringify(findings, null, 2),
  ].join("\n");
}
