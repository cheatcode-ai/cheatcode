import { type BundledSkill, getSkillByName } from "@cheatcode/skills";
import {
  executeBrowserAct,
  executeBrowserExtract,
  executeBrowserObserve,
  executeBrowserOpen,
  executeBrowserScreenshot,
} from "@cheatcode/tools-browser";
import {
  CodeRuntimeContextSchema,
  DeleteFileInputSchema,
  DeleteFileOutputSchema,
  executeCreateSnapshot,
  executeDeleteFile,
  executeGitClone,
  executeGitCommit,
  executeGitPush,
  executeGitStatus,
  executeListFiles,
  executeReadFile,
  executeRestoreSnapshot,
  executeRunCode,
  executeSandboxCreate,
  executeSandboxDestroy,
  executeSearchFiles,
  executeShellExec,
  executeShellKillProcess,
  executeShellStartProcess,
  executeShellTerminal,
  executeStartDevServer,
  executeWriteFile,
  GitCloneInputSchema,
  GitPushInputSchema,
  GitStatusInputSchema,
  RestoreSnapshotInputSchema,
  RunCodeInputSchema,
  RunCodeOutputSchema,
  SandboxCreateInputSchema,
  SandboxCreateOutputSchema,
  SandboxDestroyInputSchema,
  SandboxDestroyOutputSchema,
  SearchFilesInputSchema,
  SearchFilesOutputSchema,
  ShellExecOutputSchema,
  ShellKillProcessInputSchema,
  ShellKillProcessOutputSchema,
  ShellProcessOutputSchema,
  ShellStartProcessInputSchema,
  ShellTerminalInputSchema,
} from "@cheatcode/tools-code";
import {
  AnalyzeCsvInputSchema,
  AnalyzeCsvOutputSchema,
  DataChartInputSchema,
  DataChartOutputSchema,
  DataScrapeToCsvInputSchema,
  DataScrapeToCsvOutputSchema,
  executeAnalyzeCsv,
  executeDataChart,
  executeDataScrapeToCsv,
} from "@cheatcode/tools-data";
import {
  executeGenerateDocx,
  executeGeneratePdf,
  executeGenerateSlides,
  executeGenerateXlsx,
  GenerateDocumentInputSchema,
  GenerateDocxOutputSchema,
  GeneratePdfOutputSchema,
  GenerateSlidesInputSchema,
  GenerateSlidesOutputSchema,
  GenerateSpreadsheetInputSchema,
  GenerateXlsxOutputSchema,
} from "@cheatcode/tools-docs";
import {
  ExaSearchInputSchema,
  ExaSearchOutputSchema,
  executeExaSearch,
  executeFirecrawlExtract,
  executeFirecrawlScrape,
  executeFirecrawlSearch,
  FirecrawlExtractInputSchema,
  FirecrawlExtractOutputSchema,
  FirecrawlScrapeInputSchema,
  FirecrawlScrapeOutputSchema,
  FirecrawlSearchInputSchema,
  FirecrawlSearchOutputSchema,
  ResearchRuntimeContextSchema,
} from "@cheatcode/tools-research";
import { createTool } from "@mastra/core/tools";
import {
  EXA_API_KEY_CONTEXT_KEY,
  FIRECRAWL_API_KEY_CONTEXT_KEY,
  RESEARCH_FANOUT_SUBAGENT_LIMIT_CONTEXT_KEY,
} from "../research-context";
import {
  DeepResearchFanoutInputSchema,
  DeepResearchInputSchema,
  type ResearchReport,
  ResearchReportSchema,
} from "../workflows";
import { browserRuntimeFromRequestContext } from "./browser-runtime";

export { mastraComposioExecute, mastraComposioListTools } from "./composio-tool";

