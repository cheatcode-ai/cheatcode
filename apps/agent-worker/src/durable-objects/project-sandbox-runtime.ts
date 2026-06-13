import { z } from "zod";

export interface BackupOptions {
  dir: string;
  excludes?: string[];
  gitignore?: boolean;
  localBucket?: boolean;
  name?: string;
  ttl?: number;
}

export interface DirectoryBackup {
  dir: string;
  id: string;
  localBucket?: boolean;
}

export interface ExecOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number;
}

export interface ProcessOptions extends ExecOptions {
  autoCleanup?: boolean;
  keepAliveTimeoutMs?: number;
  maxRestarts?: number;
  processId?: string;
  restartOnFailure?: boolean;
}

export interface RunCodeOptions {
  envVars?: Record<string, string>;
  language: "python" | "javascript";
}

const AbsolutePathSchema = z
  .string()
  .min(1)
  .max(1_000)
  .refine((path) => path.startsWith("/"), "Sandbox paths must be absolute.");
const WorkspacePathSchema = AbsolutePathSchema.refine(
  isSafeWorkspacePath,
  "Path must stay inside /workspace.",
);
const WorkspaceFilePathSchema = WorkspacePathSchema.refine(
  isWorkspaceChildPath,
  "File path must be inside /workspace.",
);

const CommandArgvSchema = z.array(z.string().min(1)).min(1).max(128);

export const ProjectRunCodeInputSchema = z
  .object({
    language: z.enum(["python", "javascript"]),
    code: z.string().min(1).max(100_000),
    env: z.record(z.string(), z.string()).optional(),
  })
  .strict();

export type ProjectRunCodeInput = z.infer<typeof ProjectRunCodeInputSchema>;

export const ProjectExecInputSchema = z
  .object({
    command: CommandArgvSchema,
    cwd: WorkspacePathSchema.optional(),
    env: z.record(z.string(), z.string()).optional(),
    timeoutMs: z.number().int().positive().max(600_000).optional(),
  })
  .strict();

export const ProjectStartProcessInputSchema = ProjectExecInputSchema.extend({
  keepAliveTimeoutMs: z
    .number()
    .int()
    .min(0)
    .max(24 * 60 * 60 * 1000)
    .optional(),
  maxRestarts: z.number().int().min(0).max(25).optional(),
  processId: z.string().min(1).max(200).optional(),
  restartOnFailure: z.boolean().optional(),
  waitForPort: z
    .object({
      port: z.number().int().positive().max(65_535),
      path: z.string().min(1).max(500).optional(),
      timeoutMs: z.number().int().positive().max(600_000).optional(),
    })
    .strict()
    .optional(),
}).strict();

export const ProjectReadFileInputSchema = z
  .object({
    path: WorkspaceFilePathSchema,
    encoding: z.enum(["utf8", "base64"]).optional(),
  })
  .strict();

export const ProjectWriteFileInputSchema = z
  .object({
    path: WorkspaceFilePathSchema,
    content: z.string().max(2_000_000),
    encoding: z.enum(["utf8", "base64"]).default("utf8"),
  })
  .strict();

export const ProjectListFilesInputSchema = z
  .object({
    path: WorkspacePathSchema,
    includeHidden: z.boolean().default(false),
    recursive: z.boolean().default(false),
  })
  .strict();

export const ProjectSearchFilesInputSchema = z
  .object({
    caseSensitive: z.boolean().default(false),
    contextLines: z.number().int().min(0).max(10).default(0),
    excludeDirs: z.array(z.string().min(1).max(200)).max(25).default([]),
    filePattern: z.string().min(1).max(200).optional(),
    maxResults: z.number().int().positive().max(1_000).default(100),
    path: WorkspacePathSchema,
    query: z.string().min(1).max(500),
  })
  .strict();

export const ProjectDeleteFileInputSchema = z
  .object({
    path: WorkspacePathSchema.refine(
      isWorkspaceChildPath,
      "Delete path must be inside /workspace and not /workspace itself.",
    ),
    recursive: z.boolean().default(false),
  })
  .strict();

export const ProjectKillProcessInputSchema = z
  .object({
    processId: z.string().min(1).max(200),
  })
  .strict();

export const ProjectExposePortInputSchema = z
  .object({
    hostname: z.string().min(1).max(255).optional(),
    name: z.string().min(1).max(100).optional(),
    port: z.number().int().positive().max(65_535),
    tokenTtlMs: z
      .number()
      .int()
      .positive()
      .max(24 * 60 * 60 * 1000)
      .optional(),
  })
  .strict();

export const ProjectUnexposePortInputSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    port: z.number().int().positive().max(65_535),
  })
  .strict();

export const ProjectCreateBackupInputSchema = z
  .object({
    dir: WorkspacePathSchema.default("/workspace"),
    localBucket: z.boolean().optional(),
    name: z.string().min(1).max(200).optional(),
    ttl: z
      .number()
      .int()
      .positive()
      .max(90 * 24 * 60 * 60)
      .default(30 * 24 * 60 * 60),
  })
  .strict();

