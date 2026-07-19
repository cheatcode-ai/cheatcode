import { APIError } from "@cheatcode/observability";
import type { getCodeRuntimeContext } from "@cheatcode/sandbox-contracts";
import { z } from "zod";
import { executeShellExec, ShellExecOutputSchema } from "./shell";
import {
  resolveProjectWorkspacePath,
  WorkspacePathSchema,
  WorkspaceRelativePathSchema,
} from "./workspace-paths";

export const GitStatusInputSchema = z
  .object({
    cwd: WorkspacePathSchema.default("/workspace").describe("Repository under /workspace."),
  })
  .strict();

export const GitCloneInputSchema = z
  .object({
    repoUrl: z
      .string()
      .url()
      .refine(isSafeCloneUrl, "Clone URL must be credential-free HTTPS without query data.")
      .describe("Credential-free HTTPS Git repository URL to clone."),
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
    remote: z
      .string()
      .regex(/^[A-Za-z\d][A-Za-z\d._-]{0,99}$/u)
      .default("origin")
      .describe("Remote name."),
    branch: z.string().min(1).max(200).optional().describe("Local branch to push."),
  })
  .strict();

const GitOutputSchema = ShellExecOutputSchema;
const PUSH_URL_REWRITE_KEY = /^url\..+\.(?:insteadof|pushinsteadof)$/iu;

type GitStatusInput = z.infer<typeof GitStatusInputSchema>;
type GitCloneInput = z.infer<typeof GitCloneInputSchema>;
type GitCommitInput = z.infer<typeof GitCommitInputSchema>;
type GitPushInput = z.infer<typeof GitPushInputSchema>;
type GitOutput = z.infer<typeof GitOutputSchema>;

export interface PreparedGitPush {
  command: string[];
  cwd: string;
  destinationRef: string;
  remoteUrl: string;
  sourceCommit: string;
}

export interface PreparedGitCommit {
  commands: [string[], string[]];
  cwd: string;
}

function isSafeCloneUrl(value: string): boolean {
  const url = new URL(value);
  return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash;
}

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

/** Builds the exact add/commit sequence with repository-controlled hooks disabled. */
export function prepareGitCommit(
  input: GitCommitInput,
  runtimeContext: ReturnType<typeof getCodeRuntimeContext>,
): PreparedGitCommit {
  const parsedInput = GitCommitInputSchema.parse(input);
  const gitSafetyConfig = ["-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null"];
  return {
    commands: [
      ["git", ...gitSafetyConfig, "add", "-A"],
      ["git", ...gitSafetyConfig, "commit", "--no-verify", "-m", parsedInput.message],
    ],
    cwd: resolveProjectWorkspacePath(parsedInput.cwd, runtimeContext.workspaceDir),
  };
}

/** Executes only the prepared command sequence. */
export async function executePreparedGitCommit(
  prepared: PreparedGitCommit,
  runtimeContext: ReturnType<typeof getCodeRuntimeContext>,
): Promise<GitOutput> {
  await executeShellExec({ command: prepared.commands[0], cwd: prepared.cwd }, runtimeContext);
  return executeShellExec({ command: prepared.commands[1], cwd: prepared.cwd }, runtimeContext);
}

/** Resolves the effective URL, branch, and source commit before execution. */
export async function prepareGitPush(
  input: GitPushInput,
  runtimeContext: ReturnType<typeof getCodeRuntimeContext>,
): Promise<PreparedGitPush> {
  const parsedInput = GitPushInputSchema.parse(input);
  const cwd = resolveProjectWorkspacePath(parsedInput.cwd, runtimeContext.workspaceDir);
  const branch = await resolvePushBranch(parsedInput.branch, cwd, runtimeContext);
  const remoteUrl = await resolvePushUrl(parsedInput.remote, cwd, runtimeContext);
  const destinationRef = `refs/heads/${branch}`;
  const sourceCommit = await resolveSourceCommit(destinationRef, cwd, runtimeContext);
  return {
    command: [
      "git",
      "-c",
      "core.hooksPath=/dev/null",
      "push",
      remoteUrl,
      `${sourceCommit}:${destinationRef}`,
    ],
    cwd,
    destinationRef,
    remoteUrl,
    sourceCommit,
  };
}

