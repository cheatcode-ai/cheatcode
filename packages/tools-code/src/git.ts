import { tool } from "ai";
import { z } from "zod";
import { getCodeRuntimeContext } from "./runtime";
import { executeShellExec, ShellExecOutputSchema } from "./shell";
import { WorkspacePathSchema, WorkspaceRelativePathSchema } from "./workspace-paths";

export const GitStatusInputSchema = z
  .object({
    cwd: WorkspacePathSchema.default("/workspace"),
  })
  .strict();

export const GitCloneInputSchema = z
  .object({
    repoUrl: z.string().url(),
    targetDir: WorkspaceRelativePathSchema,
    branch: z.string().min(1).max(200).optional(),
    depth: z.number().int().positive().max(1000).default(1),
  })
  .strict();

export const GitCommitInputSchema = z
  .object({
    cwd: WorkspacePathSchema,
    message: z.string().min(1).max(500),
  })
  .strict();

export const GitPushInputSchema = z
  .object({
    cwd: WorkspacePathSchema,
    remote: z.string().min(1).max(100).default("origin"),
    branch: z.string().min(1).max(200).optional(),
  })
  .strict();

export const GitOutputSchema = ShellExecOutputSchema;

export type GitStatusInput = z.infer<typeof GitStatusInputSchema>;
export type GitCloneInput = z.infer<typeof GitCloneInputSchema>;
export type GitCommitInput = z.infer<typeof GitCommitInputSchema>;
export type GitPushInput = z.infer<typeof GitPushInputSchema>;
export type GitOutput = z.infer<typeof GitOutputSchema>;

export async function executeGitStatus(
  input: GitStatusInput,
  runtimeContext: ReturnType<typeof getCodeRuntimeContext>,
): Promise<GitOutput> {
  return executeShellExec(
    { command: ["git", "status", "--short", "--branch"], cwd: input.cwd },
    runtimeContext,
  );
}

export async function executeGitClone(
  input: GitCloneInput,
  runtimeContext: ReturnType<typeof getCodeRuntimeContext>,
): Promise<GitOutput> {
  const command = [
    "git",
    "clone",
    "--depth",
    String(input.depth),
    ...(input.branch ? ["--branch", input.branch] : []),
    input.repoUrl,
    input.targetDir,
  ];
  return executeShellExec({ command, cwd: "/workspace", timeoutMs: 300_000 }, runtimeContext);
}

export async function executeGitCommit(
  input: GitCommitInput,
  runtimeContext: ReturnType<typeof getCodeRuntimeContext>,
): Promise<GitOutput> {
  await executeShellExec({ command: ["git", "add", "-A"], cwd: input.cwd }, runtimeContext);
  return executeShellExec(
    { command: ["git", "commit", "-m", input.message], cwd: input.cwd },
    runtimeContext,
  );
}

export async function executeGitPush(
  input: GitPushInput,
  runtimeContext: ReturnType<typeof getCodeRuntimeContext>,
): Promise<GitOutput> {
  const command = ["git", "push", input.remote, ...(input.branch ? [input.branch] : [])];
  return executeShellExec({ command, cwd: input.cwd, timeoutMs: 300_000 }, runtimeContext);
}

export const gitStatus = tool({
  description: "Run git status in a sandbox repository under /workspace.",
  inputSchema: GitStatusInputSchema,
  outputSchema: GitOutputSchema,
  execute: async (input, options: unknown) =>
    executeGitStatus(input, getCodeRuntimeContext(options)),
});

export const gitClone = tool({
  description: "Clone a git repository into a relative directory under /workspace.",
  inputSchema: GitCloneInputSchema,
  outputSchema: GitOutputSchema,
  execute: async (input, options: unknown) =>
    executeGitClone(input, getCodeRuntimeContext(options)),
});

export const gitCommit = tool({
  description: "Create a git commit from all current sandbox repository changes under /workspace.",
  inputSchema: GitCommitInputSchema,
  outputSchema: GitOutputSchema,
  execute: async (input, options: unknown) =>
    executeGitCommit(input, getCodeRuntimeContext(options)),
});

export const gitPush = tool({
  description: "Push sandbox repository commits from a repository under /workspace.",
  inputSchema: GitPushInputSchema,
  outputSchema: GitOutputSchema,
  execute: async (input, options: unknown) => executeGitPush(input, getCodeRuntimeContext(options)),
});
