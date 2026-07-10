import { AgentSummarySchema, ToolSummarySchema } from "@cheatcode/types";

const TOOL_SUMMARIES = [
  tool("code", "runCode", "Execute short Python or Node programs inside the sandbox."),
  tool("code", "fs_read", "Read a file from the project sandbox."),
  tool("code", "fs_write", "Write a file in the project sandbox."),
  tool("code", "fs_list", "List project sandbox files."),
  tool("code", "fs_search", "Search sandbox file contents."),
  tool("code", "fs_delete", "Delete workspace files or directories."),
  tool("code", "shell_exec", "Run an argv-form sandbox command."),
  tool("code", "shell_start_process", "Start a long-running sandbox process."),
  tool("code", "shell_kill_process", "Kill a named sandbox process."),
  tool("code", "shell_terminal", "Run a short terminal-style command."),
  tool("code", "git_status", "Inspect sandbox git status."),
  tool("code", "git_clone", "Clone a git repository into the sandbox."),
  tool("code", "git_commit", "Commit sandbox repository changes."),
  tool("code", "git_push", "Push sandbox repository changes."),
  tool("sandbox", "start_dev_server", "Start and expose a sandbox preview server."),
  tool("browser", "browser_open", "Open a URL in the sandbox browser."),
  tool("browser", "browser_act", "Perform a Stagehand browser action."),
  tool("browser", "browser_observe", "Observe current browser state."),
  tool("browser", "browser_extract", "Extract structured browser data."),
  tool("browser", "browser_screenshot", "Capture a sandbox browser screenshot."),
  tool("docs", "docs_generate_slides", "Generate a signed PPTX artifact."),
  tool("docs", "docs_generate_pdf", "Generate a signed PDF artifact."),
  tool("docs", "docs_generate_xlsx", "Generate a signed XLSX artifact."),
  tool("docs", "docs_generate_docx", "Generate a signed DOCX artifact."),
  tool("data", "data_analyze_csv", "Profile and summarize CSV data."),
  tool("data", "data_chart", "Render a Recharts SVG artifact."),
  tool("data", "data_scrape_to_csv", "Normalize extracted records to CSV."),
  tool("research", "search_web", "Search the web with Exa."),
  tool("research", "search_web_advanced", "Search the web with Exa filters."),
  tool("research", "search_company", "Search company intel with Exa."),
  tool("research", "firecrawl_scrape", "Scrape a known URL with Firecrawl."),
  tool("research", "firecrawl_search", "Search and scrape with Firecrawl."),
  tool("research", "firecrawl_extract", "Extract structured data with Firecrawl."),
  tool("research", "research_deep", "Run the deep research workflow."),
  tool("research", "research_fanout", "Run the deep research fan-out workflow."),
  tool("research", "research_competitor", "Run the competitor research workflow."),
  tool("skills", "skill_invoke", "Load bundled skill instructions."),
  tool("skills", "skill_read_reference", "Read a bundled skill reference."),
] as const;

const AGENT_SUMMARIES = [
  {
    description: "General Cheatcode agent with sandbox, research, browser, and artifact tools.",
    name: "general",
  },
  {
    description: "Deep research workflow for cited reports.",
    name: "deep-research",
  },
  {
    description: "Deep research fan-out workflow with bounded parallel subagents.",
    name: "deep-research-fanout",
  },
] as const;

function tool(domain: string, name: string, description: string) {
  return { description, domain, name };
}

export function listToolsRoute(domain: string | undefined): Response {
  const tools = domain ? TOOL_SUMMARIES.filter((tool) => tool.domain === domain) : TOOL_SUMMARIES;
  return Response.json(ToolSummarySchema.array().parse(tools));
}

export function listAgentsRoute(): Response {
  return Response.json(AgentSummarySchema.array().parse(AGENT_SUMMARIES));
}
