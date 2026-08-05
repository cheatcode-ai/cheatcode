import { DaytonaApiError } from "@cheatcode/agent-core/tools/code";
import { workspacePathForSlug } from "@cheatcode/db";
import { APIError } from "@cheatcode/observability";
import {
  PROJECT_FILE_MAX_CURRENT_FILES,
  type ProjectFile,
  ProjectFileRelativePathSchema,
  ProjectFileSchema,
  type ProjectFileUploadResponse,
  ProjectFileUploadResponseSchema,
  ProjectUploadedFileListSchema,
} from "@cheatcode/types/api";
import { z } from "zod";
import { sleep } from "../sandbox-support";
import {
  type ProjectListUploadedFilesInput,
  ProjectListUploadedFilesInputSchema,
  type ProjectRestoreUploadedFilesInput,
  ProjectRestoreUploadedFilesInputSchema,
  type ProjectUploadFileInput,
  ProjectUploadFileInputSchema,
} from "./project-sandbox-runtime";
import type { SandboxRuntime } from "./project-sandbox-runtime-handle";

const FILE_DIGEST_DOMAIN = "cheatcode:project-file:v2";
const VERSION_DIGEST_DOMAIN = "cheatcode:project-file-version:v2";
const FILE_RECORD_PREFIX = "project-file:";
const MATERIALIZATION_RECORD_PREFIX = "project-file-materialization:";
const VERSION_RECORD_PREFIX = "project-file-version:";
const DELETE_BATCH_SIZE = 128;
const WORKSPACE_FILE_VISIBILITY_ATTEMPTS = 20;
const WORKSPACE_FILE_VISIBILITY_DELAY_MS = 250;

const ProjectFileVersionSchema = z.strictObject({
  contentType: z.string().min(1).max(200),
  createdAt: z.string().datetime(),
  fileId: z.string().uuid(),
  name: z.string().min(1).max(200),
  path: ProjectFileRelativePathSchema,
  projectId: z.string().uuid(),
  r2Key: z.string().min(1).max(1_000),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  sizeBytes: z.number().int().positive(),
  versionId: z.string().uuid(),
});

type ProjectFileVersion = z.infer<typeof ProjectFileVersionSchema>;

const ProjectFileMaterializationSchema = z.strictObject({
  fileId: z.string().uuid(),
  modifiedAt: z.string().datetime({ offset: true }),
  projectId: z.string().uuid(),
  sizeBytes: z.number().int().positive(),
  versionId: z.string().uuid(),
});

type ProjectFileMaterialization = z.infer<typeof ProjectFileMaterializationSchema>;

interface PreparedProjectFile {
  contentSha256: string;
  fileId: string;
  r2Key: string;
  versionId: string;
}

interface CurrentProjectFile {
  file: ProjectFile;
  materialization: ProjectFileMaterialization | null;
  version: ProjectFileVersion;
}

export interface FileOps {
  deleteUploadedFileMetadata: (projectId: string) => Promise<void>;
  listUploadedFiles: (input: ProjectListUploadedFilesInput) => Promise<{ files: ProjectFile[] }>;
  restoreUploadedFiles: (
    input: ProjectRestoreUploadedFilesInput,
  ) => Promise<{ restoredFileCount: number }>;
  uploadProjectFile: (input: ProjectUploadFileInput) => Promise<ProjectFileUploadResponse>;
}

type FileRuntime = Pick<
  SandboxRuntime,
  | "client"
  | "ensureSandbox"
  | "outputBucket"
  | "ownerUserId"
  | "restartSandboxForWorkspaceRecovery"
  | "storage"
>;

interface FileContext {
  mutationTail: Promise<void>;
  runtime: FileRuntime;
}

export function createFileOps(runtime: FileRuntime): FileOps {
  const context: FileContext = { mutationTail: Promise.resolve(), runtime };
  return {
    deleteUploadedFileMetadata: (projectId) => deleteUploadedFileMetadata(runtime, projectId),
    listUploadedFiles: (input) =>
      listProjectFileRecords(runtime, ProjectListUploadedFilesInputSchema.parse(input).projectId),
    restoreUploadedFiles: (input) => {
      const parsed = ProjectRestoreUploadedFilesInputSchema.parse(input);
      return enqueueProjectFileMutation(context, () => restoreProjectFiles(context, parsed));
    },
    uploadProjectFile: (input) => {
      const parsed = ProjectUploadFileInputSchema.parse(input);
      return enqueueProjectFileMutation(context, () => persistProjectFile(context, parsed));
    },
  };
}

