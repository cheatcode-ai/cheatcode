import {
  DeleteFileInputSchema,
  DeleteFileOutputSchema,
  executeDeleteFile,
  executeGitClone,
  executeGitStatus,
  executeListFiles,
  executePreparedGitCommit,
  executePreparedGitPush,
  executePreparedStartDevServer,
  executeReadFile,
  executeRunCode,
  executeSearchFiles,
  executeShellExec,
  executeShellKillProcess,
  executeShellStartProcess,
  executeShellTerminal,
  executeWriteFile,
  GitCloneInputSchema,
  GitCommitInputSchema,
  GitPushInputSchema,
  GitStatusInputSchema,
  ListFilesInputSchema,
  ListFilesOutputSchema,
  prepareGitCommit,
  prepareGitPush,
  prepareStartDevServer,
  ReadFileInputSchema,
  ReadFileOutputSchema,
  RunCodeInputSchema,
  RunCodeOutputSchema,
  SearchFilesInputSchema,
  SearchFilesOutputSchema,
  ShellExecInputSchema,
  ShellExecOutputSchema,
  ShellKillProcessInputSchema,
  ShellKillProcessOutputSchema,
  ShellProcessOutputSchema,
  ShellStartProcessInputSchema,
  ShellTerminalInputSchema,
  WriteFileInputSchema,
  WriteFileOutputSchema,
} from "@cheatcode/tools-code";
import { createTool } from "@mastra/core/tools";
import { codeRuntimeFromContext, workspaceRuntimeFromContext } from "./tool-runtime-context";
import { startDevServerInputSchema, startDevServerOutputSchema } from "./tool-schemas";

export const mastraRunCode = createTool({
  id: "runCode",
  description:
    "Run a short, self-contained Python or JavaScript snippet inline in the sandbox for a quick throwaway computation. It cannot install packages or save files. For real project code, generated files, or anything needing dependencies, use fs_write plus shell_exec instead.",
  inputSchema: RunCodeInputSchema,
  outputSchema: RunCodeOutputSchema,
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
    "Run a deterministic sandbox command in argv form. Omit cwd for projectless browser, skill-runtime, or environment-inspection commands. For any command that reads, creates, or changes persistent project files, set cwd to /workspace; that explicitly attaches the project and maps /workspace to its persistent folder.",
  inputSchema: ShellExecInputSchema,
  outputSchema: ShellExecOutputSchema,
  execute: async (input, context) => {
    const parsedInput = ShellExecInputSchema.parse(input);
    const baseRuntime = codeRuntimeFromContext(context);
    const runtimeContext =
      baseRuntime.workspaceDir || parsedInput.cwd
        ? await workspaceRuntimeFromContext(context)
        : { ...baseRuntime, workspaceDir: "/workspace" };
    return executeShellExec(parsedInput, runtimeContext);
  },
});

export const mastraShellStartProcess = createTool({
  id: "shell_start_process",
  description:
    "Start a long-running process under /workspace in the project sandbox with optional port readiness and restart policy.",
  inputSchema: ShellStartProcessInputSchema,
  outputSchema: ShellProcessOutputSchema,
  execute: async (input, context) => {
    const parsedInput = ShellStartProcessInputSchema.parse(input);
    const runtimeContext = await workspaceRuntimeFromContext(context);
    return executeShellStartProcess(parsedInput, runtimeContext);
  },
});

export const mastraShellKillProcess = createTool({
  id: "shell_kill_process",
  description: "Kill a named long-running sandbox process.",
  inputSchema: ShellKillProcessInputSchema,
  outputSchema: ShellKillProcessOutputSchema,
  execute: async (input, context) =>
    executeShellKillProcess(
      ShellKillProcessInputSchema.parse(input),
      await workspaceRuntimeFromContext(context),
    ),
});

export const mastraShellTerminal = createTool({
  id: "shell_terminal",
  description:
    "Run a short terminal-style command in /workspace. Prefer shell_exec for deterministic argv automation.",
  inputSchema: ShellTerminalInputSchema,
  outputSchema: ShellExecOutputSchema,
  execute: async (input, context) => {
    const parsedInput = ShellTerminalInputSchema.parse(input);
    const runtimeContext = await workspaceRuntimeFromContext(context);
    return executeShellTerminal(parsedInput, runtimeContext);
  },
});

