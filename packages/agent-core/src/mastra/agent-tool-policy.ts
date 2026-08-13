import type { ToolCapabilityName } from "@cheatcode/types";
import type { ProjectMode, RunIntent } from "@cheatcode/types/api";
import type { IntegrationName } from "@cheatcode/types/integrations";

interface AgentToolPolicyInput {
  projectMode: ProjectMode;
  runIntent?: RunIntent;
  selectedTool?: IntegrationName;
  usesManagedPreview: boolean;
}

type AgentToolPolicy =
  | { excludedTools: readonly ToolCapabilityName[] }
  | { includedTools: readonly ToolCapabilityName[] }
  | Record<string, never>;

const SKILL_CREATOR_TOOLS = [
  "fs_apply",
  "fs_delete",
  "fs_list",
  "fs_read",
  "fs_search",
  "fs_write",
  "shell_exec",
  "skill_create",
] as const satisfies readonly ToolCapabilityName[];

const FILE_AND_ARTIFACT_TOOLS = [
  "fs_apply",
  "fs_delete",
  "fs_list",
  "fs_read",
  "fs_search",
  "fs_write",
  "code_run",
  "shell_exec",
  "shell_terminal",
  "deliverable_publish",
  "skill_invoke",
  "skill_read_reference",
] as const satisfies readonly ToolCapabilityName[];

const DATA_TOOLS = [
  "data_analyze_csv",
  "data_chart",
  "data_scrape_to_csv",
  "docs_generate_xlsx",
] as const satisfies readonly ToolCapabilityName[];

const DOCUMENT_TOOLS = [
  "docs_generate_docx",
  "docs_generate_pdf",
  "docs_generate_slides",
  "docs_generate_xlsx",
] as const satisfies readonly ToolCapabilityName[];

const MEDIA_TOOLS = ["generate_or_edit_media"] as const satisfies readonly ToolCapabilityName[];

const RESEARCH_TOOLS = [
  "search_extract",
  "search_scrape",
  "search_web_content",
  "research_deep",
  "research_fanout",
  "search_company",
  "search_web",
  "search_web_advanced",
] as const satisfies readonly ToolCapabilityName[];

const CONNECTED_APP_TOOLS = [
  "composio_execute",
  "composio_list_tools",
] as const satisfies readonly ToolCapabilityName[];

/**
 * Converts an explicit composer surface into the exact capability set offered to the model.
 * App-builder topology stays authoritative; general runs without an explicit surface retain the
 * full generalist registry. Non-app surfaces intentionally exclude browser, dev-server, git, and
 * background-process tools so an artifact request cannot drift into building a second product.
 */
export function resolveAgentToolPolicy(input: AgentToolPolicyInput): AgentToolPolicy {
  if (input.runIntent === "skill-creator") {
    return { includedTools: SKILL_CREATOR_TOOLS };
  }
  if (input.projectMode !== "general") {
    return input.usesManagedPreview ? { excludedTools: ["code_start_dev_server"] } : {};
  }
  const surfaceTools = toolsForNonAppIntent(input.runIntent);
  if (!surfaceTools) {
    return input.usesManagedPreview ? { excludedTools: ["code_start_dev_server"] } : {};
  }
  return {
    includedTools: uniqueTools(
      input.selectedTool ? [...surfaceTools, ...CONNECTED_APP_TOOLS] : surfaceTools,
    ),
  };
}

function toolsForNonAppIntent(
  runIntent: RunIntent | undefined,
): readonly ToolCapabilityName[] | null {
  if (runIntent === "documents" || runIntent === "slides") {
    return uniqueTools([
      ...FILE_AND_ARTIFACT_TOOLS,
      ...DOCUMENT_TOOLS,
      ...DATA_TOOLS,
      ...MEDIA_TOOLS,
      ...RESEARCH_TOOLS,
    ]);
  }
  if (runIntent === "data") {
    return uniqueTools([...FILE_AND_ARTIFACT_TOOLS, ...DATA_TOOLS, ...RESEARCH_TOOLS]);
  }
  if (runIntent === "research") {
    return uniqueTools([...FILE_AND_ARTIFACT_TOOLS, ...RESEARCH_TOOLS]);
  }
  if (runIntent === "media") {
    return uniqueTools([...FILE_AND_ARTIFACT_TOOLS, ...MEDIA_TOOLS]);
  }
  return null;
}

function uniqueTools(tools: readonly ToolCapabilityName[]): readonly ToolCapabilityName[] {
  return [...new Set(tools)];
}
