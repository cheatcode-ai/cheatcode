import {
  createDb,
  type DatabaseHandle,
  getProject,
  saveGeneratedOutput,
  withUserContext,
} from "@cheatcode/db";
import { resolveWorkerSecret, type WorkerSecret } from "@cheatcode/env";
import {
  type AnalyticsBindings,
  APIError,
  type createLogger,
  createLogger as createRunLogger,
  emitUserEvent,
} from "@cheatcode/observability";
import type { ArtifactUploadInput, ArtifactUploadResult } from "@cheatcode/sandbox-contracts";
import type { AgentRunId, ProjectId, ThreadId, UserId } from "@cheatcode/types";
import { createSignedOutputDownloadUrl } from "../output-download";

const MAX_ARTIFACT_BYTES = 32 * 1024 * 1024;
const MAX_ARTIFACT_METADATA_BYTES = 64 * 1024;
const MAX_CONTENT_TYPE_LENGTH = 255;
const OUTPUTS_BUCKET_NAME = "cheatcode-outputs";
const OUTPUT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const VALID_ARTIFACT_KINDS = new Set(["audio", "docx", "image", "pdf", "slide", "video", "xlsx"]);
const VALID_CONTENT_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/iu;

type AgentRunLogger = ReturnType<typeof createLogger>;

interface ArtifactEnv extends AnalyticsBindings {
  HYPERDRIVE: Hyperdrive;
  OUTPUT_DOWNLOAD_BASE_URL?: string;
  OUTPUT_DOWNLOAD_SIGNING_SECRET: WorkerSecret;
  PREVIEW_HOSTNAME: string;
  R2_OUTPUTS: R2Bucket;
  R2_OUTPUTS_BUCKET_NAME?: string;
}

interface ArtifactRunInput {
  projectId: ProjectId;
  runId: AgentRunId;
  threadId: ThreadId;
  userId: UserId;
}

interface StoreAgentArtifactOptions {
  artifact: ArtifactUploadInput;
  env: ArtifactEnv;
  input: ArtifactRunInput;
}

export async function storeAgentArtifact({
  artifact,
  env,
  input,
}: StoreAgentArtifactOptions): Promise<ArtifactUploadResult> {
  assertArtifactUpload(artifact);
  const outputId = crypto.randomUUID();
  const filename = sanitizeFilename(artifact.filename);
  // Resolve the signed URL before writing either durable store. A missing signing secret must not
  // leave an inaccessible R2 object or database row behind for a retry to duplicate.
  const downloadUrl = await signedOutputUrl(outputId, env);
  const bucketName = env.R2_OUTPUTS_BUCKET_NAME?.trim() || OUTPUTS_BUCKET_NAME;
  const logger = createRunLogger({ threadId: input.threadId, userId: input.userId });
  const projectId = await requireArtifactProject(env, input, logger);
  const r2Key = outputObjectKey({
    agentRunId: input.runId,
    filename,
    outputId,
    projectId,
    userId: input.userId,
  });
  const sha256 = await sha256Hex(artifact.data);
  await writeArtifactObject(env, artifact, { filename, outputId, r2Key });
  let alreadyHadGeneratedOutput: boolean;
  try {
    alreadyHadGeneratedOutput = await persistGeneratedArtifact({
      artifact,
      bucketName,
      env,
      filename,
      input,
      outputId,
      projectId,
      r2Key,
      sha256,
      userId: input.userId,
      logger,
    });
  } catch (error) {
    await env.R2_OUTPUTS.delete(r2Key).catch(() => undefined);
    throw error;
  }
  emitFirstArtifactEvent(env, input, alreadyHadGeneratedOutput);
  return artifactUploadResult(artifact, { downloadUrl, filename, outputId, r2Key });
}

function artifactUploadResult(
  artifact: ArtifactUploadInput,
  identity: { downloadUrl: string; filename: string; outputId: string; r2Key: string },
): ArtifactUploadResult {
  return {
    downloadUrl: identity.downloadUrl,
    filename: identity.filename,
    kind: artifact.kind,
    mimeType: artifact.contentType,
    outputId: identity.outputId,
    r2Key: identity.r2Key,
    sizeBytes: artifact.data.byteLength,
  };
}

async function writeArtifactObject(
  env: ArtifactEnv,
  artifact: ArtifactUploadInput,
  identity: { filename: string; outputId: string; r2Key: string },
): Promise<void> {
  await env.R2_OUTPUTS.put(identity.r2Key, artifact.data, {
    customMetadata: {
      filename: identity.filename,
      kind: artifact.kind,
      outputId: identity.outputId,
    },
    httpMetadata: { contentType: artifact.contentType },
  });
}

async function persistGeneratedArtifact(options: {
  artifact: ArtifactUploadInput;
  bucketName: string;
  env: ArtifactEnv;
  filename: string;
  input: ArtifactRunInput;
  logger: AgentRunLogger;
  outputId: string;
  projectId: ProjectId;
  r2Key: string;
  sha256: string;
  userId: UserId;
}): Promise<boolean> {
  const dbHandle = createDb(options.env.HYPERDRIVE);
  try {
    return await withUserContext(dbHandle.db, options.userId, async (db) => {
      const saved = await saveGeneratedOutput(db, generatedOutputRecord(options));
      return !saved.isFirstForUser;
    });
  } finally {
    await closeDatabase(dbHandle, options.logger);
  }
}