import {
  browserActInputSchema,
  browserActionsOutputSchema,
  browserExtractInputSchema,
  browserObserveInputSchema,
  browserOpenInputSchema,
  browserScreenshotInputSchema,
  createSnapshotInputSchema,
  gitCloneInputSchema,
  gitCommitInputSchema,
  gitPushInputSchema,
  gitStatusInputSchema,
  listFilesInputSchema,
  listFilesOutputSchema,
  readFileInputSchema,
  readFileOutputSchema,
  restoreSnapshotInputSchema,
  restoreSnapshotOutputSchema,
  runCodeInputSchema,
  runCodeOutputSchema,
  shellExecInputSchema,
  shellOutputSchema,
  skillInvokeInputSchema,
  skillInvokeOutputSchema,
  skillReadReferenceInputSchema,
  skillReadReferenceOutputSchema,
  snapshotHandleSchema,
  startDevServerInputSchema,
  startDevServerOutputSchema,
  workflowResultSchema,
  writeFileInputSchema,
  writeFileOutputSchema,
} from "./tool-schemas";

const requestContextReaderSchema = {
  parse(value: unknown): { get(key: string): unknown } {
    if (!value || typeof value !== "object") {
      throw new Error("Mastra request context is required for runCode.");
    }
    const candidate = value as { get?: unknown };
    if (typeof candidate.get !== "function") {
      throw new Error("Mastra request context does not expose get().");
    }
    return candidate as { get(key: string): unknown };
  },
};

const RESEARCH_WORKFLOW_ACTIVE_CONTEXT_KEY = "researchWorkflowActive";

type RequestContextReader = { get(key: string): unknown };
type MutableRequestContext = RequestContextReader & {
  delete(key: string): boolean;
  has(key: string): boolean;
  set(key: string, value: unknown): void;
};
type WorkflowRunLike = {
  start(args: { inputData: unknown; requestContext?: unknown }): Promise<unknown>;
};
type WorkflowLike = {
  createRun(): Promise<WorkflowRunLike>;
};
type MastraWorkflowHost = {
  getWorkflow(workflowName: string): WorkflowLike;
};

function codeRuntimeFromContext(context: unknown) {
  const requestContext = requestContextFromToolContext(context);
  return CodeRuntimeContextSchema.parse(requestContext.get("codeRuntime"));
}

function requestContextFromToolContext(context: unknown): RequestContextReader {
  return requestContextReaderSchema.parse(
    typeof context === "object" && context !== null
      ? (context as { requestContext?: unknown }).requestContext
      : undefined,
  );
}

function mastraFromToolContext(context: unknown): MastraWorkflowHost {
  if (typeof context !== "object" || context === null) {
    throw new Error("Mastra tool context is required for workflow tools.");
  }
  const candidate = (context as { mastra?: unknown }).mastra;
  if (typeof candidate !== "object" || candidate === null) {
    throw new Error("Mastra instance is required for workflow tools.");
  }
  const getWorkflow = (candidate as { getWorkflow?: unknown }).getWorkflow;
  if (typeof getWorkflow !== "function") {
    throw new Error("Mastra instance does not expose getWorkflow().");
  }
  return candidate as MastraWorkflowHost;
}

function browserRuntimeFromContext(context: unknown) {
  const requestContext = requestContextFromToolContext(context);
  return browserRuntimeFromRequestContext(requestContext);
}

function researchRuntimeFromContext(context: unknown) {
  const requestContext = requestContextFromToolContext(context);
  return ResearchRuntimeContextSchema.parse({
    exaApiKey: requestContext.get(EXA_API_KEY_CONTEXT_KEY),
    firecrawlApiKey: requestContext.get(FIRECRAWL_API_KEY_CONTEXT_KEY),
  });
}

function requiredSkill(skillName: string): BundledSkill {
  const skill = getSkillByName(skillName);
  if (!skill) {
    throw new Error(`Bundled skill not found: ${skillName}`);
  }
  return skill;
}

function sortedRecordKeys(record: Record<string, string>): string[] {
  return Object.keys(record).sort();
}

