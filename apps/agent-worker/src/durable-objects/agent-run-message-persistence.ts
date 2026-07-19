import { createDb, createThreadMessage, withUserContext } from "@cheatcode/db";
import { createLogger, type Logger } from "@cheatcode/observability";
import {
  AgentRunId,
  fragmentMessagePart,
  serializedMessagePartsBytes,
  ThreadId,
  TRANSCRIPT_SEGMENT_MAX_PARTS_BYTES,
  type UIMessagePart,
  UserId,
} from "@cheatcode/types";
import type { UIMessageChunk } from "ai";
import { type MessagePartRow, parseSequencedChunk } from "../streaming/ui-message-stream";
import type { AgentRunEnv } from "./agent-run-env";
import {
  deleteRunStateValues,
  getRunStateTimestamp,
  getRunStateValue,
  readAgentRunMessagePartPage,
  setRunStateValue,
} from "./agent-run-storage";
import { transcriptPartFromChunk } from "./agent-run-transcript-chunks";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface PersistAssistantMessageInput {
  ctx: DurableObjectState;
  env: AgentRunEnv;
  logger: Logger;
  runId: string;
  threadId: string;
  userId: string;
}

const PENDING_MESSAGE_ATTEMPT_KEY = "pending_assistant_message_attempt";
const PENDING_MESSAGE_RETRY_AT_KEY = "pending_assistant_message_retry_at";
const MIN_MESSAGE_RETRY_MS = 5_000;
const MAX_MESSAGE_RETRY_MS = 5 * 60 * 1_000;
const TEXT_PERSISTENCE_SLICE_CHARACTERS = 16 * 1024;

export async function persistOrQueueAssistantMessage(
  input: PersistAssistantMessageInput,
): Promise<void> {
  if (await persistAssistantMessage(input)) {
    clearPendingAssistantMessage(input.ctx);
    return;
  }
  queueAssistantMessageRetry(input.ctx, pendingMessageAttempt(input.ctx) + 1);
}

/** Retry the durable transcript using only identity already stored in the run object. */
export async function retryPendingAssistantMessage(
  ctx: DurableObjectState,
  env: AgentRunEnv,
): Promise<void> {
  if (pendingAssistantMessageRetryAt(ctx) > Date.now()) {
    return;
  }
  const identity = storedRunIdentity(ctx);
  if (!identity) {
    clearPendingAssistantMessage(ctx);
    return;
  }
  const logger = createLogger({ runId: identity.runId, userId: identity.userId });
  if (await persistAssistantMessage({ ctx, env, logger, ...identity })) {
    clearPendingAssistantMessage(ctx);
    return;
  }
  queueAssistantMessageRetry(ctx, pendingMessageAttempt(ctx) + 1);
}

export function pendingAssistantMessageRetryAt(ctx: DurableObjectState): number {
  if (pendingMessageAttempt(ctx) < 0) {
    return Number.POSITIVE_INFINITY;
  }
  const retryAt = Number(getRunStateValue(ctx, PENDING_MESSAGE_RETRY_AT_KEY));
  return Number.isFinite(retryAt) && retryAt > 0 ? retryAt : Date.now();
}

async function persistAssistantMessage({
  ctx,
  env,
  logger,
  runId,
  threadId,
  userId,
}: PersistAssistantMessageInput): Promise<boolean> {
  if (!UUID_PATTERN.test(runId) || !UUID_PATTERN.test(threadId)) {
    return true;
  }
  const createdAt = transcriptCreatedAt(ctx);
  const { db, close } = createDb(env.HYPERDRIVE, {
    audience: "app_agent",
    signingSecret: env.DATABASE_CONTEXT_SIGNING_SECRET_AGENT,
  });
  try {
    const writer = new AssistantTranscriptWriter(async (parts, segment, isFinal) => {
      await withUserContext(db, UserId(userId), (tx) =>
        createThreadMessage(tx, {
          agentRunId: AgentRunId(runId),
          agentRunSegment: segment,
          agentRunSegmentFinal: isFinal,
          createdAt,
          parts,
          role: "assistant",
          threadId: ThreadId(threadId),
          userId: UserId(userId),
        }),
      );
    });
    await writeAssistantTranscript(writer, (lastSeq) => readRowsPage(ctx, lastSeq));
    return true;
  } catch (error) {
    logger.error("assistant_message_persist_failed", {
      error,
      runId,
    });
    return false;
  } finally {
    await close().catch((error: unknown) => {
      logger.warn("assistant_message_db_close_failed", {
        error,
      });
    });
  }
}

