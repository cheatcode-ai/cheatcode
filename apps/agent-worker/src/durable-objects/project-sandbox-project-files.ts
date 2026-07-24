import { workspacePathForSlug } from "@cheatcode/db";
import { APIError } from "@cheatcode/observability";
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
import {
  type ProjectListUploadedFilesInput,
  ProjectListUploadedFilesInputSchema,
  type ProjectUploadFileInput,
  ProjectUploadFileInputSchema,
} from "./project-sandbox-runtime";
import { ProjectSandboxWorkspaceTransition } from "./project-sandbox-workspace-transition";

const FILE_DIGEST_DOMAIN = "cheatcode:project-file:v2";
const VERSION_DIGEST_DOMAIN = "cheatcode:project-file-version:v2";
const FILE_RECORD_PREFIX = "project-file:";
const VERSION_RECORD_PREFIX = "project-file-version:";
const DELETE_BATCH_SIZE = 128;

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

export abstract class ProjectSandboxProjectFiles extends ProjectSandboxWorkspaceTransition {
  private projectFileMutationTail: Promise<void> = Promise.resolve();

  public listUploadedFiles(
    input: ProjectListUploadedFilesInput,
  ): Promise<{ files: ProjectFile[] }> {
    const parsed = ProjectListUploadedFilesInputSchema.parse(input);
    return this.listProjectFileRecords(parsed.projectId);
  }

  public uploadProjectFile(input: ProjectUploadFileInput): Promise<ProjectFileUploadResponse> {
    const parsed = ProjectUploadFileInputSchema.parse(input);
    const operation = this.projectFileMutationTail
      .catch(() => undefined)
      .then(() => this.persistProjectFile(parsed));
    this.projectFileMutationTail = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
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
    const version = projectFileVersion(input, prepared);
    const previousVersion = await this.storedVersion(version);
    const status = existing
      ? existing.versionId === prepared.versionId
        ? "unchanged"
        : "updated"
      : "created";
    await this.writeAndVerifyObject(input, version);
    try {
      await this.materializeProjectFile(input, prepared.contentSha256);
      const file = await this.commitProjectFile(input, prepared, existing, previousVersion);
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
  ): Promise<ProjectFile> {
    const now = new Date().toISOString();
    const file = ProjectFileSchema.parse({
      contentType: input.contentType,
      createdAt: existing?.createdAt ?? now,
      fileId: prepared.fileId,
      name: input.name,
      path: input.path,
      projectId: input.projectId,
      sha256: prepared.contentSha256,
      sizeBytes: input.bytes.byteLength,
      updatedAt: existing?.versionId === prepared.versionId ? existing.updatedAt : now,
      versionCount: (existing?.versionCount ?? 0) + (previousVersion ? 0 : 1),
      versionId: prepared.versionId,
    });
    await this.ctx.storage.transaction(async (transaction) => {
      if (!previousVersion) {
        await transaction.put(
          versionRecordKey(input.projectId, prepared.fileId, prepared.versionId),
          projectFileVersion(input, prepared),
        );
      }
      await transaction.put(fileRecordKey(input.projectId, prepared.fileId), file);
    });
    return file;
  }

  private async materializeProjectFile(
    input: z.output<typeof ProjectUploadFileInputSchema>,
    contentSha256: string,
  ): Promise<void> {
    const sandboxId = await this.ensureSandbox();
    const projectRoot = workspacePathForSlug(input.workspaceSlug);
    const workspacePath = `${projectRoot}/${input.path}`;
    let written: Uint8Array;
    try {
      written = await this.writeProjectFileToWorkspace(
        sandboxId,
        projectRoot,
        workspacePath,
        input.bytes,
      );
    } catch (error) {
      if (!isRecoverableWorkspaceMountError(error)) {
        throw error;
      }
      await this.restartSandboxForWorkspaceRecovery(sandboxId);
      written = await this.writeProjectFileToWorkspace(
        sandboxId,
        projectRoot,
        workspacePath,
        input.bytes,
      );
    }
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

  private async writeProjectFileToWorkspace(
    sandboxId: string,
    projectRoot: string,
    workspacePath: string,
    bytes: Uint8Array,
  ): Promise<Uint8Array> {
    await this.client().createFolder(sandboxId, `${projectRoot}/uploads`);
    await this.client().uploadFile(sandboxId, workspacePath, bytes);
    return this.client().downloadFile(sandboxId, workspacePath, bytes.byteLength);
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
): ProjectFileVersion {
  return ProjectFileVersionSchema.parse({
    contentType: input.contentType,
    createdAt: new Date().toISOString(),
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

function versionRecordProjectPrefix(projectId: string): string {
  return `${VERSION_RECORD_PREFIX}${projectId}:`;
}

function versionRecordKey(projectId: string, fileId: string, versionId: string): string {
  return `${versionRecordProjectPrefix(projectId)}${fileId}:${versionId}`;
}