function deleteUploadedFileMetadata(runtime: FileRuntime, projectId: string): Promise<void> {
  return Promise.all([
    deleteStoragePrefix(runtime, fileRecordProjectPrefix(projectId)),
    deleteStoragePrefix(runtime, materializationRecordProjectPrefix(projectId)),
    deleteStoragePrefix(runtime, versionRecordProjectPrefix(projectId)),
  ]).then(() => undefined);
}

async function persistProjectFile(
  context: FileContext,
  input: z.output<typeof ProjectUploadFileInputSchema>,
): Promise<ProjectFileUploadResponse> {
  const existing = await currentFile(context.runtime, input.projectId, input.path);
  await enforceFileCount(context.runtime, input.projectId, existing !== null);
  const prepared = await prepareProjectFile(input, context.runtime.ownerUserId());
  const persistedAt = new Date().toISOString();
  const version = projectFileVersion(input, prepared, persistedAt);
  const previousVersion = await storedVersion(context.runtime, version);
  const status = fileUploadStatus(existing, prepared.versionId);
  await writeAndVerifyObject(context.runtime, input, version);
  try {
    const materialization = await materializeProjectFile(context, input, prepared);
    const file = await commitProjectFile(
      context.runtime,
      input,
      prepared,
      existing,
      previousVersion,
      version,
      persistedAt,
      materialization,
    );
    return ProjectFileUploadResponseSchema.parse({ file, status });
  } catch (error) {
    if (!previousVersion) {
      await context.runtime.outputBucket.delete(prepared.r2Key).catch(() => undefined);
    }
    throw error;
  }
}

function fileUploadStatus(
  existing: ProjectFile | null,
  versionId: string,
): "created" | "unchanged" | "updated" {
  if (!existing) return "created";
  return existing.versionId === versionId ? "unchanged" : "updated";
}

async function commitProjectFile(
  runtime: FileRuntime,
  input: z.output<typeof ProjectUploadFileInputSchema>,
  prepared: PreparedProjectFile,
  existing: ProjectFile | null,
  previousVersion: ProjectFileVersion | null,
  version: ProjectFileVersion,
  persistedAt: string,
  materialization: ProjectFileMaterialization,
): Promise<ProjectFile> {
  const file = currentProjectFile(input, prepared, existing, previousVersion, persistedAt);
  await runtime.storage.transaction(async (transaction) => {
    if (!previousVersion) {
      await transaction.put(
        versionRecordKey(input.projectId, prepared.fileId, prepared.versionId),
        version,
      );
    }
    await transaction.put(fileRecordKey(input.projectId, prepared.fileId), file);
    await transaction.put(
      materializationRecordKey(input.projectId, prepared.fileId),
      materialization,
    );
  });
  return file;
}

function currentProjectFile(
  input: z.output<typeof ProjectUploadFileInputSchema>,
  prepared: PreparedProjectFile,
  existing: ProjectFile | null,
  previousVersion: ProjectFileVersion | null,
  persistedAt: string,
): ProjectFile {
  return ProjectFileSchema.parse({
    contentType: input.contentType,
    createdAt: existing?.createdAt ?? persistedAt,
    fileId: prepared.fileId,
    name: input.name,
    path: input.path,
    projectId: input.projectId,
    sha256: prepared.contentSha256,
    sizeBytes: input.bytes.byteLength,
    updatedAt: existing?.versionId === prepared.versionId ? existing.updatedAt : persistedAt,
    versionCount: (existing?.versionCount ?? 0) + (previousVersion ? 0 : 1),
    versionId: prepared.versionId,
  });
}