function readRowsPage(ctx: DurableObjectState, lastSeq: number): MessagePartRow[] {
  return readAgentRunMessagePartPage(ctx, lastSeq);
}

function transcriptCreatedAt(ctx: DurableObjectState): Date {
  const stored = getRunStateTimestamp(ctx, "completed_at");
  if (stored !== null) {
    return new Date(stored);
  }
  const fallback = Date.now();
  setRunStateValue(ctx, "completed_at", String(fallback));
  return new Date(fallback);
}

function storedRunIdentity(
  ctx: DurableObjectState,
): Pick<PersistAssistantMessageInput, "runId" | "threadId" | "userId"> | null {
  const runId = getRunStateValue(ctx, "run_id");
  const threadId = getRunStateValue(ctx, "thread_id");
  const userId = getRunStateValue(ctx, "owner_user_id");
  return runId && threadId && userId ? { runId, threadId, userId } : null;
}

function pendingMessageAttempt(ctx: DurableObjectState): number {
  const attempt = Number(getRunStateValue(ctx, PENDING_MESSAGE_ATTEMPT_KEY));
  return Number.isInteger(attempt) && attempt >= 0 ? attempt : -1;
}

function queueAssistantMessageRetry(ctx: DurableObjectState, attempt: number): void {
  setRunStateValue(ctx, PENDING_MESSAGE_ATTEMPT_KEY, String(attempt));
  setRunStateValue(
    ctx,
    PENDING_MESSAGE_RETRY_AT_KEY,
    String(Date.now() + messageRetryDelay(attempt)),
  );
}

function clearPendingAssistantMessage(ctx: DurableObjectState): void {
  deleteRunStateValues(ctx, [PENDING_MESSAGE_ATTEMPT_KEY, PENDING_MESSAGE_RETRY_AT_KEY]);
}

function messageRetryDelay(attempt: number): number {
  return Math.min(MAX_MESSAGE_RETRY_MS, MIN_MESSAGE_RETRY_MS * 2 ** Math.min(attempt, 6));
}

async function writeAssistantTranscript(
  writer: AssistantTranscriptWriter,
  readRowsPage: (lastSeq: number) => MessagePartRow[],
): Promise<void> {
  const assembler = new AssistantPartAssembler(writer);
  let cursor = 0;
  for (;;) {
    const rows = readRowsPage(cursor);
    if (rows.length === 0) {
      break;
    }
    for (const row of rows) {
      const sequenced = parseSequencedChunk(row);
      cursor = sequenced.seq;
      await assembler.append(sequenced.seq, sequenced.chunk);
    }
  }
  await assembler.finish();
  await writer.finish();
}

type PersistSegment = (parts: UIMessagePart[], segment: number, isFinal: boolean) => Promise<void>;

class AssistantTranscriptWriter {
  private currentBytes = 2;
  private currentParts: UIMessagePart[] = [];
  private nextSegment = 0;
  private pendingParts: UIMessagePart[] | null = null;

  public constructor(private readonly persist: PersistSegment) {}

  public async append(part: UIMessagePart, partId: string): Promise<void> {
    const candidates =
      serializedPartBytes(part) + 2 > TRANSCRIPT_SEGMENT_MAX_PARTS_BYTES
        ? fragmentMessagePart(part, partId)
        : [part];
    for (const candidate of candidates) {
      await this.appendBounded(candidate);
    }
  }

