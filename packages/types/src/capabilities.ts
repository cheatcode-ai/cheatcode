import type { AgentSummary, ToolSummary } from "./api";

/**
 * Public tool discovery contract. The Mastra runtime registry is statically
 * constrained to this exact name set, so adding or removing a live tool must
 * update discovery in the same change.
 */
export const TOOL_CAPABILITIES = [
  tool("browser", "browser_act", "Perform a Stagehand browser action."),
  tool("browser", "browser_extract", "Extract structured browser data."),
  tool("browser", "browser_observe", "Observe current browser state."),
  tool("browser", "browser_open", "Open a URL in the sandbox browser."),
  tool("browser", "browser_screenshot", "Capture a sandbox browser screenshot."),
  tool("code", "fs_delete", "Delete workspace files or directories."),
  tool("code", "fs_list", "List project sandbox files."),
  tool("code", "fs_read", "Read a file from the project sandbox."),
  tool("code", "fs_search", "Search sandbox file contents."),
  tool("code", "fs_write", "Write a file in the project sandbox."),
  tool("code", "git_clone", "Clone a git repository into the sandbox."),
  tool("code", "git_commit", "Commit sandbox repository changes."),
  tool("code", "git_push", "Push sandbox repository changes."),
  tool("code", "git_status", "Inspect sandbox git status."),
  tool("code", "runCode", "Execute short Python or Node programs inside the sandbox."),
  tool("code", "shell_exec", "Run an argv-form sandbox command."),
  tool("code", "shell_kill_process", "Kill a named sandbox process."),
  tool("code", "shell_start_process", "Start a long-running sandbox process."),
  tool("code", "shell_terminal", "Run a short terminal-style command."),
  tool("data", "data_analyze_csv", "Profile and summarize CSV data."),
  tool("data", "data_chart", "Render an accessible SVG chart artifact."),
  tool("data", "data_scrape_to_csv", "Normalize extracted records to CSV."),
  tool("docs", "docs_generate_docx", "Generate a signed DOCX artifact."),
  tool("docs", "docs_generate_pdf", "Generate a signed PDF artifact."),
  tool("docs", "docs_generate_slides", "Generate a signed PPTX artifact."),
  tool("docs", "docs_generate_xlsx", "Generate a signed XLSX artifact."),
  tool(
    "integrations",
    "composio_execute",
    "Execute an action in one of the user's connected apps.",
  ),
  tool(
    "integrations",
    "composio_list_tools",
    "Discover actions available in the user's connected apps.",
  ),
  tool("research", "firecrawl_extract", "Extract structured data with Firecrawl."),
  tool("research", "firecrawl_scrape", "Scrape a known URL with Firecrawl."),
  tool("research", "firecrawl_search", "Search and scrape with Firecrawl."),
  tool("research", "research_competitor", "Run the competitor research workflow."),
  tool("research", "research_deep", "Run the deep research workflow."),
  tool("research", "research_fanout", "Run the deep research fan-out workflow."),
  tool("research", "search_company", "Search company intel with Exa."),
  tool("research", "search_web", "Search the web with Exa."),
  tool("research", "search_web_advanced", "Search the web with Exa filters."),
  tool("sandbox", "start_dev_server", "Start a managed sandbox development server."),
  tool("skills", "skill_create", "Create or update a user-authored reusable skill."),
  tool("skills", "skill_invoke", "Load bundled skill instructions."),
  tool("skills", "skill_read_reference", "Read a bundled skill reference."),
] as const satisfies readonly ToolSummary[];

/** Exact names accepted by the live Mastra tool registry. */
export type ToolCapabilityName = (typeof TOOL_CAPABILITIES)[number]["name"];

/**
 * Public agent discovery contract. Workflows remain discoverable through their
 * tool capabilities and are intentionally not represented as Mastra agents.
 */
export const AGENT_CAPABILITIES = [
  {
    description: "General Cheatcode agent with sandbox, research, browser, and artifact tools.",
    name: "general",
  },
] as const satisfies readonly AgentSummary[];

/** Exact names accepted by the live Mastra agent registry. */
export type AgentCapabilityName = (typeof AGENT_CAPABILITIES)[number]["name"];

function tool<
  const Domain extends ToolSummary["domain"],
  const Name extends string,
  const Description extends string,
>(domain: Domain, name: Name, description: Description) {
  return { description, domain, name };
}
