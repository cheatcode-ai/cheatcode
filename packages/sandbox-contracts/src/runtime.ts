import { z } from "zod";

const ENVIRONMENT_VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const MAX_ENVIRONMENT_VARIABLES = 128;

/** A bounded, shell-safe process environment accepted at the sandbox boundary. */
export const EnvironmentVariablesSchema = z
  .record(z.string().min(1).max(128).regex(ENVIRONMENT_VARIABLE_NAME), z.string().max(32_768))
  .refine(
    (environment) => Object.keys(environment).length <= MAX_ENVIRONMENT_VARIABLES,
    `At most ${MAX_ENVIRONMENT_VARIABLES} environment variables are allowed.`,
  );

export interface SandboxRunCodeInput {
  code: string;
  cwd?: string;
  env?: Record<string, string>;
  language: "python" | "javascript";
  timeoutMs?: number;
}

export interface SandboxRunCodeResult {
  exitCode?: number;
  output?: string;
  stderr?: string;
  stdout?: string;
  success?: boolean;
}

export interface SandboxExecInput {
  command: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
}

export interface SandboxExecResult {
  command: string;
  durationMs?: number;
  exitCode: number;
  stderr: string;
  stdout: string;
  success: boolean;
}

export interface SandboxReadFileInput {
  encoding?: "utf8" | "base64";
  path: string;
}

export interface SandboxReadFileResult {
  content: string;
  encoding: "utf8" | "base64";
  path: string;
  size?: number;
}

export interface SandboxWriteFileInput {
  content: string;
  encoding?: "utf8" | "base64";
  path: string;
}

export interface SandboxWriteFileResult {
  path: string;
  success: boolean;
}

export interface SandboxFileEntry {
  modifiedAt: string;
  name: string;
  path: string;
  relativePath: string;
  size: number;
  type: "file" | "directory" | "symlink" | "other";
}

export interface SandboxListFilesInput {
  includeHidden?: boolean;
  path: string;
  recursive?: boolean;
}

export interface SandboxListFilesResult {
  files: SandboxFileEntry[];
  path: string;
}

export interface SandboxSearchFilesInput {
  caseSensitive?: boolean;
  contextLines?: number;
  excludeDirs?: string[];
  filePattern?: string;
  maxResults?: number;
  path: string;
  query: string;
}

export interface SandboxSearchMatch {
  column?: number;
  context?: string;
  line: number;
  path: string;
  text: string;
}

export interface SandboxSearchFilesResult {
  matches: SandboxSearchMatch[];
  query: string;
  total: number;
  truncated?: boolean;
}

export interface SandboxDeleteFileInput {
  path: string;
  recursive?: boolean;
}

export interface SandboxDeleteFileResult {
  path: string;
  success: boolean;
}

export interface SandboxStartProcessInput extends SandboxExecInput {
  /** One-shot bootstrap data written after the async session starts. Never persisted. */
  stdin?: string;
  isMobile?: boolean;
  keepAliveTimeoutMs?: number;
  maxRestarts?: number;
  processId?: string;
  restartOnFailure?: boolean;
  waitForPort?: {
    path?: string;
    port: number;
    timeoutMs?: number;
  };
}

export interface SandboxProcessResult {
  command: string;
  id: string;
  pid?: number;
  status: string;
}

export interface SandboxKillProcessInput {
  processId: string;
}

export interface SandboxKillProcessResult {
  processId: string;
  status: string;
  success: boolean;
}

export interface SandboxStatus {
  healthy: boolean;
  ping: string;
  sandboxId: string;
}

export interface SandboxSignedPreviewUrlInput {
  expiresInSeconds: number;
  port: number;
}

export interface SandboxSignedPreviewUrlResult {
  token: string;
  url: string;
}

export interface SandboxAllocateProjectPortInput {
  projectId: string;
  stack: "web" | "mobile";
}

export interface SandboxAllocateProcessPortInput {
  maxPort: number;
  minPort: number;
  processId: string;
}

export interface SandboxLike {
  allocateProjectPort?(input: SandboxAllocateProjectPortInput): Promise<number>;
  allocateProcessPort?(input: SandboxAllocateProcessPortInput): Promise<number>;
  deleteFile?(input: SandboxDeleteFileInput): Promise<SandboxDeleteFileResult>;
  ensureReady?(): Promise<SandboxStatus>;
  exec?(input: SandboxExecInput): Promise<SandboxExecResult>;
  getSignedPreviewUrl?(input: SandboxSignedPreviewUrlInput): Promise<SandboxSignedPreviewUrlResult>;
  killAllProcesses?(): Promise<number>;
  killProcess?(input: SandboxKillProcessInput): Promise<SandboxKillProcessResult>;
  listFiles?(input: SandboxListFilesInput): Promise<SandboxListFilesResult>;
  readFile?(input: SandboxReadFileInput): Promise<SandboxReadFileResult>;
  runCode(input: SandboxRunCodeInput): Promise<SandboxRunCodeResult>;
  searchFiles?(input: SandboxSearchFilesInput): Promise<SandboxSearchFilesResult>;
  startProcess?(input: SandboxStartProcessInput): Promise<SandboxProcessResult>;
  writeFile?(input: SandboxWriteFileInput): Promise<SandboxWriteFileResult>;
}

export type ArtifactKind = "audio" | "docx" | "image" | "pdf" | "slide" | "video" | "xlsx";

export interface ArtifactUploadInput {
  contentType: string;
  data: Uint8Array;
  filename: string;
  kind: ArtifactKind;
  metadata?: Record<string, unknown>;
}

export interface ArtifactUploadResult {
  downloadUrl: string;
  filename: string;
  kind: ArtifactKind;
  mimeType: string;
  outputId: string;
  r2Key: string;
  sizeBytes: number;
}

export interface ArtifactRuntime {
  put(input: ArtifactUploadInput): Promise<ArtifactUploadResult>;
}

export interface CodeRuntimeContext {
  artifacts?: ArtifactRuntime | undefined;
  sandbox: SandboxLike;
  /** The project folder inside the shared per-user sandbox. */
  workspaceDir?: string | undefined;
}

export const ArtifactRuntimeSchema = z.custom<ArtifactRuntime>(
  isArtifactRuntime,
  "Expected an artifact runtime with a callable put method",
);

export const SandboxLikeSchema = z.custom<SandboxLike>(
  isSandboxLike,
  "Expected a sandbox runtime with a callable runCode method",
);

export const CodeRuntimeContextSchema = z
  .object({
    artifacts: ArtifactRuntimeSchema.optional(),
    sandbox: SandboxLikeSchema,
    workspaceDir: z.string().optional(),
  })
  .strict();

const ObjectWithRuntimeContextSchema = z
  .object({
    runtimeContext: CodeRuntimeContextSchema,
  })
  .passthrough();

export function getCodeRuntimeContext(options: unknown): CodeRuntimeContext {
  return ObjectWithRuntimeContextSchema.parse(options).runtimeContext;
}

function isArtifactRuntime(value: unknown): value is ArtifactRuntime {
  return hasCallableMethod(value, "put");
}

function isSandboxLike(value: unknown): value is SandboxLike {
  return hasCallableMethod(value, "runCode");
}

function hasCallableMethod(value: unknown, method: string): boolean {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  try {
    return typeof Reflect.get(value, method) === "function";
  } catch {
    return false;
  }
}
