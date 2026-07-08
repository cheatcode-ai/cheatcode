import { z } from "zod";

export interface BackupOptions {
  dir: string;
  excludes?: string[];
  gitignore?: boolean;
  name?: string;
  ttl?: number;
}

export interface DirectoryBackup {
  dir: string;
  id: string;
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

export const ProjectPreviewFileInputSchema = z
  .object({
    path: WorkspaceFilePathSchema,
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

export const ProjectReadDevServerLogsInputSchema = z
  .object({
    lastPid: z.string().min(1).max(100).optional(),
    processId: z.string().min(1).max(200).default("app-preview"),
    stderrCursor: z.number().int().min(0).default(0),
    stdoutCursor: z.number().int().min(0).default(0),
    tail: z.number().int().min(1).max(500).default(200),
  })
  .strict();
export type ProjectReadDevServerLogsInput = z.input<typeof ProjectReadDevServerLogsInputSchema>;

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

export const ProjectCodeServerInputSchema = z
  .object({
    hostname: z.string().min(1).max(255).optional(),
    initialFilePath: WorkspaceFilePathSchema.optional(),
    workspacePath: WorkspacePathSchema.default("/workspace"),
  })
  .strict();

export const ProjectUnexposePortInputSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    port: z.number().int().positive().max(65_535),
  })
  .strict();

export const ProjectWakePreviewInputSchema = z
  .object({
    hostname: z.string().min(1).max(255).optional(),
  })
  .strict();

export const ProjectSignedPreviewUrlInputSchema = z
  .object({
    port: z.number().int().positive().max(65_535),
    expiresInSeconds: z
      .number()
      .int()
      .positive()
      .max(24 * 60 * 60),
  })
  .strict();

export const ProjectCreateBackupInputSchema = z
  .object({
    dir: WorkspacePathSchema.default("/workspace"),
    name: z.string().min(1).max(200).optional(),
  })
  .strict();

export const ProjectBackupHandleSchema = z
  .object({
    id: z.string().min(1),
    dir: WorkspacePathSchema,
  })
  .strict();

export const ProjectRestoreBackupInputSchema = z
  .object({
    backup: ProjectBackupHandleSchema,
  })
  .strict();

export type ProjectExecInput = z.input<typeof ProjectExecInputSchema>;
export type ProjectStartProcessInput = z.input<typeof ProjectStartProcessInputSchema>;
export type ProjectPreviewFileInput = z.input<typeof ProjectPreviewFileInputSchema>;
export type ProjectReadFileInput = z.input<typeof ProjectReadFileInputSchema>;
export type ProjectWriteFileInput = z.input<typeof ProjectWriteFileInputSchema>;
export type ProjectListFilesInput = z.input<typeof ProjectListFilesInputSchema>;
export type ProjectSearchFilesInput = z.input<typeof ProjectSearchFilesInputSchema>;
export type ProjectDeleteFileInput = z.input<typeof ProjectDeleteFileInputSchema>;
export type ProjectKillProcessInput = z.input<typeof ProjectKillProcessInputSchema>;
export type ProjectExposePortInput = z.input<typeof ProjectExposePortInputSchema>;
export type ProjectCodeServerInput = z.input<typeof ProjectCodeServerInputSchema>;
export type ProjectUnexposePortInput = z.input<typeof ProjectUnexposePortInputSchema>;
export type ProjectWakePreviewInput = z.input<typeof ProjectWakePreviewInputSchema>;
export type ProjectSignedPreviewUrlInput = z.input<typeof ProjectSignedPreviewUrlInputSchema>;

/** Result of waking a preview: the (possibly restarted) dev-server preview URL + liveness. */
export interface ProjectWakePreviewResult {
  running: boolean;
  state: string;
  port?: number;
  url?: string;
  expiresAt?: string;
  // exp(s):// deep link for the Expo Go QR — only present for a mobile (Metro/8081) dev server,
  // regenerated from a fresh signed preview URL on every wake.
  expoUrl?: string;
}

/** Current Daytona lifecycle state for the project's sandbox (webhook/status surface). */
export interface ProjectSandboxRuntimeState {
  state: string;
  sandboxId?: string;
}
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

function shellQuote(arg: string): string {
  return `'${arg.replaceAll("'", "'\\''")}'`;
}

export function commandToShellString(command: string[]): string {
  return command.map(shellQuote).join(" ");
}
