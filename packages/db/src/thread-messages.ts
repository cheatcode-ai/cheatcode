import { ThreadId, UIMessageRecordSchema, type UserId } from "@cheatcode/types";
import { and, desc, eq, sql } from "drizzle-orm";
import type { Database } from "./client";
import { messageFromRow, messageReturningColumns } from "./project-mappers";
import type {
  CreateMessageInput,
  MessageRecord,
  ThreadContextMessageRecord,
  TimestampPageCursor,
  TimestampPageRecord,
} from "./project-types";
import { messages, threads } from "./schema";

const THREAD_CONTEXT_MAX_MESSAGES = 64;
const THREAD_CONTEXT_MAX_SERIALIZED_BYTES = 1024 * 1024;

interface ThreadContextQueryInput {
  maxMessages: number;
  maxSerializedBytes: number;
  threadId: ThreadId;
  userId: UserId;
}

export async function listThreadMessages(
  db: Database,
  input: { cursor?: TimestampPageCursor; limit: number; threadId: ThreadId; userId: UserId },
): Promise<TimestampPageRecord<MessageRecord>[]> {
  const rows = await db
    .select({
      ...messageReturningColumns(),
      pageCursorAt:
        sql<string>`to_char(${messages.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`.as(
          "page_cursor_at",
        ),
    })
    .from(messages)
    .where(
      and(
        eq(messages.threadId, input.threadId),
        eq(messages.userId, input.userId),
        messagePageCondition(input.cursor),
      ),
    )
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(boundedPageLimit(input.limit));
  return rows.map((row) => ({ ...messageFromRow(row), pageCursorAt: row.pageCursorAt }));
}

/**
 * Returns the newest complete suffix that fits both limits. PostgreSQL applies
 * the cumulative byte bound before rows cross the Hyperdrive/Worker boundary.
 */
export async function listRecentThreadContextMessages(
  db: Database,
  input: ThreadContextQueryInput,
): Promise<ThreadContextMessageRecord[]> {
  assertThreadContextLimits(input);
  const result = await db.execute(threadContextQuery(input));
  return contextMessagesFromRows(result.rows);
}

function threadContextQuery(input: ThreadContextQueryInput) {
  return sql`
    with newest as materialized (
      select agent_run_id, created_at, id, parts, role, thread_id,
        octet_length(
          jsonb_build_object(
            'agentRunId', agent_run_id, 'createdAt', created_at, 'id', id,
            'parts', parts, 'role', role, 'threadId', thread_id
          )::text
        )::int as serialized_bytes
      from ${messages}
      where user_id = ${input.userId}
        and thread_id = ${input.threadId}
        and role in ('user', 'assistant')
      order by created_at desc, id desc
      limit ${input.maxMessages}
    ), sized as (
      select
        *,
        sum(serialized_bytes) over (
          order by created_at desc, id desc
          rows between unbounded preceding and current row
        ) as cumulative_bytes
      from newest
    )
    select agent_run_id, created_at, id, parts, role, serialized_bytes, thread_id
    from sized
    where cumulative_bytes <= ${input.maxSerializedBytes}
    order by created_at asc, id asc
  `;
}

function assertThreadContextLimits(input: {
  maxMessages: number;
  maxSerializedBytes: number;
}): void {
  if (!Number.isSafeInteger(input.maxMessages) || input.maxMessages < 1) {
    throw new RangeError("Thread context maxMessages must be a positive safe integer.");
  }
  if (input.maxMessages > THREAD_CONTEXT_MAX_MESSAGES) {
    throw new RangeError(`Thread context cannot exceed ${THREAD_CONTEXT_MAX_MESSAGES} messages.`);
  }
  if (!Number.isSafeInteger(input.maxSerializedBytes) || input.maxSerializedBytes < 1) {
    throw new RangeError("Thread context maxSerializedBytes must be a positive safe integer.");
  }
  if (input.maxSerializedBytes > THREAD_CONTEXT_MAX_SERIALIZED_BYTES) {
    throw new RangeError(
      `Thread context cannot exceed ${THREAD_CONTEXT_MAX_SERIALIZED_BYTES} serialized bytes.`,
    );
  }
}

