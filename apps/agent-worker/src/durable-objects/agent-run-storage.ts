import {
  assertExactSqliteSchema,
  type ExpectedSqliteObject,
  setCurrentSqliteStorageVersion,
} from "@cheatcode/durable-storage";
import {
  type LogicalModelId,
  LogicalModelIdSchema,
  PRODUCTION_DEFAULT_MODEL_ID,
} from "@cheatcode/types";
import type { UIMessageChunk } from "ai";
import { isMessagePartRow, isSeqRow, type MessagePartRow } from "../streaming/ui-message-stream";
import {
  AGENT_RUN_MESSAGE_PART_MAX_BYTES,
  serializedChunkBytes,
} from "./agent-run-transcript-chunks";

const DELETION_TOMBSTONE_KEY = "deletion_tombstone";
const OWNER_USER_ID_KEY = "owner_user_id";
const RESOLVED_LOGICAL_MODEL_ID_KEY = "resolved_logical_model_id";
const RUN_STATUS_VALUES_SQL = "'pending','running','completed','failed','canceled'";

const MESSAGE_PART_PAGE_MAX_BYTES = 256 * 1024;
const MESSAGE_PART_PAGE_MAX_ROWS = 32;
const RUN_TABLE_SQL = `CREATE TABLE run (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  status TEXT NOT NULL CHECK (status IN (${RUN_STATUS_VALUES_SQL})),
  model_id TEXT NOT NULL CHECK (length(model_id) BETWEEN 1 AND 200),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  started_at INTEGER CHECK (started_at IS NULL OR started_at >= created_at),
  completed_at INTEGER CHECK (completed_at IS NULL OR completed_at >= created_at)
) STRICT`;
const MESSAGE_PART_TABLE_SQL = `CREATE TABLE message_part (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  part_type TEXT NOT NULL CHECK (length(part_type) BETWEEN 1 AND 100),
  payload_json TEXT NOT NULL CHECK (length(cast(payload_json AS blob)) <= ${AGENT_RUN_MESSAGE_PART_MAX_BYTES})
) STRICT`;
const RUN_STATE_TABLE_SQL = `CREATE TABLE run_state (
  key TEXT PRIMARY KEY CHECK (length(key) BETWEEN 1 AND 256),
  value TEXT NOT NULL CHECK (length(cast(value AS blob)) <= 1048576)
) STRICT`;
const AGENT_RUN_STORAGE_SCHEMA: readonly ExpectedSqliteObject[] = [
  { name: "message_part", sql: MESSAGE_PART_TABLE_SQL, tableName: "message_part", type: "table" },
  { name: "run", sql: RUN_TABLE_SQL, tableName: "run", type: "table" },
  { name: "run_state", sql: RUN_STATE_TABLE_SQL, tableName: "run_state", type: "table" },
];

export interface StoredRunIdentity {
  plannedLogicalModelId: LogicalModelId;
  runId: string;
}

export interface StoredRunSnapshot {
  completedAt: number | null;
  createdAt: number;
  lastSeq: number;
  messageCount: number;
  modelId: LogicalModelId;
  runId: string;
  startedAt: number | null;
  status: "canceled" | "completed" | "failed" | "running";
}

export function initializeAgentRunStorage(ctx: DurableObjectState): void {
  ctx.storage.transactionSync(() => {
    ctx.storage.sql.exec(RUN_TABLE_SQL);
    ctx.storage.sql.exec(MESSAGE_PART_TABLE_SQL);
    ctx.storage.sql.exec(RUN_STATE_TABLE_SQL);
    setCurrentSqliteStorageVersion(ctx);
  });
  assertAgentRunStorage(ctx);
}

/** Read-only presence probe; unlike initialization this does not create a stored object. */
export function hasAgentRunStorage(ctx: DurableObjectState): boolean {
  return (
    ctx.storage.sql
      .exec(
        "SELECT 1 AS present FROM sqlite_schema WHERE type = 'table' AND name = 'run_state' LIMIT 1",
      )
      .toArray().length > 0
  );
}

export function assertAgentRunStorage(ctx: DurableObjectState): void {
  assertExactSqliteSchema(ctx, AGENT_RUN_STORAGE_SCHEMA);
}

