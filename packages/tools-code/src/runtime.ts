import { z } from "zod";

export interface SandboxRunCodeResult {
  stdout?: string;
  stderr?: string;
  output?: string;
  success?: boolean;
  exitCode?: number;
}

export interface SandboxExecInput {
  command: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
}

export interface SandboxExecResult {
  stdout: string;
  stderr: string;
  success: boolean;
  exitCode: number;
  command: string;
  durationMs?: number;
}

export interface SandboxReadFileInput {
  path: string;
  encoding?: "utf8" | "base64";
}

export interface SandboxReadFileResult {
  content: string;
  encoding: "utf8" | "base64";
  path: string;
  size?: number;
}

export interface SandboxWriteFileInput {
  path: string;
  content: string;
  encoding?: "utf8" | "base64";
}

export interface SandboxWriteFileResult {
  path: string;
  success: boolean;
}

export interface SandboxFileEntry {
  name: string;
  path: string;
  relativePath: string;
  type: "file" | "directory" | "symlink" | "other";
  size: number;
  modifiedAt: string;
}

export interface SandboxListFilesInput {
  path: string;
  includeHidden?: boolean;
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
  keepAliveTimeoutMs?: number;
  maxRestarts?: number;
  processId?: string;
  restartOnFailure?: boolean;
  waitForPort?: {
    port: number;
    path?: string;
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

export interface SandboxTerminalInput {
  command: string;
  cwd?: string;
  timeoutMs?: number;
}

export type SandboxTerminalResult = SandboxExecResult;

export interface SandboxStatus {
  healthy: boolean;
  ping: string;
  sandboxId: string;
}

export interface SandboxDestroyResult {
  deleted: boolean;
  sandboxId: string;
}

export interface SandboxExposePortInput {
  port: number;
  hostname?: string;
  name?: string;
  tokenTtlMs?: number;
}

export interface SandboxExposePortResult {
  port: number;
  token?: string;
  url: string;
  name?: string;
}

export interface SandboxUnexposePortInput {
  name?: string;
  port: number;
}

export interface SandboxSignedPreviewUrlInput {
  port: number;
  expiresInSeconds: number;
}

/**
 * A Daytona-signed preview URL whose access token is encoded in the subdomain
 * (`https://<port>-<token>.daytonaproxy01.net`), so it needs no header/cookie — the form
 * Expo Go can reach for exp(s):// deep links and `EXPO_PACKAGER_PROXY_URL`.
 */
export interface SandboxSignedPreviewUrlResult {
  url: string;
  token: string;
}

export interface SandboxBackupHandle {
  id: string;
  dir: string;
}

export interface SandboxCreateBackupInput {
  dir: string;
  name?: string;
  ttl?: number;
}

export interface SandboxRestoreBackupInput {
  backup: SandboxBackupHandle;
}

export interface SandboxRestoreBackupResult {
  dir: string;
  id: string;
  success: boolean;
}

export interface SandboxLike {
  createBackup?(input: SandboxCreateBackupInput): Promise<SandboxBackupHandle>;
  deleteFile?(input: SandboxDeleteFileInput): Promise<SandboxDeleteFileResult>;
  destroySandbox?(): Promise<SandboxDestroyResult>;
  ensureReady?(): Promise<SandboxStatus>;
  exec?(input: SandboxExecInput): Promise<SandboxExecResult>;
  exposePort?(input: SandboxExposePortInput): Promise<SandboxExposePortResult>;
  getSignedPreviewUrl?(input: SandboxSignedPreviewUrlInput): Promise<SandboxSignedPreviewUrlResult>;
  killAllProcesses?(): Promise<number>;
  killProcess?(input: SandboxKillProcessInput): Promise<SandboxKillProcessResult>;
  listFiles?(input: SandboxListFilesInput): Promise<SandboxListFilesResult>;
  readFile?(input: SandboxReadFileInput): Promise<SandboxReadFileResult>;
  restoreBackup?(input: SandboxRestoreBackupInput): Promise<SandboxRestoreBackupResult>;
  runCode(input: {
    language: "python" | "javascript";
    code: string;
    env?: Record<string, string>;
  }): Promise<SandboxRunCodeResult>;
  searchFiles?(input: SandboxSearchFilesInput): Promise<SandboxSearchFilesResult>;
  startProcess?(input: SandboxStartProcessInput): Promise<SandboxProcessResult>;
  unexposePort?(input: SandboxUnexposePortInput): Promise<void>;
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
}

export function isSandboxLike(value: unknown): value is SandboxLike {
  return (
    typeof value === "object" &&
    value !== null &&
    "runCode" in value &&
    typeof value.runCode === "function"
  );
}

export const CodeRuntimeContextSchema = z
  .object({
    artifacts: z.custom<ArtifactRuntime>().optional(),
    sandbox: z.custom<SandboxLike>(isSandboxLike),
  })
  .strict();

const ObjectWithRuntimeContextSchema = z
  .object({
    runtimeContext: CodeRuntimeContextSchema,
  })
  .passthrough();

export function getCodeRuntimeContext(options: unknown): CodeRuntimeContext {
  const parsed = ObjectWithRuntimeContextSchema.parse(options);
  return parsed.runtimeContext;
}