function contextMessagesFromRows(rows: unknown[]): ThreadContextMessageRecord[] {
  return rows.map((value) => {
    if (!isRecord(value)) {
      throw new TypeError("Thread context query returned a non-object row");
    }
    const serializedBytes = value["serialized_bytes"];
    if (!Number.isSafeInteger(serializedBytes) || Number(serializedBytes) < 0) {
      throw new TypeError("Thread context query returned an invalid serialized byte count");
    }
    const parsed = UIMessageRecordSchema.parse({
      agentRunId: value["agent_run_id"],
      createdAt: isoTimestamp(value["created_at"]),
      id: value["id"],
      parts: value["parts"],
      role: value["role"],
      threadId: value["thread_id"],
    });
    return {
      ...parsed,
      createdAt: new Date(parsed.createdAt),
      serializedBytes: Number(serializedBytes),
      threadId: ThreadId(parsed.threadId),
    };
  });
}

function isoTimestamp(value: unknown): string {
  const timestamp = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(timestamp.getTime())) {
    throw new TypeError("Thread context query returned an invalid creation timestamp");
  }
  return timestamp.toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function messagePageCondition(cursor: TimestampPageCursor | undefined) {
  return cursor
    ? sql`(${messages.createdAt} < ${cursor.at}::timestamptz or (${messages.createdAt} = ${cursor.at}::timestamptz and ${messages.id} < ${cursor.id}::uuid))`
    : undefined;
}

function boundedPageLimit(limit: number): number {
  return Math.max(1, Math.min(101, Math.trunc(limit)));
}

export async function createThreadMessage(
  db: Database,
  input: CreateMessageInput,
): Promise<MessageRecord> {
  return db.transaction(async (tx) => createThreadMessageLocked(tx as Database, input));
}

async function createThreadMessageLocked(
  db: Database,
  input: CreateMessageInput,
): Promise<MessageRecord> {
  const existing = await findAssistantMessageIfIdempotent(db, input);
  if (existing) {
    return existing;
  }
  const rows = await insertThreadMessage(db, input);
  const row = rows[0];
  if (!row) {
    return requireIdempotentAssistantMessage(db, input);
  }
  await db
    .update(threads)
    .set({ updatedAt: sql`now()` })
    .where(and(eq(threads.id, input.threadId), eq(threads.userId, input.userId)));
  return messageFromRow(row);
}

async function insertThreadMessage(db: Database, input: CreateMessageInput) {
  const insert = db.insert(messages).values({
    ...(input.agentRunId ? { agentRunId: input.agentRunId } : {}),
    parts: input.parts,
    role: input.role,
    threadId: input.threadId,
    userId: input.userId,
  });
  return isIdempotentAssistantInput(input)
    ? insert.onConflictDoNothing().returning(messageReturningColumns())
    : insert.returning(messageReturningColumns());
}

async function findAssistantMessageIfIdempotent(
  db: Database,
  input: CreateMessageInput,
): Promise<MessageRecord | null> {
  return isIdempotentAssistantInput(input) ? findIdempotentAssistantMessage(db, input) : null;
}

async function requireIdempotentAssistantMessage(
  db: Database,
  input: CreateMessageInput,
): Promise<MessageRecord> {
  const existing = await findAssistantMessageIfIdempotent(db, input);
  if (existing) {
    return existing;
  }
  throw new Error("Failed to create thread message");
}

function isIdempotentAssistantInput(input: CreateMessageInput): input is CreateMessageInput & {
  agentRunId: NonNullable<CreateMessageInput["agentRunId"]>;
  role: "assistant";
} {
  return input.role === "assistant" && input.agentRunId !== undefined;
}

async function findIdempotentAssistantMessage(
  db: Database,
  input: CreateMessageInput & { agentRunId: NonNullable<CreateMessageInput["agentRunId"]> },
): Promise<MessageRecord | null> {
  const identity = `cheatcode:assistant-message:${input.agentRunId}`;
  await db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${identity}, 0))`);
  const [row] = await db
    .select({
      ...messageReturningColumns(),
      partsMatch: sql<boolean>`${messages.parts} = ${JSON.stringify(input.parts)}::jsonb`,
      userId: messages.userId,
    })
    .from(messages)
    .where(and(eq(messages.agentRunId, input.agentRunId), eq(messages.role, "assistant")))
    .limit(1);
  if (!row) {
    return null;
  }
  if (row.threadId !== input.threadId || row.userId !== input.userId || !row.partsMatch) {
    throw new Error(`Assistant message conflict for agent run ${input.agentRunId}`);
  }
  return messageFromRow(row);
}