  public async finish(): Promise<void> {
    await this.stageCurrent();
    if (this.pendingParts) {
      await this.persist(this.pendingParts, this.nextSegment, true);
      this.pendingParts = null;
    }
  }

  private async appendBounded(part: UIMessagePart): Promise<void> {
    const partBytes = serializedPartBytes(part);
    const separatorBytes = this.currentParts.length === 0 ? 0 : 1;
    if (this.currentBytes + separatorBytes + partBytes > TRANSCRIPT_SEGMENT_MAX_PARTS_BYTES) {
      await this.stageCurrent();
    }
    if (partBytes + 2 > TRANSCRIPT_SEGMENT_MAX_PARTS_BYTES) {
      throw new RangeError("Transcript fragment exceeds the segment byte bound.");
    }
    this.currentBytes += (this.currentParts.length === 0 ? 0 : 1) + partBytes;
    this.currentParts.push(part);
  }

  private async stageCurrent(): Promise<void> {
    if (this.currentParts.length === 0) {
      return;
    }
    if (this.pendingParts) {
      await this.persist(this.pendingParts, this.nextSegment, false);
      this.nextSegment += 1;
    }
    this.pendingParts = this.currentParts;
    this.currentParts = [];
    this.currentBytes = 2;
  }
}

class AssistantPartAssembler {
  private bufferedTextCharacters = 0;
  private readonly bufferedTextChunks: string[] = [];
  private openTextId: string | null = null;
  private textPartSeq = 0;

  public constructor(private readonly writer: AssistantTranscriptWriter) {}

  public async append(seq: number, chunk: UIMessageChunk): Promise<void> {
    if (chunk.type === "text-start") {
      await this.switchTextPart(chunk.id, seq);
      return;
    }
    if (chunk.type === "text-delta") {
      await this.switchTextPart(chunk.id, seq);
      await this.appendText(chunk.delta);
      return;
    }
    if (chunk.type === "text-end") {
      await this.flushText();
      this.openTextId = null;
      return;
    }
    await this.flushText();
    const part = partFromChunk(chunk);
    if (part) {
      await this.writer.append(part, String(seq));
    }
  }

  public async finish(): Promise<void> {
    await this.flushText();
  }

  private async switchTextPart(id: string, seq: number): Promise<void> {
    if (this.openTextId === id) {
      return;
    }
    await this.flushText();
    this.openTextId = id;
    this.textPartSeq = seq;
  }

  private async appendText(value: string): Promise<void> {
    let offset = 0;
    while (offset < value.length) {
      const end = safeTextSliceEnd(value, offset);
      const chunk = value.slice(offset, end);
      if (
        this.bufferedTextCharacters > 0 &&
        this.bufferedTextCharacters + chunk.length > TEXT_PERSISTENCE_SLICE_CHARACTERS
      ) {
        await this.flushText();
      }
      this.bufferedTextChunks.push(chunk);
      this.bufferedTextCharacters += chunk.length;
      offset = end;
    }
  }

  private async flushText(): Promise<void> {
    if (this.bufferedTextCharacters === 0) {
      return;
    }
    const text = this.bufferedTextChunks.join("");
    this.bufferedTextChunks.length = 0;
    this.bufferedTextCharacters = 0;
    await this.writer.append({ state: "done", text, type: "text" }, `text-${this.textPartSeq}`);
  }
}

function partFromChunk(chunk: UIMessageChunk): UIMessagePart | null {
  return transcriptPartFromChunk(chunk);
}

function serializedPartBytes(part: UIMessagePart): number {
  return serializedMessagePartsBytes([part]) - 2;
}

function safeTextSliceEnd(value: string, offset: number): number {
  const candidate = Math.min(value.length, offset + TEXT_PERSISTENCE_SLICE_CHARACTERS);
  if (candidate === value.length) {
    return candidate;
  }
  const previous = value.charCodeAt(candidate - 1);
  const next = value.charCodeAt(candidate);
  return previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff
    ? candidate - 1
    : candidate;
}
