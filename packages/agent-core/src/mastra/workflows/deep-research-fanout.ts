import { createDeepResearchWorkflow } from "./deep-research-workflow";
import { buildFanoutQueries } from "./research-support";

export const deepResearchFanout = createDeepResearchWorkflow({
  buildQueries: buildFanoutQueries,
  kind: "fanout",
  synthesisPrompt: fanoutSynthesisPrompt,
});

function fanoutSynthesisPrompt(findings: unknown): string {
  return [
    "Synthesize the following parallel research findings into a comparison-oriented report.",
    "Include a comparison matrix when the findings cover multiple entities.",
    "Use only the source URLs present in the findings, and keep the report readable and evidence-bound.",
    "",
    JSON.stringify(findings, null, 2),
  ].join("\n");
}