/** Executes only the prepared destination and commit. */
export async function executePreparedGitPush(
  prepared: PreparedGitPush,
  runtimeContext: ReturnType<typeof getCodeRuntimeContext>,
): Promise<GitOutput> {
  await assertNoPushUrlRewrites(prepared.cwd, runtimeContext);
  return executeShellExec(
    { command: prepared.command, cwd: prepared.cwd, timeoutMs: 300_000 },
    runtimeContext,
  );
}

async function resolvePushBranch(
  requestedBranch: string | undefined,
  cwd: string,
  runtimeContext: ReturnType<typeof getCodeRuntimeContext>,
): Promise<string> {
  const branch = requestedBranch
    ? requestedBranch
    : singleOutputLine(
        (
          await executeShellExec(
            { command: ["git", "symbolic-ref", "--quiet", "--short", "HEAD"], cwd },
            runtimeContext,
          )
        ).stdout,
        "Current Git branch could not be resolved.",
      );
  const checked = await executeShellExec(
    { command: ["git", "check-ref-format", "--branch", branch], cwd },
    runtimeContext,
  );
  return singleOutputLine(checked.stdout, "Git branch could not be normalized.");
}

async function resolvePushUrl(
  remote: string,
  cwd: string,
  runtimeContext: ReturnType<typeof getCodeRuntimeContext>,
): Promise<string> {
  await assertNoPushUrlRewrites(cwd, runtimeContext);
  const output = await executeShellExec(
    { command: ["git", "remote", "get-url", "--push", "--all", remote], cwd },
    runtimeContext,
  );
  const urls = output.stdout
    .split("\n")
    .map((value) => value.trim())
    .filter(Boolean);
  if (urls.length !== 1 || !isSafePushUrl(urls[0])) {
    throw invalidPushPreparationError(
      "Git push requires exactly one credential-free HTTPS destination.",
    );
  }
  return urls[0];
}

async function assertNoPushUrlRewrites(
  cwd: string,
  runtimeContext: ReturnType<typeof getCodeRuntimeContext>,
): Promise<void> {
  const output = await executeShellExec(
    { command: ["git", "config", "--includes", "--null", "--name-only", "--list"], cwd },
    runtimeContext,
  );
  if (output.stdout.split("\0").some((key) => PUSH_URL_REWRITE_KEY.test(key))) {
    throw invalidPushPreparationError(
      "Git push URL rewriting must be removed before resolving an exact destination.",
    );
  }
}

async function resolveSourceCommit(
  destinationRef: string,
  cwd: string,
  runtimeContext: ReturnType<typeof getCodeRuntimeContext>,
): Promise<string> {
  const output = await executeShellExec(
    { command: ["git", "rev-parse", "--verify", `${destinationRef}^{commit}`], cwd },
    runtimeContext,
  );
  const commit = singleOutputLine(output.stdout, "Git source commit could not be resolved.");
  if (!/^[a-f\d]{40}(?:[a-f\d]{24})?$/u.test(commit)) {
    throw invalidPushPreparationError("Git source commit is invalid.");
  }
  return commit;
}

function singleOutputLine(value: string, errorMessage: string): string {
  const lines = value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const [line] = lines;
  if (lines.length !== 1 || !line) throw invalidPushPreparationError(errorMessage);
  return line;
}

function isSafePushUrl(value: string | undefined): value is string {
  if (!value || value.length > 2_048) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      Boolean(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

function invalidPushPreparationError(message: string): APIError {
  return new APIError(400, "tool_validation_failed", message, {
    hint: "Configure one credential-free HTTPS push URL and a local branch, then retry.",
    retriable: false,
  });
}
