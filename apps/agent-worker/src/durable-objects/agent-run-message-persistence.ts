import { createDb, createThreadMessage, withUserContext } from "@cheatcode/db";
import { createLogger, type Logger } from "@cheatcode/observability";
import type { UIMessagePart } from "@cheatcode/types";
import { AgentRunId, ThreadId, UserId } from "@cheatcode/types";
import type { UIMessageChunk } from "ai";
import {
  isMessagePartRow,
  type MessagePartRow,
  parseSequencedChunk,
} from "../streaming/ui-message-stream";
import type { AgentRunEnv } from "./agent-run-env";
import { deleteRunStateValues, getRunStateValue, setRunStateValue } from "./agent-run-storage";

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
const MESSAGE_PERSISTENCE_PAGE_SIZE = 100;

interface TextPartDraft {
  chunks: string[];
  index: number;
  isClosed: boolean;
}

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
  const parts = assistantPartsFromPages((lastSeq) => readRowsPage(ctx, lastSeq));
  if (parts.length === 0) {
    return true;
  }
  const { db, close } = createDb(env.HYPERDRIVE);
  try {
    await withUserContext(db, UserId(userId), (tx) =>
      createThreadMessage(tx, {
        agentRunId: AgentRunId(runId),
        parts,
        role: "assistant",
        threadId: ThreadId(threadId),
        userId: UserId(userId),
      }),
    );
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
  const rows: unknown[] = ctx.storage.sql
    .exec(
      `SELECT seq, payload_json FROM message_part
       WHERE seq > ? ORDER BY seq LIMIT ?`,
      lastSeq,
      MESSAGE_PERSISTENCE_PAGE_SIZE,
    )
    .toArray();
  return rows.filter(isMessagePartRow);
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

function assistantPartsFromPages(
  readRowsPage: (lastSeq: number) => MessagePartRow[],
): UIMessagePart[] {
  const output: UIMessagePart[] = [];
  const textParts = new Map<string, TextPartDraft>();
  let cursor = 0;
  for (;;) {
    const rows = readRowsPage(cursor);
    if (rows.length === 0) {
      break;
    }
    for (const row of rows) {
      const sequenced = parseSequencedChunk(row);
      cursor = sequenced.seq;
      appendChunkPart(sequenced.chunk, output, textParts);
    }
  }
  finalizeTextParts(output, textParts);
  return output.filter((part) => part.type !== "text" || textPartHasContent(part));
}

function appendChunkPart(
  chunk: UIMessageChunk,
  output: UIMessagePart[],
  textParts: Map<string, TextPartDraft>,
): void {
  if (chunk.type === "text-start") {
    ensureTextPart(chunk.id, output, textParts);
    return;
  }
  if (chunk.type === "text-delta") {
    const draft = ensureTextPart(chunk.id, output, textParts);
    draft.chunks.push(chunk.delta);
    draft.isClosed = false;
    return;
  }
  if (chunk.type === "text-end") {
    const draft = ensureTextPart(chunk.id, output, textParts);
    closeTextPart(output, draft);
    return;
  }
  if (chunk.type === "start-step") {
    output.push({ type: "step-start" });
    return;
  }
  if (isPersistableDataChunk(chunk) || isPersistableDisplayChunk(chunk)) {
    output.push(uiMessagePartFromChunk(chunk));
  }
}

function ensureTextPart(
  id: string,
  output: UIMessagePart[],
  textParts: Map<string, TextPartDraft>,
): TextPartDraft {
  const existing = textParts.get(id);
  if (existing) {
    return existing;
  }
  const draft = { chunks: [], index: output.length, isClosed: false };
  textParts.set(id, draft);
  output.push({ type: "text", text: "", state: "streaming" });
  return draft;
}

function closeTextPart(output: UIMessagePart[], draft: TextPartDraft): void {
  const text = draft.chunks.join("");
  output[draft.index] = { type: "text", text, state: "done" };
  draft.chunks = [text];
  draft.isClosed = true;
}

function finalizeTextParts(output: UIMessagePart[], textParts: Map<string, TextPartDraft>): void {
  for (const draft of textParts.values()) {
    if (!draft.isClosed) {
      closeTextPart(output, draft);
    }
  }
}

function isPersistableDataChunk(
  chunk: UIMessageChunk,
): chunk is UIMessageChunk & { type: `data-${string}` } {
  const value = chunkRecord(chunk);
  return (
    typeof value["type"] === "string" &&
    value["type"].startsWith("data-") &&
    value["type"] !== "data-seq" &&
    value["transient"] !== true
  );
}

function isPersistableDisplayChunk(chunk: UIMessageChunk): boolean {
  return chunk.type === "file" || chunk.type === "source-url" || chunk.type === "source-document";
}

function uiMessagePartFromChunk(chunk: UIMessageChunk): UIMessagePart {
  const value = chunkRecord(chunk);
  if (chunk.type === "file") {
    return {
      type: chunk.type,
      mediaType: value["mediaType"],
      url: value["url"],
      ...(typeof value["filename"] === "string" ? { filename: value["filename"] } : {}),
    };
  }
  if (chunk.type === "source-url") {
    return {
      type: chunk.type,
      sourceId: value["sourceId"],
      url: value["url"],
      ...(typeof value["title"] === "string" ? { title: value["title"] } : {}),
    };
  }
  if (chunk.type === "source-document") {
    return {
      type: chunk.type,
      mediaType: value["mediaType"],
      sourceId: value["sourceId"],
      title: value["title"],
      ...(typeof value["filename"] === "string" ? { filename: value["filename"] } : {}),
    };
  }
  return {
    type: chunk.type,
    data: value["data"],
    ...(typeof value["id"] === "string" ? { id: value["id"] } : {}),
  };
}

function chunkRecord(chunk: UIMessageChunk): Record<string, unknown> {
  return Object(chunk) as Record<string, unknown>;
}

function textPartHasContent(part: UIMessagePart): boolean {
  return typeof part["text"] === "string" && part["text"].trim().length > 0;
}