export const mastraFsRead = createTool({
  id: "fs_read",
  description:
    "Read a file under /workspace in the project sandbox. Use fs_list first if unsure of paths.",
  inputSchema: ReadFileInputSchema,
  outputSchema: ReadFileOutputSchema,
  execute: async (input, context) =>
    executeReadFile(input, await workspaceRuntimeFromContext(context)),
});

export const mastraFsWrite = createTool({
  id: "fs_write",
  description:
    "Write a file under /workspace in the project sandbox. Use for code edits and generated files.",
  inputSchema: WriteFileInputSchema,
  outputSchema: WriteFileOutputSchema,
  execute: async (input, context) =>
    executeWriteFile(input, await workspaceRuntimeFromContext(context)),
});

export const mastraFsList = createTool({
  id: "fs_list",
  description: "List files under /workspace in the project sandbox, optionally recursively.",
  inputSchema: ListFilesInputSchema,
  outputSchema: ListFilesOutputSchema,
  execute: async (input, context) =>
    executeListFiles(input, await workspaceRuntimeFromContext(context)),
});

export const mastraFsSearch = createTool({
  id: "fs_search",
  description: "Search file contents under /workspace in the project sandbox using ripgrep/grep.",
  inputSchema: SearchFilesInputSchema,
  outputSchema: SearchFilesOutputSchema,
  execute: async (input, context) =>
    executeSearchFiles(input, await workspaceRuntimeFromContext(context)),
});

export const mastraFsDelete = createTool({
  id: "fs_delete",
  description: "Delete a file or directory inside /workspace in the project sandbox.",
  inputSchema: DeleteFileInputSchema,
  outputSchema: DeleteFileOutputSchema,
  execute: async (input, context) => {
    const parsedInput = DeleteFileInputSchema.parse(input);
    const runtimeContext = await workspaceRuntimeFromContext(context);
    return executeDeleteFile(parsedInput, runtimeContext);
  },
});

export const mastraGitStatus = createTool({
  id: "git_status",
  description: "Run git status in a sandbox repository under /workspace.",
  inputSchema: GitStatusInputSchema,
  outputSchema: ShellExecOutputSchema,
  execute: async (input, context) =>
    executeGitStatus(GitStatusInputSchema.parse(input), await workspaceRuntimeFromContext(context)),
});

export const mastraGitClone = createTool({
  id: "git_clone",
  description: "Clone a git repository into a relative directory under /workspace.",
  inputSchema: GitCloneInputSchema,
  outputSchema: ShellExecOutputSchema,
  execute: async (input, context) => {
    const parsedInput = GitCloneInputSchema.parse(input);
    const runtimeContext = await workspaceRuntimeFromContext(context);
    return executeGitClone(parsedInput, runtimeContext);
  },
});

export const mastraGitCommit = createTool({
  id: "git_commit",
  description: "Create a git commit from all current sandbox repository changes under /workspace.",
  inputSchema: GitCommitInputSchema,
  outputSchema: ShellExecOutputSchema,
  execute: async (input, context) => {
    const parsedInput = GitCommitInputSchema.parse(input);
    const runtimeContext = await workspaceRuntimeFromContext(context);
    return executePreparedGitCommit(prepareGitCommit(parsedInput, runtimeContext), runtimeContext);
  },
});

export const mastraGitPush = createTool({
  id: "git_push",
  description: "Push sandbox repository commits from a repository under /workspace.",
  inputSchema: GitPushInputSchema,
  outputSchema: ShellExecOutputSchema,
  execute: async (input, context) => {
    const parsedInput = GitPushInputSchema.parse(input);
    const runtimeContext = await workspaceRuntimeFromContext(context);
    return executePreparedGitPush(
      await prepareGitPush(parsedInput, runtimeContext),
      runtimeContext,
    );
  },
});

export const mastraStartDevServer = createTool({
  id: "start_dev_server",
  description:
    "Start a managed long-running dev server under /workspace. Returns only process readiness and the internal port; the user opens the authenticated preview from the Computer panel.",
  inputSchema: startDevServerInputSchema,
  outputSchema: startDevServerOutputSchema,
  execute: async (input, context) => {
    const parsedInput = startDevServerInputSchema.parse(input);
    const runtimeContext = await workspaceRuntimeFromContext(context);
    return executePreparedStartDevServer(
      await prepareStartDevServer(parsedInput, runtimeContext),
      runtimeContext,
    );
  },
});