export function getRunStateTimestamp(ctx: DurableObjectState, key: string): number | null {
  const value = getRunStateValue(ctx, key);
  if (typeof value !== "string") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function getRunStateValue(ctx: DurableObjectState, key: string): string | undefined {
  const rows = ctx.storage.sql.exec("SELECT value FROM run_state WHERE key = ?", key).toArray();
  const row = rows[0];
  if (!row || typeof row !== "object") {
    return undefined;
  }
  const value = (row as Record<string, unknown>)["value"];
  return typeof value === "string" ? value : undefined;
}

export function setRunStateValue(ctx: DurableObjectState, key: string, value: string): void {
  ctx.storage.sql.exec("INSERT OR REPLACE INTO run_state (key, value) VALUES (?, ?)", key, value);
}

export function setAgentRunStage(ctx: DurableObjectState, stage: string): void {
  if (!isAgentRunDeleted(ctx)) setRunStateValue(ctx, "run_stage", stage);
}

/** Permanently claims this run-keyed object for deletion before any async cleanup yields. */
export function claimAgentRunDeletion(ctx: DurableObjectState, userId: string): boolean {
  return ctx.storage.transactionSync(() => {
    const ownerUserId = getRunStateValue(ctx, OWNER_USER_ID_KEY);
    if (ownerUserId && ownerUserId !== userId) {
      return false;
    }
    if (!ownerUserId) {
      setRunStateValue(ctx, OWNER_USER_ID_KEY, userId);
    }
    if (!getRunStateValue(ctx, DELETION_TOMBSTONE_KEY)) {
      setRunStateValue(ctx, DELETION_TOMBSTONE_KEY, new Date().toISOString());
    }
    return true;
  });
}

export function isAgentRunDeleted(ctx: DurableObjectState): boolean {
  return getRunStateValue(ctx, DELETION_TOMBSTONE_KEY) !== undefined;
}

export function deleteRunStateValues(ctx: DurableObjectState, keys: string[]): void {
  for (const key of keys) {
    ctx.storage.sql.exec("DELETE FROM run_state WHERE key = ?", key);
  }
}

export function upsertRunRow(ctx: DurableObjectState, input: StoredRunIdentity): void {
  const now = Date.now();
  ctx.storage.sql.exec(
    `INSERT OR REPLACE INTO run (
      id, status, model_id, created_at, started_at
    ) VALUES (?, ?, ?, ?, ?)`,
    input.runId,
    "running",
    input.plannedLogicalModelId,
    now,
    now,
  );
}

export function updateRunRowLogicalModelId(
  ctx: DurableObjectState,
  runId: string,
  logicalModelId: LogicalModelId,
): boolean {
  return ctx.storage.transactionSync(() => {
    ctx.storage.sql.exec("UPDATE run SET model_id = ? WHERE id = ?", logicalModelId, runId);
    const row = firstRecord(
      ctx.storage.sql.exec("SELECT model_id FROM run WHERE id = ?", runId).toArray(),
    );
    const isUpdated = row?.["model_id"] === logicalModelId;
    if (isUpdated) {
      setRunStateValue(ctx, RESOLVED_LOGICAL_MODEL_ID_KEY, logicalModelId);
    }
    return isUpdated;
  });
}

export function getResolvedRunLogicalModelId(ctx: DurableObjectState): LogicalModelId | undefined {
  return parseLogicalModelId(getRunStateValue(ctx, RESOLVED_LOGICAL_MODEL_ID_KEY));
}

export function updateRunRowStatus(
  ctx: DurableObjectState,
  status: "canceled" | "completed" | "failed" | "running",
): void {
  const runId = getRunStateValue(ctx, "run_id");
  if (!runId) {
    return;
  }
  const now = Date.now();
  ctx.storage.sql.exec(
    `UPDATE run
      SET status = ?,
        started_at = CASE WHEN ? = 'running' THEN COALESCE(started_at, ?) ELSE started_at END,
        completed_at = CASE WHEN ? IN ('completed','failed','canceled') THEN ? ELSE completed_at END
      WHERE id = ?`,
    status,
    status,
    now,
    status,
    now,
    runId,
  );
}

export function appendAgentRunMessagePart(ctx: DurableObjectState, chunk: UIMessageChunk): number {
  const payload = JSON.stringify(chunk);
  if (serializedChunkBytes(chunk) > AGENT_RUN_MESSAGE_PART_MAX_BYTES) {
    throw new RangeError("Agent run message part exceeds the durable per-event byte bound.");
  }
  ctx.storage.sql.exec(
    "INSERT INTO message_part (part_type, payload_json) VALUES (?, ?)",
    chunk.type,
    payload,
  );
  const row = ctx.storage.sql.exec("SELECT last_insert_rowid() AS seq").toArray()[0];
  if (!isSeqRow(row)) {
    throw new Error("Unable to read message part sequence.");
  }
  return row.seq;
}

/** Atomically appends a Workflow-owned event once across step retries and DO restarts. */
export function appendAgentRunMessagePartOnce(
  ctx: DurableObjectState,
  eventKey: string,
  chunk: UIMessageChunk,
): number | null {
  const stateKey = `workflow_event:${eventKey}`;
  if (stateKey.length > 256) {
    throw new RangeError("Workflow transcript event key exceeds the durable key bound.");
  }
  return ctx.storage.transactionSync(() => {
    if (getRunStateValue(ctx, stateKey) !== undefined) {
      return null;
    }
    const seq = appendAgentRunMessagePart(ctx, chunk);
    setRunStateValue(ctx, stateKey, String(seq));
    return seq;
  });
}

export function readAgentRunMessagePartPage(
  ctx: DurableObjectState,
  lastSeq: number,
): MessagePartRow[] {
  assertNextMessagePartBound(ctx, lastSeq);
  const rows: unknown[] = ctx.storage.sql
    .exec(
      `WITH candidates AS (
         SELECT seq, payload_json
           FROM message_part
          WHERE seq > ?
          ORDER BY seq
          LIMIT ?
       ), sized AS (
         SELECT seq, payload_json,
           sum(length(cast(payload_json AS blob))) OVER (ORDER BY seq) AS cumulative_bytes
           FROM candidates
       )
       SELECT seq, payload_json
         FROM sized
        WHERE cumulative_bytes <= ?
        ORDER BY seq`,
      lastSeq,
      MESSAGE_PART_PAGE_MAX_ROWS,
      MESSAGE_PART_PAGE_MAX_BYTES,
    )
    .toArray();
  if (!rows.every(isMessagePartRow)) {
    throw new TypeError("Transcript storage returned a malformed message-part row.");
  }
  return rows;
}

function assertNextMessagePartBound(ctx: DurableObjectState, lastSeq: number): void {
  const row = firstRecord(
    ctx.storage.sql
      .exec(
        `SELECT length(cast(payload_json AS blob)) AS payload_bytes
           FROM message_part
          WHERE seq > ?
          ORDER BY seq
          LIMIT 1`,
        lastSeq,
      )
      .toArray(),
  );
  const payloadBytes = row?.["payload_bytes"];
  if (typeof payloadBytes === "number" && payloadBytes > AGENT_RUN_MESSAGE_PART_MAX_BYTES) {
    throw new RangeError("Stored transcript event exceeds the supported durable byte bound.");
  }
}

export function readStoredRunSnapshot(ctx: DurableObjectState): StoredRunSnapshot | null {
  const rows = ctx.storage.sql
    .exec(
      `SELECT id, status, model_id, created_at, started_at, completed_at
       FROM run
       LIMIT 1`,
    )
    .toArray();
  const row = firstRecord(rows);
  if (!row) {
    return null;
  }
  const runId = stringColumn(row, "id");
  const status = runStatusColumn(row, "status");
  if (!runId || !status) {
    return null;
  }
  const messageStats = readMessageStats(ctx);
  return {
    completedAt: integerColumn(row, "completed_at"),
    createdAt: integerColumn(row, "created_at") ?? Date.now(),
    lastSeq: messageStats.lastSeq,
    messageCount: messageStats.messageCount,
    modelId: parseLogicalModelId(stringColumn(row, "model_id")) ?? PRODUCTION_DEFAULT_MODEL_ID,
    runId,
    startedAt: integerColumn(row, "started_at"),
    status,
  };
}

function readMessageStats(ctx: DurableObjectState): { lastSeq: number; messageCount: number } {
  const rows = ctx.storage.sql
    .exec("SELECT COUNT(*) AS message_count, COALESCE(MAX(seq), 0) AS last_seq FROM message_part")
    .toArray();
  const row = firstRecord(rows);
  return {
    lastSeq: row ? (integerColumn(row, "last_seq") ?? 0) : 0,
    messageCount: row ? (integerColumn(row, "message_count") ?? 0) : 0,
  };
}

function firstRecord(rows: unknown[]): Record<string, unknown> | null {
  const row = rows[0];
  return typeof row === "object" && row !== null ? (row as Record<string, unknown>) : null;
}

function stringColumn(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  return typeof value === "string" ? value : null;
}

function numberColumn(row: Record<string, unknown>, key: string): number | null {
  const value = row[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== "string") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function integerColumn(row: Record<string, unknown>, key: string): number | null {
  const value = numberColumn(row, key);
  return value === null ? null : Math.trunc(value);
}

function runStatusColumn(
  row: Record<string, unknown>,
  key: string,
): "canceled" | "completed" | "failed" | "running" | null {
  const value = stringColumn(row, key);
  if (value === "canceled" || value === "completed" || value === "failed" || value === "running") {
    return value;
  }
  return null;
}

function parseLogicalModelId(value: string | null | undefined): LogicalModelId | undefined {
  const parsed = LogicalModelIdSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
