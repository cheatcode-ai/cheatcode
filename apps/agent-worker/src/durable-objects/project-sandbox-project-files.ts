import { workspacePathForSlug } from "@cheatcode/db";
import { APIError, createLogger } from "@cheatcode/observability";
import { DaytonaApiError } from "@cheatcode/tools-code";
import {
  PROJECT_FILE_MAX_CURRENT_FILES,
  type ProjectFile,
  ProjectFileListSchema,
  ProjectFileRelativePathSchema,
  ProjectFileSchema,
  type ProjectFileUploadResponse,
  ProjectFileUploadResponseSchema,
} from "@cheatcode/types";
import { z } from "zod";
import { sleep } from "./project-sandbox-process-support";
import { ProjectSandboxProcesses } from "./project-sandbox-processes";
import {
  type ProjectListUploadedFilesInput,
  ProjectListUploadedFilesInputSchema,
  type ProjectRestoreUploadedFilesInput,
  ProjectRestoreUploadedFilesInputSchema,
  type ProjectUploadFileInput,
  ProjectUploadFileInputSchema,
} from "./project-sandbox-runtime";

const FILE_DIGEST_DOMAIN = "cheatcode:project-file:v2";
const VERSION_DIGEST_DOMAIN = "cheatcode:project-file-version:v2";
const FILE_RECORD_PREFIX = "project-file:";
const VERSION_RECORD_PREFIX = "project-file-version:";
const DELETE_BATCH_SIZE = 128;
const WORKSPACE_TIMESTAMP_TOLERANCE_MS = 2_000;
const WORKSPACE_FILE_VISIBILITY_ATTEMPTS = 20;
const WORKSPACE_FILE_VISIBILITY_DELAY_MS = 250;

const ProjectFileVersionSchema = z
  .object({
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
  })
  .strict();

type ProjectFileVersion = z.infer<typeof ProjectFileVersionSchema>;

interface PreparedProjectFile {
  contentSha256: string;
  fileId: string;
  r2Key: string;
  versionId: string;
}

interface CurrentProjectFile {
  file: ProjectFile;
  version: ProjectFileVersion;
}

export abstract class ProjectSandboxProjectFiles extends ProjectSandboxProcesses {
  private projectFileMutationTail: Promise<void> = Promise.resolve();

  public listUploadedFiles(
    input: ProjectListUploadedFilesInput,
  ): Promise<{ files: ProjectFile[] }> {
    const parsed = ProjectListUploadedFilesInputSchema.parse(input);
    return this.listProjectFileRecords(parsed.projectId);
  }

  public uploadProjectFile(input: ProjectUploadFileInput): Promise<ProjectFileUploadResponse> {
    const parsed = ProjectUploadFileInputSchema.parse(input);
    return this.enqueueProjectFileMutation(() => this.persistProjectFile(parsed));
  }

  public restoreUploadedFiles(
    input: ProjectRestoreUploadedFilesInput,
  ): Promise<{ restoredFileCount: number }> {
    const parsed = ProjectRestoreUploadedFilesInputSchema.parse(input);
    return this.enqueueProjectFileMutation(() => this.restoreProjectFiles(parsed));
  }

  protected deleteUploadedFileMetadata(projectId: string): Promise<void> {
    return Promise.all([
      this.deleteStoragePrefix(fileRecordProjectPrefix(projectId)),
      this.deleteStoragePrefix(versionRecordProjectPrefix(projectId)),
    ]).then(() => undefined);
  }

  private async persistProjectFile(
    input: z.output<typeof ProjectUploadFileInputSchema>,
  ): Promise<ProjectFileUploadResponse> {
    const existing = await this.currentFile(input.projectId, input.path);
    await this.enforceFileCount(input.projectId, existing !== null);
    const prepared = await prepareProjectFile(input, this.ownerUserId());
    const persistedAt = new Date().toISOString();
    const workspaceTimestamp =
      existing?.versionId === prepared.versionId ? existing.updatedAt : persistedAt;
    const version = projectFileVersion(input, prepared, persistedAt);
    const previousVersion = await this.storedVersion(version);
    const status = existing
      ? existing.versionId === prepared.versionId
        ? "unchanged"
        : "updated"
      : "created";
    await this.writeAndVerifyObject(input, version);
    try {
      await this.materializeProjectFile(input, prepared.contentSha256, workspaceTimestamp);
      const file = await this.commitProjectFile(
        input,
        prepared,
        existing,
        previousVersion,
        version,
        persistedAt,
      );
      return ProjectFileUploadResponseSchema.parse({ file, status });
    } catch (error) {
      if (!previousVersion) {
        await this.env.R2_OUTPUTS.delete(prepared.r2Key).catch(() => undefined);
      }
      throw error;
    }
  }

