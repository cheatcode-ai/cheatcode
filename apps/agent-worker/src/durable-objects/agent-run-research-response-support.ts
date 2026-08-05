import { z } from "zod";

const RESEARCH_REPORT_TOOL_NAMES = new Set(["research_deep", "research_fanout"]);
const ResearchReportToolOutputSchema = z.strictObject({
  artifact: z.unknown(),
  report: z.string().trim().min(1).max(20_000),
});

interface ToolCallLike {
  toolName: string;
}

interface ToolResultLike {
  error?: string | undefined;
  output?: unknown;
  toolCall: ToolCallLike;
}

export function isResearchReportTool(toolName: string): boolean {
  return RESEARCH_REPORT_TOOL_NAMES.has(toolName);
}

/** Returns the validated canonical response for a successful terminal research tool. */
export function canonicalResearchReport(result: ToolResultLike): string | undefined {
  if (result.error || !isResearchReportTool(result.toolCall.toolName)) {
    return undefined;
  }
  return ResearchReportToolOutputSchema.parse(result.output).report;
}