async function materializeProjectFile(
  context: FileContext,
  input: z.output<typeof ProjectUploadFileInputSchema>,
  prepared: PreparedProjectFile,
): Promise<ProjectFileMaterialization> {
  const sandboxId = await context.runtime.ensureSandbox();
  const projectRoot = workspacePathForSlug(input.workspaceSlug);
  const uploadsPath = `${projectRoot}/uploads`;
  const workspacePath = `${projectRoot}/${input.path}`;
  const written = await writeProjectFileWithRecovery(
    context.runtime,
    sandboxId,
    projectRoot,
    workspacePath,
    input.bytes,
  );
  if (
    written.byteLength !== input.bytes.byteLength ||
    (await sha256Hex(written)) !== prepared.contentSha256
  ) {
    throw new APIError(
      502,
      "upstream_sandbox_failed",
      "Project file could not be verified in the workspace",
      { retriable: true },
    );
  }
  return readProjectFileMaterialization(context.runtime, sandboxId, uploadsPath, input, prepared);
}

async function writeProjectFileWithRecovery(
  runtime: FileRuntime,
  sandboxId: string,
  projectRoot: string,
  workspacePath: string,
  bytes: Uint8Array,
): Promise<Uint8Array> {
  try {
    return await writeProjectFileToWorkspace(runtime, sandboxId, projectRoot, workspacePath, bytes);
  } catch (error) {
    if (!isRecoverableWorkspaceMountError(error)) throw error;
    await runtime.restartSandboxForWorkspaceRecovery(sandboxId);
    return writeProjectFileToWorkspace(runtime, sandboxId, projectRoot, workspacePath, bytes);
  }
}

async function writeProjectFileToWorkspace(
  runtime: FileRuntime,
  sandboxId: string,
  projectRoot: string,
  workspacePath: string,
  bytes: Uint8Array,
): Promise<Uint8Array> {
  await runtime.client().createFolder(sandboxId, `${projectRoot}/uploads`);
  await runtime.client().uploadFile(sandboxId, workspacePath, bytes);
  return downloadUploadedFile(runtime, sandboxId, workspacePath, bytes.byteLength);
}

async function downloadUploadedFile(
  runtime: FileRuntime,
  sandboxId: string,
  workspacePath: string,
  maxBytes: number,
): Promise<Uint8Array> {
  let lastError: unknown;
  for (let attempt = 0; attempt < WORKSPACE_FILE_VISIBILITY_ATTEMPTS; attempt += 1) {
    try {
      return await runtime.client().downloadFile(sandboxId, workspacePath, maxBytes);
    } catch (error) {
      if (!(error instanceof DaytonaApiError) || (error.status !== 404 && !error.retriable)) {
        throw error;
      }
      lastError = error;
      await sleep(WORKSPACE_FILE_VISIBILITY_DELAY_MS);
    }
  }
  throw lastError ?? new Error("Uploaded project file did not become readable");
}

async function writeAndVerifyObject(
  runtime: FileRuntime,
  input: z.output<typeof ProjectUploadFileInputSchema>,
  version: ProjectFileVersion,
): Promise<void> {
  const stored = await runtime.outputBucket.put(version.r2Key, input.bytes, {
    customMetadata: {
      contentSha256: version.sha256,
      fileId: version.fileId,
      projectId: version.projectId,
      versionId: version.versionId,
    },
    httpMetadata: { contentType: version.contentType },
    onlyIf: { etagDoesNotMatch: "*" },
    sha256: version.sha256,
  });
  assertStoredProjectFile(stored ?? (await runtime.outputBucket.head(version.r2Key)), version);
}

