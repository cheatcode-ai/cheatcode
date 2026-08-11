import { createTool } from "@mastra/core/tools";
import {
  ApplyFileInputSchema,
  ApplyFileOutputSchema,
  DeleteFileInputSchema,
  DeleteFileOutputSchema,
  executeApplyFile,
  executeDeleteFile,
  executeGitClone,
  executeGitStatus,
  executeListFiles,
  executePreparedGitCommit,
  executePreparedGitPush,
  executePreparedStartDevServer,
  executePublishDeliverable,
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
  PublishDeliverableInputSchema,
  PublishDeliverableOutputSchema,
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
} from "../../tools/code";
import { containsWorkspaceReference } from "../../tools/code/workspace-paths";
import { assertAppBuilderShellCommandAllowed } from "./app-builder-shell-policy-support";
import { resolveMorphApplyRuntime } from "./request-context";
import {
  codeRuntimeFromContext,
  requestContextFromToolContext,
  workspaceRuntimeFromContext,
} from "./tool-runtime-context";
import { StartDevServerInputSchema, StartDevServerOutputSchema } from "./tool-schemas";

export const mastraRunCode = createTool({
  id: "code_run",
  description:
    "Run a short, self-contained Python or JavaScript snippet inline in the sandbox for a quick throwaway computation. It cannot install packages or save files. For real project code, use fs_apply/fs_write plus shell_exec instead.",
  inputSchema: RunCodeInputSchema,
  outputSchema: RunCodeOutputSchema,
  execute: async (input, context) => {
    const parsedInput = RunCodeInputSchema.parse(input);
    const baseRuntime = codeRuntimeFromContext(context);
    const runtimeContext =
      baseRuntime.workspaceDir || containsWorkspaceReference(parsedInput.code)
        ? await workspaceRuntimeFromContext(context)
        : baseRuntime;
    const output = await executeRunCode(parsedInput, runtimeContext);
    return RunCodeOutputSchema.parse(output);
  },
});

export const mastraShellExec = createTool({
  id: "shell_exec",
  description:
    "Run a bounded deterministic sandbox command in argv form; never use it to launch a user-facing dev server or background service. Use code_start_dev_server for Computer previews. Omit cwd for projectless browser, skill-runtime, or environment-inspection commands. For any command that reads, creates, or changes persistent project files, set cwd to /workspace; that explicitly attaches the project and maps /workspace to its persistent folder.",
  inputSchema: ShellExecInputSchema,
  outputSchema: ShellExecOutputSchema,
  execute: async (input, context) => {
    const parsedInput = ShellExecInputSchema.parse(input);
    assertAppBuilderShellCommandAllowed(context, parsedInput.command);
    const baseRuntime = codeRuntimeFromContext(context);
    const runtimeContext =
      baseRuntime.workspaceDir ||
      parsedInput.cwd ||
      parsedInput.command.some(containsWorkspaceReference)
        ? await workspaceRuntimeFromContext(context)
        : baseRuntime;
    return executeShellExec(parsedInput, runtimeContext);
  },
});

export const mastraShellStartProcess = createTool({
  id: "shell_start_process",
  description:
    "Start a non-preview background process under /workspace with optional port readiness and restart policy. Never use this for a web or mobile app the user should see in Computer; code_start_dev_server is the only tool that registers and restores that preview.",
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
    "Run a short foreground terminal-style command in /workspace. Never start a dev server or background process here; use code_start_dev_server for Computer previews. Prefer shell_exec for deterministic argv automation.",
  inputSchema: ShellTerminalInputSchema,
  outputSchema: ShellExecOutputSchema,
  execute: async (input, context) => {
    const parsedInput = ShellTerminalInputSchema.parse(input);
    assertAppBuilderShellCommandAllowed(context, parsedInput.command);
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
    "Create a new file, write binary content, or deliberately regenerate an entire file under /workspace; every call requires both path and the complete content. Use fs_apply for every focused or multi-section edit to an existing text file. Never use fs_write merely as a fallback after fs_apply reports an infrastructure or stale-file error.",
  inputSchema: WriteFileInputSchema,
  outputSchema: WriteFileOutputSchema,
  execute: async (input, context) =>
    executeWriteFile(input, await workspaceRuntimeFromContext(context)),
});

export const mastraPublishDeliverable = createTool({
  id: "deliverable_publish",
  description:
    "Publish one finished file already created under /workspace as a durable user Deliverable. Use this once per requested output file when shell or file tools created the final artifact; document, chart, research, and media generators already publish their own outputs.",
  inputSchema: PublishDeliverableInputSchema,
  outputSchema: PublishDeliverableOutputSchema,
  execute: async (input, context) =>
    executePublishDeliverable(input, await workspaceRuntimeFromContext(context)),
});

/** Applies a sparse model-authored edit to one existing text file without rewriting it wholesale. */
export const mastraFsApply = createTool({
  id: "fs_apply",
  description:
    "Edit an existing UTF-8 file under /workspace, including broad multi-section changes, by showing only the changed lines. Read the file first. ALWAYS use the exact // ... existing code ... marker for every unchanged section; omitting it deletes that section. Preserve indentation, include only enough surrounding context to locate each edit, and batch every change to the same file in one call. On a stale-file error, re-read and retry fs_apply. Use fs_write only for new files, binary files, or a genuinely intentional whole-file rewrite.",
  inputSchema: ApplyFileInputSchema,
  outputSchema: ApplyFileOutputSchema,
  execute: async (input, context) => {
    const requestContext = requestContextFromToolContext(context);
    return executeApplyFile(
      input,
      await workspaceRuntimeFromContext(context),
      await resolveMorphApplyRuntime(requestContext),
      context.abortSignal,
    );
  },
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
  id: "code_start_dev_server",
  description:
    "Start the managed web or mobile dev server shown in Computer. This is the only preview-registering server tool: it restores missing pnpm dependencies, assigns and enforces the project's stable internal host/port, reuses an identical healthy server, and restores it after sandbox idle stops. Do not run pnpm install merely to start an unchanged app. Returns only after readiness on the actual internal port.",
  inputSchema: StartDevServerInputSchema,
  outputSchema: StartDevServerOutputSchema,
  execute: async (input, context) => {
    const parsedInput = StartDevServerInputSchema.parse(input);
    const runtimeContext = await workspaceRuntimeFromContext(context);
    return executePreparedStartDevServer(
      await prepareStartDevServer(
        { ...parsedInput, shouldReuseMatchingProcess: true },
        runtimeContext,
      ),
      runtimeContext,
    );
  },
});