  private async commitProjectFile(
    input: z.output<typeof ProjectUploadFileInputSchema>,
    prepared: PreparedProjectFile,
    existing: ProjectFile | null,
    previousVersion: ProjectFileVersion | null,
    version: ProjectFileVersion,
    persistedAt: string,
  ): Promise<ProjectFile> {
    const file = ProjectFileSchema.parse({
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
    await this.ctx.storage.transaction(async (transaction) => {
      if (!previousVersion) {
        await transaction.put(
          versionRecordKey(input.projectId, prepared.fileId, prepared.versionId),
          version,
        );
      }
      await transaction.put(fileRecordKey(input.projectId, prepared.fileId), file);
    });
    return file;
  }

  private async materializeProjectFile(
    input: z.output<typeof ProjectUploadFileInputSchema>,
    contentSha256: string,
    workspaceTimestamp: string,
  ): Promise<void> {
    const sandboxId = await this.ensureSandbox();
    const projectRoot = workspacePathForSlug(input.workspaceSlug);
    const workspacePath = `${projectRoot}/${input.path}`;
    const written = await this.writeProjectFileWithRecovery(
      sandboxId,
      projectRoot,
      workspacePath,
      input.bytes,
      workspaceTimestamp,
    );
    if (
      written.byteLength !== input.bytes.byteLength ||
      (await sha256Hex(written)) !== contentSha256
    ) {
      throw new APIError(
        502,
        "upstream_sandbox_failed",
        "Project file could not be verified in the workspace",
        { retriable: true },
      );
    }
  }

  private async writeProjectFileWithRecovery(
    sandboxId: string,
    projectRoot: string,
    workspacePath: string,
    bytes: Uint8Array,
    workspaceTimestamp: string,
  ): Promise<Uint8Array> {
    try {
      return await this.writeProjectFileToWorkspace(
        sandboxId,
        projectRoot,
        workspacePath,
        bytes,
        workspaceTimestamp,
      );
    } catch (error) {
      if (!isRecoverableWorkspaceMountError(error)) {
        throw error;
      }
      await this.restartSandboxForWorkspaceRecovery(sandboxId);
      return this.writeProjectFileToWorkspace(
        sandboxId,
        projectRoot,
        workspacePath,
        bytes,
        workspaceTimestamp,
      );
    }
  }

  private async writeProjectFileToWorkspace(
    sandboxId: string,
    projectRoot: string,
    workspacePath: string,
    bytes: Uint8Array,
    workspaceTimestamp: string,
  ): Promise<Uint8Array> {
    const uploadsPath = `${projectRoot}/uploads`;
    await this.prepareUploadedFileWrite(sandboxId, uploadsPath, workspacePath);
    await this.client().uploadFile(sandboxId, workspacePath, bytes);
    const written = await this.downloadUploadedFile(sandboxId, workspacePath, bytes.byteLength);
    await this.protectUploadedFile(sandboxId, uploadsPath, workspacePath, workspaceTimestamp).catch(
      (error: unknown) => {
        logWorkspaceProtectionFailure(error, "file");
      },
    );
    return written;
  }

  private async downloadUploadedFile(
    sandboxId: string,
    workspacePath: string,
    maxBytes: number,
  ): Promise<Uint8Array> {
    let lastError: unknown;
    for (let attempt = 0; attempt < WORKSPACE_FILE_VISIBILITY_ATTEMPTS; attempt += 1) {
      try {
        return await this.client().downloadFile(sandboxId, workspacePath, maxBytes);
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

  private async writeAndVerifyObject(
    input: z.output<typeof ProjectUploadFileInputSchema>,
    version: ProjectFileVersion,
  ): Promise<void> {
    const stored = await this.env.R2_OUTPUTS.put(version.r2Key, input.bytes, {
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
    assertStoredProjectFile(stored ?? (await this.env.R2_OUTPUTS.head(version.r2Key)), version);
  }

  private async currentFile(projectId: string, path: string): Promise<ProjectFile | null> {
    const fileId = await deterministicUuid([
      FILE_DIGEST_DOMAIN,
      this.ownerUserId(),
      projectId,
      path,
    ]);
    const value = await this.ctx.storage.get(fileRecordKey(projectId, fileId));
    const parsed = ProjectFileSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
  }

  private async storedVersion(version: ProjectFileVersion): Promise<ProjectFileVersion | null> {
    const value = await this.ctx.storage.get(
      versionRecordKey(version.projectId, version.fileId, version.versionId),
    );
    const parsed = ProjectFileVersionSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
  }

  private async enforceFileCount(projectId: string, fileExists: boolean): Promise<void> {
    if (fileExists) return;
    const files = await this.ctx.storage.list({ prefix: fileRecordProjectPrefix(projectId) });
    if (files.size >= PROJECT_FILE_MAX_CURRENT_FILES) {
      throw new APIError(
        409,
        "conflict_state_invalid",
        "This project has too many uploaded files",
        {
          hint: "Remove an older project file before uploading another one.",
          retriable: false,
        },
      );
    }
  }

  private enqueueProjectFileMutation<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.projectFileMutationTail.catch(() => undefined).then(operation);
    this.projectFileMutationTail = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  }

  private async restoreProjectFiles(
    input: z.output<typeof ProjectRestoreUploadedFilesInputSchema>,
  ): Promise<{ restoredFileCount: number }> {
    const currentFiles = await this.currentProjectFiles(input.projectId);
    if (currentFiles.length === 0) {
      return { restoredFileCount: 0 };
    }
    const sandboxId = await this.ensureSandbox();
    const projectRoot = workspacePathForSlug(input.workspaceSlug);
    const uploadsPath = `${projectRoot}/uploads`;
    const workspaceFiles = await this.workspaceUploadedFiles(sandboxId, uploadsPath);
    const workspaceFilesByName = new Map(workspaceFiles.map((file) => [file.name, file]));
    let restoredFileCount = 0;
    for (const current of currentFiles) {
      const workspaceFile = workspaceFilesByName.get(current.file.name);
      if (!workspaceProjectFileNeedsRestore(workspaceFile, current.file)) {
        continue;
      }
      const bytes = await this.readStoredProjectFile(current.version);
      const written = await this.writeProjectFileWithRecovery(
        sandboxId,
        projectRoot,
        `${projectRoot}/${current.file.path}`,
        bytes,
        current.file.updatedAt,
      );
      await assertWorkspaceProjectFile(written, current.file);
      restoredFileCount += 1;
    }
    await this.protectUploadedDirectory(sandboxId, uploadsPath).catch((error: unknown) => {
      logWorkspaceProtectionFailure(error, "directory");
    });
    return { restoredFileCount };
  }

  private async currentProjectFiles(projectId: string): Promise<CurrentProjectFile[]> {
    const records = await this.ctx.storage.list({
      prefix: fileRecordProjectPrefix(projectId),
    });
    const currentFiles: CurrentProjectFile[] = [];
    for (const value of records.values()) {
      const file = ProjectFileSchema.parse(value);
      const versionValue = await this.ctx.storage.get(
        versionRecordKey(file.projectId, file.fileId, file.versionId),
      );
      const version = ProjectFileVersionSchema.parse(versionValue);
      assertCurrentProjectFile(file, version);
      currentFiles.push({ file, version });
    }
    currentFiles.sort((left, right) => left.file.path.localeCompare(right.file.path));
    return currentFiles;
  }

  private async workspaceUploadedFiles(sandboxId: string, uploadsPath: string) {
    try {
      return await this.client().listFiles(sandboxId, uploadsPath);
    } catch (error) {
      if (error instanceof DaytonaApiError && error.status === 404) {
        return [];
      }
      if (!isRecoverableWorkspaceMountError(error)) {
        throw error;
      }
      await this.restartSandboxForWorkspaceRecovery(sandboxId);
      try {
        return await this.client().listFiles(sandboxId, uploadsPath);
      } catch (retryError) {
        if (retryError instanceof DaytonaApiError && retryError.status === 404) {
          return [];
        }
        throw retryError;
      }
    }
  }

  private async readStoredProjectFile(version: ProjectFileVersion): Promise<Uint8Array> {
    const object = await this.env.R2_OUTPUTS.get(version.r2Key);
    if (!object) {
      throw new APIError(409, "conflict_state_invalid", "Stored project file is missing", {
        retriable: false,
      });
    }
    assertStoredProjectFile(object, version);
    const bytes = new Uint8Array(await object.arrayBuffer());
    if (bytes.byteLength !== version.sizeBytes || (await sha256Hex(bytes)) !== version.sha256) {
      throw new APIError(
        409,
        "conflict_state_invalid",
        "Stored project file contents are invalid",
        { retriable: false },
      );
    }
    return bytes;
  }

  private async prepareUploadedFileWrite(
    sandboxId: string,
    uploadsPath: string,
    workspacePath: string,
  ): Promise<void> {
    await this.client().createFolder(sandboxId, uploadsPath);
    const prepared = await this.client().execute(sandboxId, {
      command: [
        `chmod 0777 -- ${shellQuote(uploadsPath)}`,
        `if test -e ${shellQuote(workspacePath)}; then chmod 0666 -- ${shellQuote(workspacePath)}; fi`,
      ].join(" && "),
      timeout: 10,
    });
    if (prepared.exitCode !== 0) {
      logWorkspaceProtectionFailure(
        new Error("Workspace cache permissions could not be opened"),
        "prepare",
        prepared.exitCode,
      );
    }
  }

  private async protectUploadedFile(
    sandboxId: string,
    uploadsPath: string,
    workspacePath: string,
    workspaceTimestamp: string,
  ): Promise<void> {
    const protectedFile = await this.client().execute(sandboxId, {
      command: [
        "attempt=0",
        `while test "$attempt" -lt ${WORKSPACE_FILE_VISIBILITY_ATTEMPTS}; do`,
        `if test -f ${shellQuote(workspacePath)}; then`,
        `touch -d ${shellQuote(workspaceTimestamp)} -- ${shellQuote(workspacePath)} && chmod 0444 -- ${shellQuote(workspacePath)} && chmod 0555 -- ${shellQuote(uploadsPath)}`,
        "exit $?",
        "fi",
        "attempt=$((attempt + 1))",
        `sleep ${WORKSPACE_FILE_VISIBILITY_DELAY_MS / 1_000}`,
        "done",
        "exit 1",
      ].join("\n"),
      timeout: 10,
    });
    if (protectedFile.exitCode !== 0) {
      throw new APIError(
        502,
        "upstream_sandbox_failed",
        "Project file workspace could not be protected",
        { retriable: true },
      );
    }
  }

  private async protectUploadedDirectory(sandboxId: string, uploadsPath: string): Promise<void> {
    const protectedDirectory = await this.client().execute(sandboxId, {
      command: [
        `find ${shellQuote(uploadsPath)} -mindepth 1 -maxdepth 1 -type f -exec chmod 0444 -- {} +`,
        `chmod 0555 -- ${shellQuote(uploadsPath)}`,
      ].join(" && "),
      timeout: 10,
    });
    if (protectedDirectory.exitCode !== 0) {
      throw new APIError(
        502,
        "upstream_sandbox_failed",
        "Project file workspace could not be protected",
        { retriable: true },
      );
    }
  }

  private async listProjectFileRecords(projectId: string): Promise<{ files: ProjectFile[] }> {
    const records = await this.ctx.storage.list({
      prefix: fileRecordProjectPrefix(projectId),
    });
    const files = Array.from(records.values()).flatMap((value) => {
      const parsed = ProjectFileSchema.safeParse(value);
      return parsed.success ? [parsed.data] : [];
    });
    files.sort((left, right) => left.path.localeCompare(right.path));
    return ProjectFileListSchema.parse({ files });
  }

  private async deleteStoragePrefix(prefix: string): Promise<void> {
    while (true) {
      const records = await this.ctx.storage.list({ limit: DELETE_BATCH_SIZE, prefix });
      const keys = [...records.keys()];
      if (keys.length === 0) return;
      await this.ctx.storage.delete(keys);
    }
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
): boolean {
  if (!workspaceFile || workspaceFile.isDir || workspaceFile.size !== file.sizeBytes) {
    return true;
  }
  return (
    Date.parse(workspaceFile.modifiedAt) >
    Date.parse(file.updatedAt) + WORKSPACE_TIMESTAMP_TOLERANCE_MS
  );
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
  if (bytes.byteLength === file.sizeBytes && (await sha256Hex(bytes)) === file.sha256) {
    return;
  }
  throw new APIError(
    502,
    "upstream_sandbox_failed",
    "Project file restoration could not be verified",
    {
      retriable: true,
    },
  );
}

function logWorkspaceProtectionFailure(
  error: unknown,
  stage: "directory" | "file" | "prepare",
  exitCode?: number,
): void {
  createLogger().warn("project_upload_workspace_protection_failed", { error, exitCode, stage });
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

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function fileRecordProjectPrefix(projectId: string): string {
  return `${FILE_RECORD_PREFIX}${projectId}:`;
}

function fileRecordKey(projectId: string, fileId: string): string {
  return `${fileRecordProjectPrefix(projectId)}${fileId}`;
}

function versionRecordProjectPrefix(projectId: string): string {
  return `${VERSION_RECORD_PREFIX}${projectId}:`;
}

function versionRecordKey(projectId: string, fileId: string, versionId: string): string {
  return `${versionRecordProjectPrefix(projectId)}${fileId}:${versionId}`;
}