async function runResearchWorkflow({
  context,
  inputData,
  workflowName,
}: {
  context: unknown;
  inputData: unknown;
  workflowName: "deepResearch" | "deepResearchFanout";
}): Promise<ResearchReport> {
  const requestContext = requestContextFromUnknownToolContext(context);
  if (researchWorkflowIsActive(requestContext)) {
    throw new Error("Nested research workflows are not allowed.");
  }
  const normalizedInput =
    workflowName === "deepResearchFanout"
      ? enforceResearchFanoutLimit(inputData, requestContext)
      : inputData;
  const workflow = mastraFromToolContext(context).getWorkflow(workflowName);
  const run = await workflow.createRun();
  const cleanupResearchFlag = markResearchWorkflowActive(requestContext);
  try {
    const result = workflowResultSchema.parse(
      await run.start({
        inputData: normalizedInput,
        ...(requestContext ? { requestContext } : {}),
      }),
    );
    if (result.status !== "success" || !result.result) {
      const message =
        result.error instanceof Error ? result.error.message : `${workflowName} workflow failed.`;
      throw new Error(message);
    }
    return ResearchReportSchema.parse(result.result);
  } finally {
    cleanupResearchFlag();
  }
}

function requestContextFromUnknownToolContext(context: unknown): unknown {
  return typeof context === "object" && context !== null
    ? (context as { requestContext?: unknown }).requestContext
    : undefined;
}

function researchWorkflowIsActive(requestContext: unknown): boolean {
  return mutableRequestContext(requestContext)?.get(RESEARCH_WORKFLOW_ACTIVE_CONTEXT_KEY) === true;
}

function markResearchWorkflowActive(requestContext: unknown): () => void {
  const mutableContext = mutableRequestContext(requestContext);
  if (!mutableContext) {
    return () => undefined;
  }
  const hadPrevious = mutableContext.has(RESEARCH_WORKFLOW_ACTIVE_CONTEXT_KEY);
  const previous = mutableContext.get(RESEARCH_WORKFLOW_ACTIVE_CONTEXT_KEY);
  mutableContext.set(RESEARCH_WORKFLOW_ACTIVE_CONTEXT_KEY, true);
  return () => {
    if (hadPrevious) {
      mutableContext.set(RESEARCH_WORKFLOW_ACTIVE_CONTEXT_KEY, previous);
      return;
    }
    mutableContext.delete(RESEARCH_WORKFLOW_ACTIVE_CONTEXT_KEY);
  };
}

function mutableRequestContext(value: unknown): MutableRequestContext | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const candidate = value as {
    delete?: unknown;
    get?: unknown;
    has?: unknown;
    set?: unknown;
  };
  if (
    typeof candidate.delete === "function" &&
    typeof candidate.get === "function" &&
    typeof candidate.has === "function" &&
    typeof candidate.set === "function"
  ) {
    return candidate as MutableRequestContext;
  }
  return null;
}

function enforceResearchFanoutLimit(inputData: unknown, requestContext: unknown): unknown {
  const input = DeepResearchFanoutInputSchema.parse(inputData);
  const limit = researchFanoutLimitFromContext(requestContext);
  const requested = input.entities
    ? Math.min(input.entities.length, input.maxQueries)
    : input.maxQueries;
  if (requested <= limit) {
    return input;
  }
  throw new Error(
    `Research fan-out requested ${requested} subagents, but this plan allows ${limit} per run.`,
  );
}

function researchFanoutLimitFromContext(requestContext: unknown): number {
  if (!requestContext || typeof requestContext !== "object") {
    return 3;
  }
  const get = (requestContext as { get?: unknown }).get;
  if (typeof get !== "function") {
    return 3;
  }
  const value = get.call(requestContext, RESEARCH_FANOUT_SUBAGENT_LIMIT_CONTEXT_KEY);
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 3;
}

export const mastraRunCode = createTool({
  id: "runCode",
  description:
    "Run Python or JavaScript code in the project sandbox. Use for deterministic code execution and data work.",
  inputSchema: runCodeInputSchema,
  outputSchema: runCodeOutputSchema,
  execute: async (input, context) => {
    const runtimeContext = codeRuntimeFromContext(context);
    const parsedInput = RunCodeInputSchema.parse(input);
    const output = await executeRunCode(parsedInput, runtimeContext);
    return RunCodeOutputSchema.parse(output);
  },
});

export const mastraShellExec = createTool({
  id: "shell_exec",
  description:
    "Run a shell command under /workspace in the project sandbox using argv form. Use for installs, builds, static checks, and deterministic CLI work.",
  inputSchema: shellExecInputSchema,
  outputSchema: shellOutputSchema,
  execute: async (input, context) => executeShellExec(input, codeRuntimeFromContext(context)),
});

