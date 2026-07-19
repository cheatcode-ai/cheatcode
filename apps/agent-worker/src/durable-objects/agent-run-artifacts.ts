import {
  type ArtifactUploadIdentity,
  createDb,
  type DatabaseHandle,
  finalizeArtifactUpload,
  guardArtifactUpload,
  reserveArtifactUpload,
  withUserContext,
} from "@cheatcode/db";
import type { WorkerSecret } from "@cheatcode/env";
import {
  type AnalyticsBindings,
  APIError,
  type createLogger,
  createLogger as createRunLogger,
  emitUserEvent,
} from "@cheatcode/observability";
import type { ArtifactUploadInput, ArtifactUploadResult } from "@cheatcode/sandbox-contracts";
import type { AgentRunId, ProjectId, ThreadId, UserId } from "@cheatcode/types";
import { ArtifactKindSchema } from "@cheatcode/types/artifacts";

const ARTIFACT_DIGEST_DOMAIN = "cheatcode:artifact-upload:v2";
const MAX_ARTIFACT_BYTES = 32 * 1024 * 1024;
const MAX_CONTENT_TYPE_LENGTH = 255;
const VALID_CONTENT_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/iu;

type AgentRunLogger = ReturnType<typeof createLogger>;

interface ArtifactEnv extends AnalyticsBindings {
  DATABASE_CONTEXT_SIGNING_SECRET_AGENT: WorkerSecret;
  HYPERDRIVE: Hyperdrive;
  R2_OUTPUTS: R2Bucket;
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

interface PreparedArtifact {
  contentSha256: string;
  filename: string;
  identity: ArtifactUploadIdentity;
  outputId: string;
  r2Key: string;
}

export async function storeAgentArtifact({
  artifact,
  env,
  input,
}: StoreAgentArtifactOptions): Promise<ArtifactUploadResult> {
  assertArtifactUpload(artifact);
  const prepared = await prepareArtifact(artifact, input);
  const logger = createRunLogger({ threadId: input.threadId, userId: input.userId });
  const dbHandle = artifactDatabase(env);
  try {
    await persistPreparedArtifact(dbHandle, env, artifact, input, prepared);
    return artifactUploadResult(artifact, prepared);
  } finally {
    await closeDatabase(dbHandle, logger);
  }
}

async function prepareArtifact(
  artifact: ArtifactUploadInput,
  input: ArtifactRunInput,
): Promise<PreparedArtifact> {
  const filename = sanitizeFilename(artifact.filename);
  const contentSha256 = await sha256Hex(artifact.data);
  const outputId = await deterministicOutputId(artifact, input.runId, filename, contentSha256);
  const r2Key = outputObjectKey({
    agentRunId: input.runId,
    filename,
    outputId,
    projectId: input.projectId,
    userId: input.userId,
  });
  return {
    contentSha256,
    filename,
    identity: {
      agentRunId: input.runId,
      id: outputId,
      projectId: input.projectId,
      r2Key,
      userId: input.userId,
    },
    outputId,
    r2Key,
  };
}

async function persistPreparedArtifact(
  dbHandle: DatabaseHandle,
  env: ArtifactEnv,
  artifact: ArtifactUploadInput,
  input: ArtifactRunInput,
  prepared: PreparedArtifact,
): Promise<void> {
  const reservation = await withUserContext(dbHandle.db, input.userId, (db) =>
    reserveArtifactUpload(db, prepared.identity),
  );
  if (reservation.state === "committed") {
    await verifyCommittedArtifactObject(env, artifact, prepared);
    return;
  }
  if (reservation.state === "fenced") {
    throw unavailableArtifactOwnership();
  }
  const guard = await withUserContext(dbHandle.db, input.userId, (db) =>
    guardArtifactUpload(db, prepared.identity),
  );
  if (guard.state === "committed") {
    await verifyCommittedArtifactObject(env, artifact, prepared);
    return;
  }
  if (guard.state === "fenced") {
    throw unavailableArtifactOwnership();
  }
  if (guard.state === "reservation-lost") {
    throw lostArtifactReservation();
  }
  await putAndFinalize(dbHandle, env, artifact, input, prepared);
}

async function putAndFinalize(
  dbHandle: DatabaseHandle,
  env: ArtifactEnv,
  artifact: ArtifactUploadInput,
  input: ArtifactRunInput,
  prepared: PreparedArtifact,
): Promise<void> {
  await writeArtifactObject(env, artifact, prepared);
  const createdAt = new Date();
  const finalized = await withUserContext(dbHandle.db, input.userId, (db) =>
    finalizeArtifactUpload(db, {
      ...prepared.identity,
      createdAt,
      filename: prepared.filename,
      mimeType: artifact.contentType,
    }),
  );
  if (finalized.state === "committed") {
    emitFirstArtifactEvent(env, input, prepared.outputId, finalized.isFirstForUser);
    return;
  }
  await env.R2_OUTPUTS.delete(prepared.r2Key);
  if (finalized.state === "fenced") {
    throw unavailableArtifactOwnership();
  }
  throw lostArtifactReservation();
}

function artifactUploadResult(
  artifact: ArtifactUploadInput,
  prepared: PreparedArtifact,
): ArtifactUploadResult {
  return {
    filename: prepared.filename,
    kind: artifact.kind,
    mimeType: artifact.contentType,
    outputId: prepared.outputId,
    sizeBytes: artifact.data.byteLength,
  };
}

async function writeArtifactObject(
  env: ArtifactEnv,
  artifact: ArtifactUploadInput,
  identity: PreparedArtifact,
): Promise<void> {
  const stored = await env.R2_OUTPUTS.put(identity.r2Key, artifact.data, {
    customMetadata: {
      contentSha256: identity.contentSha256,
      filename: identity.filename,
      kind: artifact.kind,
      outputId: identity.outputId,
    },
    httpMetadata: { contentType: artifact.contentType },
    onlyIf: { etagDoesNotMatch: "*" },
    sha256: identity.contentSha256,
  });
  const object = stored ?? (await env.R2_OUTPUTS.head(identity.r2Key));
  assertStoredArtifactObject(object, artifact, identity);
}

async function verifyCommittedArtifactObject(
  env: ArtifactEnv,
  artifact: ArtifactUploadInput,
  identity: PreparedArtifact,
): Promise<void> {
  assertStoredArtifactObject(await env.R2_OUTPUTS.head(identity.r2Key), artifact, identity);
}

function assertStoredArtifactObject(
  object: R2Object | null,
  artifact: ArtifactUploadInput,
  identity: PreparedArtifact,
): void {
  const metadata = object?.customMetadata;
  const checksum = object?.checksums.sha256;
  if (
    !object ||
    object.key !== identity.r2Key ||
    object.size !== artifact.data.byteLength ||
    object.httpMetadata?.contentType !== artifact.contentType ||
    !metadata ||
    metadata["contentSha256"] !== identity.contentSha256 ||
    metadata["filename"] !== identity.filename ||
    metadata["kind"] !== artifact.kind ||
    metadata["outputId"] !== identity.outputId ||
    !checksum ||
    bytesToHex(new Uint8Array(checksum)) !== identity.contentSha256
  ) {
    throw invalidStoredArtifact();
  }
}

async function deterministicOutputId(
  artifact: ArtifactUploadInput,
  runId: AgentRunId,
  filename: string,
  contentSha256: string,
): Promise<string> {
  const digestInput = new TextEncoder().encode(
    [
      ARTIFACT_DIGEST_DOMAIN,
      runId,
      artifact.kind,
      artifact.contentType,
      filename,
      contentSha256,
    ].join("\0"),
  );
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", digestInput)).slice(0, 16);
  return uuidV8(bytes);
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", arrayBufferView(data))));
}

function arrayBufferView(data: Uint8Array): Uint8Array<ArrayBuffer> {
  return data.buffer instanceof ArrayBuffer
    ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    : new Uint8Array(data);
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function uuidV8(bytes: Uint8Array): string {
  const versionByte = bytes[6];
  const variantByte = bytes[8];
  if (versionByte === undefined || variantByte === undefined) {
    throw new Error("Artifact identity digest was incomplete");
  }
  bytes[6] = (versionByte & 0x0f) | 0x80;
  bytes[8] = (variantByte & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function emitFirstArtifactEvent(
  env: ArtifactEnv,
  input: ArtifactRunInput,
  outputId: string,
  isFirstForUser: boolean,
): void {
  if (isFirstForUser) {
    emitUserEvent(env, {
      eventId: `artifact:${outputId}`,
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
  if (!ArtifactKindSchema.safeParse(artifact.kind).success) {
    throw invalidArtifact("Artifact kind is invalid");
  }
}

function invalidArtifact(message: string): APIError {
  return new APIError(400, "tool_validation_failed", message, { retriable: false });
}

function unavailableArtifactOwnership(): APIError {
  return new APIError(409, "conflict_state_invalid", "Artifact run is no longer active", {
    retriable: false,
  });
}

function lostArtifactReservation(): APIError {
  return new APIError(409, "conflict_state_invalid", "Artifact upload reservation was removed", {
    retriable: true,
  });
}

function invalidStoredArtifact(): APIError {
  return new APIError(
    409,
    "conflict_state_invalid",
    "Artifact object identity does not match its durable upload intent",
    { retriable: false },
  );
}

function artifactDatabase(env: ArtifactEnv): DatabaseHandle {
  return createDb(env.HYPERDRIVE, {
    audience: "app_agent",
    signingSecret: env.DATABASE_CONTEXT_SIGNING_SECRET_AGENT,
  });
}

async function closeDatabase(dbHandle: DatabaseHandle, logger: AgentRunLogger): Promise<void> {
  try {
    await dbHandle.close();
  } catch (error) {
    logger.warn("db_close_failed", { error });
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
