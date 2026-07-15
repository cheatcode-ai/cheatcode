import type { getCodeRuntimeContext } from "@cheatcode/sandbox-contracts";
import { z } from "zod";
import { executeShellExec, ShellExecOutputSchema } from "./shell";
import { WorkspacePathSchema, WorkspaceRelativePathSchema } from "./workspace-paths";

export const GitStatusInputSchema = z
  .object({
    cwd: WorkspacePathSchema.default("/workspace").describe("Repository under /workspace."),
  })
  .strict();

export const GitCloneInputSchema = z
  .object({
    repoUrl: z.string().url().describe("Git repository URL to clone."),
    targetDir: WorkspaceRelativePathSchema.describe("Relative directory name under /workspace."),
    branch: z.string().min(1).max(200).optional().describe("Optional branch or tag to clone."),
    depth: z.number().int().positive().max(1000).default(1).describe("Clone depth."),
  })
  .strict();

export const GitCommitInputSchema = z
  .object({
    cwd: WorkspacePathSchema.describe("Repository directory under /workspace."),
    message: z.string().min(1).max(500).describe("Commit message."),
  })
  .strict();

export const GitPushInputSchema = z
  .object({
    cwd: WorkspacePathSchema.describe("Repository directory under /workspace."),
    remote: z.string().min(1).max(100).default("origin").describe("Remote name."),
    branch: z.string().min(1).max(200).optional().describe("Branch ref to push."),
  })
  .strict();

const GitOutputSchema = ShellExecOutputSchema;

type GitStatusInput = z.infer<typeof GitStatusInputSchema>;
type GitCloneInput = z.infer<typeof GitCloneInputSchema>;
type GitCommitInput = z.infer<typeof GitCommitInputSchema>;
type GitPushInput = z.infer<typeof GitPushInputSchema>;
type GitOutput = z.infer<typeof GitOutputSchema>;

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