function generatedOutputRecord(options: {
  artifact: ArtifactUploadInput;
  bucketName: string;
  filename: string;
  input: ArtifactRunInput;
  outputId: string;
  projectId: ProjectId;
  r2Key: string;
  sha256: string;
  userId: UserId;
}) {
  return {
    expiresAt: new Date(Date.now() + OUTPUT_RETENTION_MS),
    filename: options.filename,
    id: options.outputId,
    kind: options.artifact.kind,
    metadata: options.artifact.metadata ?? {},
    mimeType: options.artifact.contentType,
    agentRunId: options.input.runId,
    projectId: options.projectId,
    r2Bucket: options.bucketName,
    r2Key: options.r2Key,
    sha256: options.sha256,
    sizeBytes: options.artifact.data.byteLength,
    userId: options.userId,
  };
}

function emitFirstArtifactEvent(
  env: ArtifactEnv,
  input: ArtifactRunInput,
  alreadyHadGeneratedOutput: boolean,
): void {
  if (!alreadyHadGeneratedOutput) {
    emitUserEvent(env, {
      eventName: "first_generated_artifact",
      runId: input.runId,
      userId: input.userId,
    });
  }
}

function assertArtifactUpload(artifact: ArtifactUploadInput): void {
  if (!(artifact.data instanceof Uint8Array)) {
    throw invalidArtifact("Artifact data must be binary");
  }
  if (artifact.data.byteLength === 0 || artifact.data.byteLength > MAX_ARTIFACT_BYTES) {
    throw invalidArtifact(`Artifact data must be between 1 byte and ${MAX_ARTIFACT_BYTES} bytes`);
  }
  if (!artifact.filename.trim() || artifact.filename.length > 255) {
    throw invalidArtifact("Artifact filename must be between 1 and 255 characters");
  }
  if (
    artifact.contentType.length > MAX_CONTENT_TYPE_LENGTH ||
    !VALID_CONTENT_TYPE.test(artifact.contentType)
  ) {
    throw invalidArtifact("Artifact content type is invalid");
  }
  if (!VALID_ARTIFACT_KINDS.has(artifact.kind)) {
    throw invalidArtifact("Artifact kind is invalid");
  }
  if (artifact.metadata && serializedByteLength(artifact.metadata) > MAX_ARTIFACT_METADATA_BYTES) {
    throw invalidArtifact(`Artifact metadata exceeds ${MAX_ARTIFACT_METADATA_BYTES} bytes`);
  }
}

function serializedByteLength(value: unknown): number {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) {
      throw new TypeError("Value is not JSON serializable");
    }
    return new TextEncoder().encode(serialized).byteLength;
  } catch {
    throw invalidArtifact("Artifact metadata must be JSON serializable");
  }
}

function invalidArtifact(message: string): APIError {
  return new APIError(400, "tool_validation_failed", message, { retriable: false });
}

async function requireArtifactProject(
  env: ArtifactEnv,
  input: ArtifactRunInput,
  logger: AgentRunLogger,
): Promise<ProjectId> {
  const dbHandle = createDb(env.HYPERDRIVE);
  try {
    const project = await withUserContext(dbHandle.db, input.userId, (db) =>
      getProject(db, { projectId: input.projectId, userId: input.userId }),
    );
    if (!project) {
      throw new APIError(404, "not_found_project", "Artifact project not found", {
        retriable: false,
      });
    }
    return project.id;
  } finally {
    await closeDatabase(dbHandle, logger);
  }
}

async function signedOutputUrl(outputId: string, env: ArtifactEnv): Promise<string> {
  const secret = await resolveWorkerSecret(env.OUTPUT_DOWNLOAD_SIGNING_SECRET);
  return createSignedOutputDownloadUrl({
    baseUrl: outputDownloadBaseUrl(env),
    outputId,
    secret,
  });
}

function outputDownloadBaseUrl(env: ArtifactEnv): string | undefined {
  const previewHostname = env.PREVIEW_HOSTNAME.trim();
  if (previewHostname === "localhost:8787" || previewHostname === "127.0.0.1:8787") {
    return `http://${previewHostname}`;
  }
  return env.OUTPUT_DOWNLOAD_BASE_URL;
}

async function closeDatabase(dbHandle: DatabaseHandle, logger: AgentRunLogger): Promise<void> {
  try {
    await dbHandle.close();
  } catch (error) {
    logger.warn("db_close_failed", {
      error,
    });
  }
}

function sanitizeFilename(filename: string): string {
  const parts = filename.split(".");
  const extension = parts.length > 1 ? parts.pop() : undefined;
  const base = parts
    .join(".")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
  const safeBase = base.length > 0 ? base : "cheatcode-output";
  if (!extension) {
    return safeBase;
  }
  const safeExtension = extension
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 12);
  return safeExtension.length > 0 ? `${safeBase}.${safeExtension}` : safeBase;
}

function outputObjectKey(input: {
  agentRunId: string;
  filename: string;
  outputId: string;
  projectId: string;
  userId: string;
}): string {
  return [
    input.userId,
    input.projectId,
    input.agentRunId,
    `${input.outputId}-${input.filename}`,
  ].join("/");
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  const buffer = new ArrayBuffer(data.byteLength);
  new Uint8Array(buffer).set(data);
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