export const ProjectBackupHandleSchema = z
  .object({
    id: z.string().min(1),
    dir: WorkspacePathSchema,
    localBucket: z.boolean().optional(),
  })
  .strict();

export const ProjectRestoreBackupInputSchema = z
  .object({
    backup: ProjectBackupHandleSchema,
  })
  .strict();

export type ProjectExecInput = z.input<typeof ProjectExecInputSchema>;
export type ProjectStartProcessInput = z.input<typeof ProjectStartProcessInputSchema>;
export type ProjectReadFileInput = z.input<typeof ProjectReadFileInputSchema>;
export type ProjectWriteFileInput = z.input<typeof ProjectWriteFileInputSchema>;
export type ProjectListFilesInput = z.input<typeof ProjectListFilesInputSchema>;
export type ProjectSearchFilesInput = z.input<typeof ProjectSearchFilesInputSchema>;
export type ProjectDeleteFileInput = z.input<typeof ProjectDeleteFileInputSchema>;
export type ProjectKillProcessInput = z.input<typeof ProjectKillProcessInputSchema>;
export type ProjectExposePortInput = z.input<typeof ProjectExposePortInputSchema>;
export type ProjectUnexposePortInput = z.input<typeof ProjectUnexposePortInputSchema>;
export type ProjectCreateBackupInput = z.input<typeof ProjectCreateBackupInputSchema>;
export type ProjectRestoreBackupInput = z.input<typeof ProjectRestoreBackupInputSchema>;

export interface NormalizedRunCodeResult {
  stdout: string;
  stderr: string;
  success: boolean;
  exitCode: number;
}

export interface NormalizedExecResult {
  command: string;
  stdout: string;
  stderr: string;
  success: boolean;
  exitCode: number;
  durationMs?: number;
}

export interface NormalizedReadFileResult {
  path: string;
  content: string;
  encoding: "utf8" | "base64";
  size?: number;
}

export interface NormalizedWriteFileResult {
  path: string;
  success: boolean;
}

export interface NormalizedFileEntry {
  name: string;
  path: string;
  relativePath: string;
  type: "file" | "directory" | "symlink" | "other";
  size: number;
  modifiedAt: string;
}

export interface NormalizedListFilesResult {
  path: string;
  files: NormalizedFileEntry[];
}

export interface NormalizedSearchMatch {
  column?: number;
  context?: string;
  line: number;
  path: string;
  text: string;
}

export interface NormalizedSearchFilesResult {
  matches: NormalizedSearchMatch[];
  query: string;
  total: number;
  truncated?: boolean;
}

export interface NormalizedDeleteFileResult {
  path: string;
  success: boolean;
}

export interface NormalizedProcessResult {
  command: string;
  id: string;
  pid?: number;
  status: string;
}

export interface NormalizedExposePortResult {
  port: number;
  token?: string;
  url: string;
  name?: string;
}

export interface NormalizedBackupHandle {
  id: string;
  dir: string;
  localBucket?: boolean;
}

function isSafeWorkspacePath(path: string): boolean {
  const normalized = normalizeWorkspacePath(path);
  return normalized === "/workspace" || normalized.startsWith("/workspace/");
}

function isWorkspaceChildPath(path: string): boolean {
  const normalized = normalizeWorkspacePath(path);
  return normalized.startsWith("/workspace/") && normalized !== "/workspace/";
}

function normalizeWorkspacePath(path: string): string {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part.length === 0 || part === ".") {
      continue;
    }
    if (part === "..") {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return `/${parts.join("/")}${path.endsWith("/") ? "/" : ""}`;
}

interface SandboxExecutionResult {
  logs: {
    stdout: string[];
    stderr: string[];
  };
  error?: unknown;
}

function isSandboxExecutionResult(value: unknown): value is SandboxExecutionResult {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  const logs = candidate["logs"];
  if (!logs || typeof logs !== "object") {
    return false;
  }
  const typedLogs = logs as Record<string, unknown>;
  return Array.isArray(typedLogs["stdout"]) && Array.isArray(typedLogs["stderr"]);
}

function toPlainExecutionResult(value: unknown): unknown {
  if (
    value &&
    typeof value === "object" &&
    "toJSON" in value &&
    typeof (value as { toJSON?: unknown }).toJSON === "function"
  ) {
    return (value as { toJSON(): unknown }).toJSON();
  }
  return value;
}

function normalizeEncoding(value: unknown): "utf8" | "base64" {
  return value === "base64" ? "base64" : "utf8";
}

function shellQuote(arg: string): string {
  return `'${arg.replaceAll("'", "'\\''")}'`;
}

export function commandToShellString(command: string[]): string {
  return command.map(shellQuote).join(" ");
}

export function createExecOptions(input: ProjectExecInput): ExecOptions {
  const options: ExecOptions = {};
  if (input.cwd) {
    options.cwd = input.cwd;
  }
  if (input.env) {
    options.env = input.env;
  }
  if (input.timeoutMs) {
    options.timeout = input.timeoutMs;
  }
  return options;
}