export const mastraShellStartProcess = createTool({
  id: "shell_start_process",
  description:
    "Start a long-running process under /workspace in the project sandbox with optional port readiness and restart policy.",
  inputSchema: ShellStartProcessInputSchema,
  outputSchema: ShellProcessOutputSchema,
  execute: async (input, context) =>
    executeShellStartProcess(input, codeRuntimeFromContext(context)),
});

export const mastraShellKillProcess = createTool({
  id: "shell_kill_process",
  description: "Kill a named long-running sandbox process.",
  inputSchema: ShellKillProcessInputSchema,
  outputSchema: ShellKillProcessOutputSchema,
  execute: async (input, context) =>
    executeShellKillProcess(input, codeRuntimeFromContext(context)),
});

export const mastraShellTerminal = createTool({
  id: "shell_terminal",
  description:
    "Run a short terminal-style command in /workspace. Prefer shell_exec for deterministic argv automation.",
  inputSchema: ShellTerminalInputSchema,
  outputSchema: ShellExecOutputSchema,
  execute: async (input, context) => executeShellTerminal(input, codeRuntimeFromContext(context)),
});

export const mastraFsRead = createTool({
  id: "fs_read",
  description:
    "Read a file under /workspace in the project sandbox. Use fs_list first if unsure of paths.",
  inputSchema: readFileInputSchema,
  outputSchema: readFileOutputSchema,
  execute: async (input, context) => executeReadFile(input, codeRuntimeFromContext(context)),
});

export const mastraFsWrite = createTool({
  id: "fs_write",
  description:
    "Write a file under /workspace in the project sandbox. Use for code edits and generated files.",
  inputSchema: writeFileInputSchema,
  outputSchema: writeFileOutputSchema,
  execute: async (input, context) => executeWriteFile(input, codeRuntimeFromContext(context)),
});

export const mastraFsList = createTool({
  id: "fs_list",
  description: "List files under /workspace in the project sandbox, optionally recursively.",
  inputSchema: listFilesInputSchema,
  outputSchema: listFilesOutputSchema,
  execute: async (input, context) => executeListFiles(input, codeRuntimeFromContext(context)),
});

export const mastraFsSearch = createTool({
  id: "fs_search",
  description: "Search file contents under /workspace in the project sandbox using ripgrep/grep.",
  inputSchema: SearchFilesInputSchema,
  outputSchema: SearchFilesOutputSchema,
  execute: async (input, context) => executeSearchFiles(input, codeRuntimeFromContext(context)),
});

export const mastraFsDelete = createTool({
  id: "fs_delete",
  description: "Delete a file or directory inside /workspace in the project sandbox.",
  inputSchema: DeleteFileInputSchema,
  outputSchema: DeleteFileOutputSchema,
  execute: async (input, context) => executeDeleteFile(input, codeRuntimeFromContext(context)),
});

export const mastraGitStatus = createTool({
  id: "git_status",
  description: "Run git status in a sandbox repository under /workspace.",
  inputSchema: gitStatusInputSchema,
  outputSchema: shellOutputSchema,
  execute: async (input, context) =>
    executeGitStatus(GitStatusInputSchema.parse(input), codeRuntimeFromContext(context)),
});

export const mastraGitClone = createTool({
  id: "git_clone",
  description: "Clone a git repository into a relative directory under /workspace.",
  inputSchema: gitCloneInputSchema,
  outputSchema: shellOutputSchema,
  execute: async (input, context) =>
    executeGitClone(GitCloneInputSchema.parse(input), codeRuntimeFromContext(context)),
});

export const mastraGitCommit = createTool({
  id: "git_commit",
  description: "Create a git commit from all current sandbox repository changes under /workspace.",
  inputSchema: gitCommitInputSchema,
  outputSchema: shellOutputSchema,
  execute: async (input, context) => executeGitCommit(input, codeRuntimeFromContext(context)),
});

export const mastraGitPush = createTool({
  id: "git_push",
  description: "Push sandbox repository commits from a repository under /workspace.",
  inputSchema: gitPushInputSchema,
  outputSchema: shellOutputSchema,
  execute: async (input, context) =>
    executeGitPush(GitPushInputSchema.parse(input), codeRuntimeFromContext(context)),
});

