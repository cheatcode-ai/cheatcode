import type { ToolSummary } from "./api";

const REMOTE_TOOL = { artifactPresentation: "none", usesSandbox: false } as const;
const SANDBOX_TOOL = { artifactPresentation: "none", usesSandbox: true } as const;
const DELIVERABLE_TOOL = { artifactPresentation: "deliverable", usesSandbox: true } as const;
const TOOL_EVIDENCE_TOOL = { artifactPresentation: "tool-evidence", usesSandbox: true } as const;

/**
 * Public tool discovery contract. The Mastra runtime registry is statically
 * constrained to this exact name set, so adding or removing a live tool must
 * update discovery in the same change.
 */
export const TOOL_CAPABILITIES = [
  tool("browser", "browser_act", "Execute an observed browser action.", SANDBOX_TOOL),
  tool("browser", "browser_extract", "Extract structured browser data.", SANDBOX_TOOL),
  tool("browser", "browser_observe", "Find executable browser actions.", SANDBOX_TOOL),
  tool("browser", "browser_open", "Open a URL in the sandbox browser.", SANDBOX_TOOL),
  tool(
    "browser",
    "browser_screenshot",
    "Capture a sandbox browser screenshot.",
    TOOL_EVIDENCE_TOOL,
  ),
  tool("code", "fs_apply", "Apply a focused edit to an existing workspace file.", SANDBOX_TOOL),
  tool("code", "fs_delete", "Delete workspace files or directories.", SANDBOX_TOOL),
  tool("code", "fs_list", "List project sandbox files.", SANDBOX_TOOL),
  tool("code", "fs_read", "Read a file from the project sandbox.", SANDBOX_TOOL),
  tool("code", "fs_search", "Search sandbox file contents.", SANDBOX_TOOL),
  tool("code", "fs_write", "Write a file in the project sandbox.", SANDBOX_TOOL),
  tool("code", "git_clone", "Clone a git repository into the sandbox.", SANDBOX_TOOL),
  tool("code", "git_commit", "Commit sandbox repository changes.", SANDBOX_TOOL),
  tool("code", "git_push", "Push sandbox repository changes.", SANDBOX_TOOL),
  tool("code", "git_status", "Inspect sandbox git status.", SANDBOX_TOOL),
  tool(
    "code",
    "code_run",
    "Execute short Python or Node programs inside the sandbox.",
    SANDBOX_TOOL,
  ),
  tool("code", "shell_exec", "Run an argv-form sandbox command.", SANDBOX_TOOL),
  tool("code", "shell_kill_process", "Kill a named sandbox process.", SANDBOX_TOOL),
  tool("code", "shell_start_process", "Start a long-running sandbox process.", SANDBOX_TOOL),
  tool("code", "shell_terminal", "Run a short terminal-style command.", SANDBOX_TOOL),
  tool("data", "data_analyze_csv", "Profile and summarize CSV data.", REMOTE_TOOL),
  tool("data", "data_chart", "Render an accessible SVG chart artifact.", DELIVERABLE_TOOL),
  tool("data", "data_scrape_to_csv", "Normalize extracted records to CSV.", REMOTE_TOOL),
  tool(
    "code",
    "deliverable_publish",
    "Publish a finished workspace file as a durable Deliverable.",
    DELIVERABLE_TOOL,
  ),
  tool("docs", "docs_generate_docx", "Generate a signed DOCX artifact.", DELIVERABLE_TOOL),
  tool("docs", "docs_generate_pdf", "Generate a signed PDF artifact.", DELIVERABLE_TOOL),
  tool("docs", "docs_generate_slides", "Generate a signed PPTX artifact.", DELIVERABLE_TOOL),
  tool("docs", "docs_generate_xlsx", "Generate a signed XLSX artifact.", DELIVERABLE_TOOL),
  tool(
    "data",
    "generate_or_edit_media",
    "Generate or edit an image or video artifact.",
    DELIVERABLE_TOOL,
  ),
  tool(
    "integrations",
    "composio_execute",
    "Execute an action in one of the user's connected apps.",
    REMOTE_TOOL,
  ),
  tool(
    "integrations",
    "composio_list_tools",
    "Discover actions available in the user's connected apps.",
    REMOTE_TOOL,
  ),
  tool("research", "search_extract", "Extract structured data with Firecrawl.", REMOTE_TOOL),
  tool("research", "search_scrape", "Scrape a known URL with Firecrawl.", REMOTE_TOOL),
  tool("research", "search_web_content", "Search and scrape with Firecrawl.", REMOTE_TOOL),
  tool(
    "research",
    "research_deep",
    "Run deep research and generate a cited PDF report.",
    DELIVERABLE_TOOL,
  ),
  tool(
    "research",
    "research_fanout",
    "Run deep research fan-out and generate a cited PDF report.",
    DELIVERABLE_TOOL,
  ),
  tool("research", "search_company", "Search company intel with Exa.", REMOTE_TOOL),
  tool("research", "search_web", "Search the web with Exa.", REMOTE_TOOL),
  tool("research", "search_web_advanced", "Search the web with Exa filters.", REMOTE_TOOL),
  tool(
    "sandbox",
    "code_start_dev_server",
    "Start a managed sandbox development server.",
    SANDBOX_TOOL,
  ),
  tool("skills", "skill_create", "Create or update a user-authored reusable skill.", REMOTE_TOOL),
  tool("skills", "skill_invoke", "Load bundled skill instructions.", REMOTE_TOOL),
  tool("skills", "skill_read_reference", "Read a bundled skill reference.", REMOTE_TOOL),
] as const satisfies readonly ToolSummary[];

/** Exact names accepted by the live Mastra tool registry. */
export type ToolCapabilityName = (typeof TOOL_CAPABILITIES)[number]["name"];

/** Exact names accepted by the live Mastra agent registry. */
export type AgentCapabilityName = "general";

function tool<
  const Domain extends ToolSummary["domain"],
  const Name extends string,
  const Description extends string,
>(
  domain: Domain,
  name: Name,
  description: Description,
  runtime: Pick<ToolSummary, "artifactPresentation" | "usesSandbox">,
) {
  return { description, domain, name, ...runtime };
}