async function currentFile(
  runtime: FileRuntime,
  projectId: string,
  path: string,
): Promise<ProjectFile | null> {
  const fileId = await deterministicUuid([
    FILE_DIGEST_DOMAIN,
    runtime.ownerUserId(),
    projectId,
    path,
  ]);
  const value = await runtime.storage.get(fileRecordKey(projectId, fileId));
  const parsed = ProjectFileSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

async function storedVersion(
  runtime: FileRuntime,
  version: ProjectFileVersion,
): Promise<ProjectFileVersion | null> {
  const value = await runtime.storage.get(
    versionRecordKey(version.projectId, version.fileId, version.versionId),
  );
  const parsed = ProjectFileVersionSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

async function enforceFileCount(
  runtime: FileRuntime,
  projectId: string,
  fileExists: boolean,
): Promise<void> {
  if (fileExists) return;
  const files = await runtime.storage.list({ prefix: fileRecordProjectPrefix(projectId) });
  if (files.size >= PROJECT_FILE_MAX_CURRENT_FILES) {
    throw new APIError(409, "conflict_state_invalid", "This project has too many uploaded files", {
      hint: "Remove an older project file before uploading another one.",
      retriable: false,
    });
  }
}

function enqueueProjectFileMutation<Result>(
  context: FileContext,
  operation: () => Promise<Result>,
): Promise<Result> {
  const pending = context.mutationTail.catch(() => undefined).then(operation);
  context.mutationTail = pending.then(
    () => undefined,
    () => undefined,
  );
  return pending;
}

async function restoreProjectFiles(
  context: FileContext,
  input: z.output<typeof ProjectRestoreUploadedFilesInputSchema>,
): Promise<{ restoredFileCount: number }> {
  const currentFiles = await currentProjectFiles(context.runtime, input.projectId);
  if (currentFiles.length === 0) return { restoredFileCount: 0 };
  const sandboxId = await context.runtime.ensureSandbox();
  const projectRoot = workspacePathForSlug(input.workspaceSlug);
  const uploadsPath = `${projectRoot}/uploads`;
  const workspaceFiles = await workspaceUploadedFiles(context.runtime, sandboxId, uploadsPath);
  const workspaceFilesByName = new Map(workspaceFiles.map((file) => [file.name, file]));
  const restoredFiles: CurrentProjectFile[] = [];
  for (const current of currentFiles) {
    const workspaceFile = workspaceFilesByName.get(current.file.name);
    if (workspaceProjectFileNeedsRestore(workspaceFile, current.file, current.materialization)) {
      await restoreProjectFile(context.runtime, sandboxId, projectRoot, current);
      restoredFiles.push(current);
    }
  }
  await recordRestoredProjectFiles(context.runtime, sandboxId, uploadsPath, restoredFiles);
  return { restoredFileCount: restoredFiles.length };
}

async function restoreProjectFile(
  runtime: FileRuntime,
  sandboxId: string,
  projectRoot: string,
  current: CurrentProjectFile,
): Promise<void> {
  const bytes = await readStoredProjectFile(runtime, current.version);
  const written = await writeProjectFileWithRecovery(
    runtime,
    sandboxId,
    projectRoot,
    `${projectRoot}/${current.file.path}`,
    bytes,
  );
  await assertWorkspaceProjectFile(written, current.file);
}

async function recordRestoredProjectFiles(
  runtime: FileRuntime,
  sandboxId: string,
  uploadsPath: string,
  restoredFiles: CurrentProjectFile[],
): Promise<void> {
  if (restoredFiles.length === 0) return;
  const workspaceFiles = await workspaceUploadedFiles(runtime, sandboxId, uploadsPath);
  const workspaceFilesByName = new Map(workspaceFiles.map((file) => [file.name, file]));
  for (const current of restoredFiles) {
    const workspaceFile = workspaceFilesByName.get(current.file.name);
    if (!workspaceFile || workspaceFile.isDir || workspaceFile.size !== current.file.sizeBytes) {
      throw new APIError(
        502,
        "upstream_sandbox_failed",
        "Restored project file metadata is invalid",
        { retriable: true },
      );
    }
    const materialization = ProjectFileMaterializationSchema.parse({
      fileId: current.file.fileId,
      modifiedAt: workspaceFile.modifiedAt,
      projectId: current.file.projectId,
      sizeBytes: current.file.sizeBytes,
      versionId: current.file.versionId,
    });
    await runtime.storage.put(
      materializationRecordKey(materialization.projectId, materialization.fileId),
      materialization,
    );
  }
}

async function currentProjectFiles(
  runtime: FileRuntime,
  projectId: string,
): Promise<CurrentProjectFile[]> {
  const records = await runtime.storage.list({ prefix: fileRecordProjectPrefix(projectId) });
  const currentFiles: CurrentProjectFile[] = [];
  for (const value of records.values()) {
    const file = ProjectFileSchema.parse(value);
    const version = ProjectFileVersionSchema.parse(
      await runtime.storage.get(versionRecordKey(file.projectId, file.fileId, file.versionId)),
    );
    assertCurrentProjectFile(file, version);
    const materialization = ProjectFileMaterializationSchema.safeParse(
      await runtime.storage.get(materializationRecordKey(file.projectId, file.fileId)),
    );
    currentFiles.push({
      file,
      materialization: materialization.success ? materialization.data : null,
      version,
    });
  }
  currentFiles.sort((left, right) => left.file.path.localeCompare(right.file.path));
  return currentFiles;
}

async function workspaceUploadedFiles(
  runtime: FileRuntime,
  sandboxId: string,
  uploadsPath: string,
) {
  try {
    return await runtime.client().listFiles(sandboxId, uploadsPath);
  } catch (error) {
    if (error instanceof DaytonaApiError && error.status === 404) return [];
    if (!isRecoverableWorkspaceMountError(error)) throw error;
    await runtime.restartSandboxForWorkspaceRecovery(sandboxId);
    try {
      return await runtime.client().listFiles(sandboxId, uploadsPath);
    } catch (retryError) {
      if (retryError instanceof DaytonaApiError && retryError.status === 404) return [];
      throw retryError;
    }
  }
}

async function readStoredProjectFile(
  runtime: FileRuntime,
  version: ProjectFileVersion,
): Promise<Uint8Array> {
  const object = await runtime.outputBucket.get(version.r2Key);
  if (!object) {
    throw new APIError(409, "conflict_state_invalid", "Stored project file is missing", {
      retriable: false,
    });
  }
  assertStoredProjectFile(object, version);
  const bytes = new Uint8Array(await object.arrayBuffer());
  if (bytes.byteLength !== version.sizeBytes || (await sha256Hex(bytes)) !== version.sha256) {
    throw new APIError(409, "conflict_state_invalid", "Stored project file contents are invalid", {
      retriable: false,
    });
  }
  return bytes;
}

async function readProjectFileMaterialization(
  runtime: FileRuntime,
  sandboxId: string,
  uploadsPath: string,
  input: z.output<typeof ProjectUploadFileInputSchema>,
  prepared: PreparedProjectFile,
): Promise<ProjectFileMaterialization> {
  const workspaceFiles = await workspaceUploadedFiles(runtime, sandboxId, uploadsPath);
  const workspaceFile = workspaceFiles.find((file) => file.name === input.name);
  if (!workspaceFile || workspaceFile.isDir || workspaceFile.size !== input.bytes.byteLength) {
    throw new APIError(
      502,
      "upstream_sandbox_failed",
      "Project file workspace metadata is invalid",
      { retriable: true },
    );
  }
  return ProjectFileMaterializationSchema.parse({
    fileId: prepared.fileId,
    modifiedAt: workspaceFile.modifiedAt,
    projectId: input.projectId,
    sizeBytes: input.bytes.byteLength,
    versionId: prepared.versionId,
  });
}

async function listProjectFileRecords(
  runtime: FileRuntime,
  projectId: string,
): Promise<{ files: ProjectFile[] }> {
  const records = await runtime.storage.list({ prefix: fileRecordProjectPrefix(projectId) });
  const files = Array.from(records.values()).flatMap((value) => {
    const parsed = ProjectFileSchema.safeParse(value);
    return parsed.success ? [parsed.data] : [];
  });
  files.sort((left, right) => left.path.localeCompare(right.path));
  return ProjectUploadedFileListSchema.parse({ files });
}

async function deleteStoragePrefix(runtime: FileRuntime, prefix: string): Promise<void> {
  while (true) {
    const records = await runtime.storage.list({ limit: DELETE_BATCH_SIZE, prefix });
    const keys = [...records.keys()];
    if (keys.length === 0) return;
    await runtime.storage.delete(keys);
  }
}

function isRecoverableWorkspaceMountError(error: unknown): boolean {
  return error instanceof DaytonaApiError && error.status === 400;
}

function workspaceProjectFileNeedsRestore(
  workspaceFile:
    | {
        isDir: boolean;
        modifiedAt: string;
        size: number;
      }
    | undefined,
  file: ProjectFile,
  materialization: ProjectFileMaterialization | null,
): boolean {
  if (!workspaceFile || workspaceFile.isDir || workspaceFile.size !== file.sizeBytes) {
    return true;
  }
  if (
    !materialization ||
    materialization.fileId !== file.fileId ||
    materialization.projectId !== file.projectId ||
    materialization.sizeBytes !== file.sizeBytes ||
    materialization.versionId !== file.versionId
  ) {
    return true;
  }
  return Date.parse(workspaceFile.modifiedAt) !== Date.parse(materialization.modifiedAt);
}

function assertCurrentProjectFile(file: ProjectFile, version: ProjectFileVersion): void {
  if (
    file.contentType !== version.contentType ||
    file.fileId !== version.fileId ||
    file.name !== version.name ||
    file.path !== version.path ||
    file.projectId !== version.projectId ||
    file.sha256 !== version.sha256 ||
    file.sizeBytes !== version.sizeBytes ||
    file.versionId !== version.versionId
  ) {
    throw new APIError(409, "conflict_state_invalid", "Project file identity is invalid", {
      retriable: false,
    });
  }
}

async function assertWorkspaceProjectFile(bytes: Uint8Array, file: ProjectFile): Promise<void> {
  if (bytes.byteLength === file.sizeBytes && (await sha256Hex(bytes)) === file.sha256) return;
  throw new APIError(
    502,
    "upstream_sandbox_failed",
    "Project file restoration could not be verified",
    { retriable: true },
  );
}

async function prepareProjectFile(
  input: z.output<typeof ProjectUploadFileInputSchema>,
  userId: string,
): Promise<PreparedProjectFile> {
  const contentSha256 = await sha256Hex(input.bytes);
  const fileId = await deterministicUuid([FILE_DIGEST_DOMAIN, userId, input.projectId, input.path]);
  const versionId = await deterministicUuid([
    VERSION_DIGEST_DOMAIN,
    fileId,
    contentSha256,
    input.contentType,
    String(input.bytes.byteLength),
  ]);
  return {
    contentSha256,
    fileId,
    r2Key: `${userId}/${input.projectId}/project-files/${fileId}/${versionId}`,
    versionId,
  };
}

function projectFileVersion(
  input: z.output<typeof ProjectUploadFileInputSchema>,
  prepared: PreparedProjectFile,
  createdAt: string,
): ProjectFileVersion {
  return ProjectFileVersionSchema.parse({
    contentType: input.contentType,
    createdAt,
    fileId: prepared.fileId,
    name: input.name,
    path: input.path,
    projectId: input.projectId,
    r2Key: prepared.r2Key,
    sha256: prepared.contentSha256,
    sizeBytes: input.bytes.byteLength,
    versionId: prepared.versionId,
  });
}

function assertStoredProjectFile(object: R2Object | null, version: ProjectFileVersion): void {
  const metadata = object?.customMetadata;
  const checksum = object?.checksums.sha256;
  if (
    !object ||
    object.key !== version.r2Key ||
    object.size !== version.sizeBytes ||
    object.httpMetadata?.contentType !== version.contentType ||
    metadata?.["contentSha256"] !== version.sha256 ||
    metadata["fileId"] !== version.fileId ||
    metadata["projectId"] !== version.projectId ||
    metadata["versionId"] !== version.versionId ||
    !checksum ||
    bytesToHex(new Uint8Array(checksum)) !== version.sha256
  ) {
    throw new APIError(409, "conflict_state_invalid", "Stored project file identity is invalid", {
      retriable: false,
    });
  }
}

async function deterministicUuid(parts: string[]): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(parts.join("\0")));
  const bytes = new Uint8Array(digest).slice(0, 16);
  const versionByte = bytes[6];
  const variantByte = bytes[8];
  if (versionByte === undefined || variantByte === undefined) {
    throw new Error("Project file identity digest was incomplete");
  }
  bytes[6] = (versionByte & 0x0f) | 0x80;
  bytes[8] = (variantByte & 0x3f) | 0x80;
  const hex = bytesToHex(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const view =
    bytes.buffer instanceof ArrayBuffer
      ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      : new Uint8Array(bytes);
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", view)));
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fileRecordProjectPrefix(projectId: string): string {
  return `${FILE_RECORD_PREFIX}${projectId}:`;
}

function fileRecordKey(projectId: string, fileId: string): string {
  return `${fileRecordProjectPrefix(projectId)}${fileId}`;
}

function materializationRecordProjectPrefix(projectId: string): string {
  return `${MATERIALIZATION_RECORD_PREFIX}${projectId}:`;
}

function materializationRecordKey(projectId: string, fileId: string): string {
  return `${materializationRecordProjectPrefix(projectId)}${fileId}`;
}

function versionRecordProjectPrefix(projectId: string): string {
  return `${VERSION_RECORD_PREFIX}${projectId}:`;
}

function versionRecordKey(projectId: string, fileId: string, versionId: string): string {
  return `${versionRecordProjectPrefix(projectId)}${fileId}:${versionId}`;
}