export const mastraStartDevServer = createTool({
  id: "start_dev_server",
  description:
    "Start a long-running dev server under /workspace and expose its HTTP port as a preview URL.",
  inputSchema: startDevServerInputSchema,
  outputSchema: startDevServerOutputSchema,
  execute: async (input, context) => executeStartDevServer(input, codeRuntimeFromContext(context)),
});

export const mastraSandboxCreate = createTool({
  id: "sandbox_create",
  description: "Create or wake the project sandbox and return readiness status.",
  inputSchema: SandboxCreateInputSchema,
  outputSchema: SandboxCreateOutputSchema,
  execute: async (input, context) => executeSandboxCreate(input, codeRuntimeFromContext(context)),
});

export const mastraSandboxDestroy = createTool({
  id: "sandbox_destroy",
  description: "Delete the project sandbox for explicit project cleanup.",
  inputSchema: SandboxDestroyInputSchema,
  outputSchema: SandboxDestroyOutputSchema,
  execute: async (input, context) => executeSandboxDestroy(input, codeRuntimeFromContext(context)),
});

export const mastraSandboxSnapshot = createTool({
  id: "sandbox_snapshot",
  description: "Return the current project's persistent Daytona sandbox handle.",
  inputSchema: createSnapshotInputSchema,
  outputSchema: snapshotHandleSchema,
  execute: async (input, context) => executeCreateSnapshot(input, codeRuntimeFromContext(context)),
});

export const mastraSandboxRestore = createTool({
  id: "sandbox_restore",
  description: "Reconnect the sandbox to a previously returned Daytona sandbox handle.",
  inputSchema: restoreSnapshotInputSchema,
  outputSchema: restoreSnapshotOutputSchema,
  execute: async (input, context) =>
    executeRestoreSnapshot(
      RestoreSnapshotInputSchema.parse(input),
      codeRuntimeFromContext(context),
    ),
});

export const mastraBrowserOpen = createTool({
  id: "browser_open",
  description:
    "Open a URL in the sandbox's local headed Chromium browser through Stagehand LOCAL mode.",
  inputSchema: browserOpenInputSchema,
  outputSchema: browserActionsOutputSchema,
  execute: async (input, context) => executeBrowserOpen(input, browserRuntimeFromContext(context)),
});

export const mastraBrowserAct = createTool({
  id: "browser_act",
  description:
    "Perform a natural-language browser action in the sandbox's local headed Chromium browser.",
  inputSchema: browserActInputSchema,
  outputSchema: browserActionsOutputSchema,
  execute: async (input, context) => executeBrowserAct(input, browserRuntimeFromContext(context)),
});

export const mastraBrowserObserve = createTool({
  id: "browser_observe",
  description:
    "Observe available UI elements or page state in the sandbox's local headed Chromium browser.",
  inputSchema: browserObserveInputSchema,
  outputSchema: browserActionsOutputSchema,
  execute: async (input, context) =>
    executeBrowserObserve(input, browserRuntimeFromContext(context)),
});

export const mastraBrowserExtract = createTool({
  id: "browser_extract",
  description:
    "Extract structured information from the current sandbox browser page with Stagehand LOCAL mode.",
  inputSchema: browserExtractInputSchema,
  outputSchema: browserActionsOutputSchema,
  execute: async (input, context) =>
    executeBrowserExtract(input, browserRuntimeFromContext(context)),
});

export const mastraBrowserScreenshot = createTool({
  id: "browser_screenshot",
  description: "Capture the current sandbox browser page as a PNG base64 artifact.",
  inputSchema: browserScreenshotInputSchema,
  outputSchema: browserActionsOutputSchema,
  execute: async (input, context) =>
    executeBrowserScreenshot(input, browserRuntimeFromContext(context)),
});

export const mastraDocsGenerateSlides = createTool({
  id: "docs_generate_slides",
  description:
    "Generate a PowerPoint deck from a structured title and slides. Returns a short-lived R2 download URL.",
  inputSchema: GenerateSlidesInputSchema,
  outputSchema: GenerateSlidesOutputSchema,
  execute: async (input, context) =>
    executeGenerateSlides(GenerateSlidesInputSchema.parse(input), codeRuntimeFromContext(context)),
});

