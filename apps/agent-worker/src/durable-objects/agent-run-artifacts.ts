import {
  createDb,
  type DatabaseHandle,
  ensureSandboxProject,
  hasGeneratedOutputForUser,
  saveGeneratedOutput,
  withUserContext,
} from "@cheatcode/db";
import {
  type AnalyticsBindings,
  type createLogger,
  createLogger as createRunLogger,
  emitUserEvent,
} from "@cheatcode/observability";
import type { ArtifactUploadInput, ArtifactUploadResult } from "@cheatcode/tools-code";
import { AgentRunId, ProjectId, UserId } from "@cheatcode/types";
import { createSignedOutputDownloadUrl } from "../output-download";

const DEFAULT_PROJECT_MODE = "web";
const OUTPUTS_BUCKET_NAME = "cheatcode-outputs";
const OUTPUT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

type AgentRunLogger = ReturnType<typeof createLogger>;

interface ArtifactEnv extends AnalyticsBindings {
  HYPERDRIVE: Hyperdrive;
  OUTPUT_DOWNLOAD_BASE_URL?: string;
  OUTPUT_DOWNLOAD_SIGNING_SECRET: string;
  R2_OUTPUTS: R2Bucket;
  R2_OUTPUTS_BUCKET_NAME?: string;
}

interface ArtifactRunInput {
  projectId: string;
  runId: string;
  threadId: string;
  userId: string;
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
  const outputId = crypto.randomUUID();
  const filename = sanitizeFilename(artifact.filename);
  const userId = UserId(input.userId);
  const bucketName = env.R2_OUTPUTS_BUCKET_NAME?.trim() || OUTPUTS_BUCKET_NAME;
  const dbHandle = createDb(env.HYPERDRIVE);
  const logger = createRunLogger({ threadId: input.threadId, userId: input.userId });

  try {
    const projectId = await resolveArtifactProjectId(dbHandle, input, userId);
    const r2Key = outputObjectKey({
      agentRunId: input.runId,
      filename,
      outputId,
      projectId,
      userId: input.userId,
    });
    const sha256 = await sha256Hex(artifact.data);
    try {
      await env.R2_OUTPUTS.put(r2Key, artifact.data, {
        customMetadata: {
          filename,
          kind: artifact.kind,
          outputId,
        },
        httpMetadata: {
          contentType: artifact.contentType,
        },
      });
      const alreadyHadGeneratedOutput = await withUserContext(dbHandle.db, userId, async (db) => {
        const hadGeneratedOutput = await hasGeneratedOutputForUser(db, userId);
        await saveGeneratedOutput(db, {
          expiresAt: new Date(Date.now() + OUTPUT_RETENTION_MS),
          filename,
          id: outputId,
          kind: artifact.kind,
          metadata: artifact.metadata ?? {},
          mimeType: artifact.contentType,
          ...(isUuid(input.runId) ? { agentRunId: AgentRunId(input.runId) } : {}),
          projectId,
          r2Bucket: bucketName,
          r2Key,
          sha256,
          sizeBytes: artifact.data.byteLength,
          userId,
        });
        return hadGeneratedOutput;
      });
      if (!alreadyHadGeneratedOutput) {
        emitUserEvent(env, {
          eventName: "first_generated_artifact",
          runId: input.runId,
          userId: input.userId,
        });
      }
    } catch (error) {
      await env.R2_OUTPUTS.delete(r2Key).catch(() => undefined);
      throw error;
    }

    return {
      downloadUrl: await signedOutputUrl(outputId, env),
      filename,
      kind: artifact.kind,
      mimeType: artifact.contentType,
      outputId,
      r2Key,
      sizeBytes: artifact.data.byteLength,
    };
  } finally {
    await closeDatabase(dbHandle, logger);
  }
}

async function resolveArtifactProjectId(
  dbHandle: DatabaseHandle,
  input: ArtifactRunInput,
  userId: UserId,
): Promise<ProjectId> {
  if (isUuid(input.projectId)) {
    return ProjectId(input.projectId);
  }
  const project = await withUserContext(dbHandle.db, userId, (db) =>
    ensureSandboxProject(db, {
      mode: DEFAULT_PROJECT_MODE,
      name: projectNameFromThreadId(input.threadId),
      sandboxId: input.projectId,
      userId,
    }),
  );
  return project.id;
}

function signedOutputUrl(outputId: string, env: ArtifactEnv): Promise<string> {
  return createSignedOutputDownloadUrl({
    baseUrl: env.OUTPUT_DOWNLOAD_BASE_URL,
    outputId,
    secret: env.OUTPUT_DOWNLOAD_SIGNING_SECRET,
  });
}

async function closeDatabase(dbHandle: DatabaseHandle, logger: AgentRunLogger): Promise<void> {
  try {
    await dbHandle.close();
  } catch (error) {
    logger.warn("db_close_failed", {
      error: error instanceof Error ? error.message : "Unknown database close error",
    });
  }
}

function projectNameFromThreadId(threadId: string): string {
  return threadId.replaceAll("-", " ").slice(0, 60) || "Cheatcode Project";
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
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