export function createProcessOptions(input: ProjectStartProcessInput): ProcessOptions {
  const options: ProcessOptions = createExecOptions(input);
  options.autoCleanup = false;
  if (input.keepAliveTimeoutMs !== undefined) {
    options.keepAliveTimeoutMs = input.keepAliveTimeoutMs;
  }
  if (input.maxRestarts !== undefined) {
    options.maxRestarts = input.maxRestarts;
  }
  if (input.processId) {
    options.processId = input.processId;
  }
  if (input.restartOnFailure !== undefined) {
    options.restartOnFailure = input.restartOnFailure;
  }
  return options;
}

export function createRunCodeOptions(input: ProjectRunCodeInput): RunCodeOptions {
  const options: RunCodeOptions = { language: input.language };
  if (input.env) {
    options.envVars = input.env;
  }
  return options;
}

export function normalizeExecResult(value: unknown): NormalizedExecResult {
  const parsed = z
    .object({
      command: z.string(),
      duration: z.number().nonnegative().optional(),
      exitCode: z.number().int(),
      stderr: z.string(),
      stdout: z.string(),
      success: z.boolean(),
    })
    .passthrough()
    .parse(toPlainExecutionResult(value));
  return {
    command: parsed.command,
    stdout: parsed.stdout,
    stderr: parsed.stderr,
    success: parsed.success,
    exitCode: parsed.exitCode,
    ...(parsed.duration === undefined ? {} : { durationMs: parsed.duration }),
  };
}

export function normalizeReadFileResult(value: unknown): NormalizedReadFileResult {
  const parsed = z
    .object({
      content: z.string(),
      encoding: z.enum(["utf-8", "base64"]).optional(),
      path: z.string(),
      size: z.number().int().nonnegative().optional(),
    })
    .passthrough()
    .parse(value);
  return {
    path: parsed.path,
    content: parsed.content,
    encoding: normalizeEncoding(parsed.encoding),
    ...(parsed.size === undefined ? {} : { size: parsed.size }),
  };
}

export function normalizeWriteFileResult(value: unknown): NormalizedWriteFileResult {
  const parsed = z.object({ path: z.string(), success: z.boolean() }).passthrough().parse(value);
  return {
    path: parsed.path,
    success: parsed.success,
  };
}

export function normalizeListFilesResult(value: unknown): NormalizedListFilesResult {
  const parsed = z
    .object({
      path: z.string(),
      files: z.array(
        z
          .object({
            absolutePath: z.string(),
            modifiedAt: z.string(),
            name: z.string(),
            relativePath: z.string(),
            size: z.number().int().nonnegative(),
            type: z.enum(["file", "directory", "symlink", "other"]),
          })
          .passthrough(),
      ),
    })
    .passthrough()
    .parse(value);
  return {
    path: parsed.path,
    files: parsed.files.map((file) => ({
      name: file.name,
      path: file.absolutePath,
      relativePath: file.relativePath,
      type: file.type,
      size: file.size,
      modifiedAt: file.modifiedAt,
    })),
  };
}

export function normalizeExposePortResult(value: unknown): NormalizedExposePortResult {
  const parsed = z
    .object({
      name: z.string().optional(),
      port: z.number().int().positive(),
      token: z.string().optional(),
      url: z.string().url(),
    })
    .passthrough()
    .parse(value);
  return {
    port: parsed.port,
    ...(parsed.token === undefined ? {} : { token: parsed.token }),
    url: parsed.url,
    ...(parsed.name === undefined ? {} : { name: parsed.name }),
  };
}

export function normalizeDirectoryBackup(value: DirectoryBackup): NormalizedBackupHandle {
  const parsed = ProjectBackupHandleSchema.parse(value);
  return {
    id: parsed.id,
    dir: parsed.dir,
    ...(parsed.localBucket === undefined ? {} : { localBucket: parsed.localBucket }),
  };
}

export function createBackupOptions(input: ProjectCreateBackupInput): BackupOptions {
  const parsedInput = ProjectCreateBackupInputSchema.parse(input);
  return {
    dir: parsedInput.dir,
    ttl: parsedInput.ttl,
    gitignore: true,
    excludes: ["node_modules", ".git", ".next", ".turbo"],
    ...(parsedInput.localBucket === undefined ? {} : { localBucket: parsedInput.localBucket }),
    ...(parsedInput.name ? { name: parsedInput.name } : {}),
  };
}

export function normalizeRunCodeResult(value: unknown): NormalizedRunCodeResult {
  const serialized = toPlainExecutionResult(value);
  if (!isSandboxExecutionResult(serialized)) {
    throw new Error("Unexpected sandbox execution result.");
  }
  return {
    stdout: serialized.logs.stdout.join(""),
    stderr: serialized.logs.stderr.join(""),
    success: !serialized.error,
    exitCode: serialized.error ? 1 : 0,
  };
}