export const mastraDocsGenerateDocx = createTool({
  id: "docs_generate_docx",
  description:
    "Generate a DOCX document from titled sections and paragraphs. Returns a short-lived R2 download URL.",
  inputSchema: GenerateDocumentInputSchema,
  outputSchema: GenerateDocxOutputSchema,
  execute: async (input, context) =>
    executeGenerateDocx(GenerateDocumentInputSchema.parse(input), codeRuntimeFromContext(context)),
});

export const mastraDocsGenerateXlsx = createTool({
  id: "docs_generate_xlsx",
  description:
    "Generate an XLSX workbook from sheets, columns, and rows. Returns a short-lived R2 download URL.",
  inputSchema: GenerateSpreadsheetInputSchema,
  outputSchema: GenerateXlsxOutputSchema,
  execute: async (input, context) =>
    executeGenerateXlsx(
      GenerateSpreadsheetInputSchema.parse(input),
      codeRuntimeFromContext(context),
    ),
});

export const mastraDocsGeneratePdf = createTool({
  id: "docs_generate_pdf",
  description:
    "Generate a PDF document from titled sections and paragraphs. Returns a short-lived R2 download URL.",
  inputSchema: GenerateDocumentInputSchema,
  outputSchema: GeneratePdfOutputSchema,
  execute: async (input, context) =>
    executeGeneratePdf(GenerateDocumentInputSchema.parse(input), codeRuntimeFromContext(context)),
});

export const mastraDataAnalyzeCsv = createTool({
  id: "data_analyze_csv",
  description:
    "Profile CSV text with Arquero parsing. Returns column types, missing counts, numeric summaries, top values, samples, and optional grouped aggregates.",
  inputSchema: AnalyzeCsvInputSchema,
  outputSchema: AnalyzeCsvOutputSchema,
  execute: async (input) => executeAnalyzeCsv(AnalyzeCsvInputSchema.parse(input)),
});

export const mastraDataChart = createTool({
  id: "data_chart",
  description:
    "Render a Recharts bar, line, or area chart from CSV or rows inside the project sandbox and return static SVG plus component source.",
  inputSchema: DataChartInputSchema,
  outputSchema: DataChartOutputSchema,
  execute: async (input, context) =>
    executeDataChart(DataChartInputSchema.parse(input), codeRuntimeFromContext(context)),
});

export const mastraDataScrapeToCsv = createTool({
  id: "data_scrape_to_csv",
  description:
    "Normalize Firecrawl/Exa extracted records or markdown tables into deterministic CSV with a preview.",
  inputSchema: DataScrapeToCsvInputSchema,
  outputSchema: DataScrapeToCsvOutputSchema,
  execute: async (input) => executeDataScrapeToCsv(DataScrapeToCsvInputSchema.parse(input)),
});

export const mastraSearchWeb = createTool({
  id: "search_web",
  description:
    "Search the web with Exa and return cited source snippets, highlights, and optional summaries.",
  inputSchema: ExaSearchInputSchema,
  outputSchema: ExaSearchOutputSchema,
  execute: async (input, context) =>
    executeExaSearch(ExaSearchInputSchema.parse(input), researchRuntimeFromContext(context)),
});

export const mastraSearchWebAdvanced = createTool({
  id: "search_web_advanced",
  description:
    "Run filtered Exa research search with domains, dates, categories, highlights, and summaries.",
  inputSchema: ExaSearchInputSchema,
  outputSchema: ExaSearchOutputSchema,
  execute: async (input, context) =>
    executeExaSearch(ExaSearchInputSchema.parse(input), researchRuntimeFromContext(context)),
});

export const mastraSearchCompany = createTool({
  id: "search_company",
  description:
    "Search Exa's company category for company intel, competitor analysis, and market research.",
  inputSchema: ExaSearchInputSchema,
  outputSchema: ExaSearchOutputSchema,
  execute: async (input, context) => {
    const parsedInput = ExaSearchInputSchema.parse(input);
    return executeExaSearch(
      { ...parsedInput, category: "company" },
      researchRuntimeFromContext(context),
    );
  },
});

export const mastraFirecrawlScrape = createTool({
  id: "firecrawl_scrape",
  description:
    "Scrape a known URL with Firecrawl and return markdown, links, metadata, or screenshots.",
  inputSchema: FirecrawlScrapeInputSchema,
  outputSchema: FirecrawlScrapeOutputSchema,
  execute: async (input, context) =>
    executeFirecrawlScrape(
      FirecrawlScrapeInputSchema.parse(input),
      researchRuntimeFromContext(context),
    ),
});

export const mastraFirecrawlSearch = createTool({
  id: "firecrawl_search",
  description:
    "Search the web with Firecrawl, optionally scraping markdown for each returned result.",
  inputSchema: FirecrawlSearchInputSchema,
  outputSchema: FirecrawlSearchOutputSchema,
  execute: async (input, context) =>
    executeFirecrawlSearch(
      FirecrawlSearchInputSchema.parse(input),
      researchRuntimeFromContext(context),
    ),
});

export const mastraFirecrawlExtract = createTool({
  id: "firecrawl_extract",
  description:
    "Extract structured JSON from one or more URLs with Firecrawl using a prompt and optional JSON schema.",
  inputSchema: FirecrawlExtractInputSchema,
  outputSchema: FirecrawlExtractOutputSchema,
  execute: async (input, context) =>
    executeFirecrawlExtract(
      FirecrawlExtractInputSchema.parse(input),
      researchRuntimeFromContext(context),
    ),
});

export const mastraDeepResearch = createTool({
  id: "research_deep",
  description:
    "Run the Deep Research workflow for a complex topic. It fans out focused research queries and returns a cited report.",
  inputSchema: DeepResearchInputSchema,
  outputSchema: ResearchReportSchema,
  execute: async (input, context) =>
    runResearchWorkflow({
      context,
      inputData: DeepResearchInputSchema.parse(input),
      workflowName: "deepResearch",
    }),
});

export const mastraResearchFanout = createTool({
  id: "research_fanout",
  description:
    "Run the Deep Research fan-out workflow across up to 25 entities or angles and return a comparison matrix style report.",
  inputSchema: DeepResearchFanoutInputSchema,
  outputSchema: ResearchReportSchema,
  execute: async (input, context) =>
    runResearchWorkflow({
      context,
      inputData: DeepResearchFanoutInputSchema.parse(input),
      workflowName: "deepResearchFanout",
    }),
});

export const mastraCompetitorResearch = createTool({
  id: "research_competitor",
  description:
    "Run the Deep Research fan-out workflow for competitor analysis and return a comparison matrix style report.",
  inputSchema: DeepResearchFanoutInputSchema,
  outputSchema: ResearchReportSchema,
  execute: async (input, context) =>
    runResearchWorkflow({
      context,
      inputData: DeepResearchFanoutInputSchema.parse(input),
      workflowName: "deepResearchFanout",
    }),
});

export const mastraSkillInvoke = createTool({
  id: "skill_invoke",
  description:
    "Load the full instructions for a bundled Cheatcode skill. Use when the request matches a listed skill description.",
  inputSchema: skillInvokeInputSchema,
  outputSchema: skillInvokeOutputSchema,
  execute: async (input) => {
    const parsedInput = skillInvokeInputSchema.parse(input);
    const skill = requiredSkill(parsedInput.skillName);
    return {
      assets: sortedRecordKeys(skill.assets),
      compatibility: skill.compatibility,
      description: skill.description,
      instructions: skill.body,
      license: skill.license,
      name: skill.name,
      references: sortedRecordKeys(skill.references),
    };
  },
});

export const mastraSkillReadReference = createTool({
  id: "skill_read_reference",
  description:
    "Read a reference file bundled with a Cheatcode skill after skill_invoke says it is available.",
  inputSchema: skillReadReferenceInputSchema,
  outputSchema: skillReadReferenceOutputSchema,
  execute: async (input) => {
    const parsedInput = skillReadReferenceInputSchema.parse(input);
    const skill = requiredSkill(parsedInput.skillName);
    return {
      content: skill.references[parsedInput.filename] ?? null,
      filename: parsedInput.filename,
      skillName: skill.name,
    };
  },
});
