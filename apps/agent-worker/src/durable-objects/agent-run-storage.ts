import {
  type LogicalModelId,
  LogicalModelIdSchema,
  PRODUCTION_DEFAULT_MODEL_ID,
} from "@cheatcode/types";
import type { UIMessageChunk } from "ai";
import { isSeqRow } from "../streaming/ui-message-stream";

const DEFAULT_AGENT_NAME = "general";
const RESOLVED_LOGICAL_MODEL_ID_KEY = "resolved_logical_model_id";
const CURRENT_RUN_COLUMNS = [
  "id",
  "thread_id",
  "project_id",
  "user_id",
  "status",
  "model_id",
  "agent_name",
  "created_at",
  "started_at",
  "completed_at",
] as const;

export interface StoredRunIdentity {
  plannedLogicalModelId: LogicalModelId;
  projectId: string;
  runId: string;
  threadId: string;
  userId: string;
}

export interface StoredRunSnapshot {
  completedAt: number | null;
  createdAt: number;
  lastSeq: number;
  messageCount: number;
  modelId: LogicalModelId;
  runId: string;
  startedAt: number | null;
  status: "canceled" | "completed" | "failed" | "paused" | "running";
}

export function initializeAgentRunStorage(ctx: DurableObjectState): void {
  ensureCurrentRunTable(ctx);
  createMessagePartTable(ctx);
  createRunStateTable(ctx);
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

export function deleteRunStateValues(ctx: DurableObjectState, keys: string[]): void {
  for (const key of keys) {
    ctx.storage.sql.exec("DELETE FROM run_state WHERE key = ?", key);
  }
}

export function upsertRunRow(ctx: DurableObjectState, input: StoredRunIdentity): void {
  const now = Date.now();
  ctx.storage.sql.exec(
    `INSERT OR REPLACE INTO run (
      id, thread_id, project_id, user_id, status, model_id, agent_name, created_at, started_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    input.runId,
    input.threadId,
    input.projectId,
    input.userId,
    "running",
    input.plannedLogicalModelId,
    DEFAULT_AGENT_NAME,
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
  status: "canceled" | "completed" | "failed" | "paused" | "running",
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
  ctx.storage.sql.exec(
    `INSERT INTO message_part (
      message_id, role, part_type, part_id, payload_json, transient, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    "assistant",
    "assistant",
    chunk.type,
    chunkPartId(chunk),
    JSON.stringify(chunk),
    isTransientChunk(chunk) ? 1 : 0,
    Date.now(),
  );
  const row = ctx.storage.sql.exec("SELECT last_insert_rowid() AS seq").toArray()[0];
  if (!isSeqRow(row)) {
    throw new Error("Unable to read message part sequence.");
  }
  return row.seq;
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

function createRunTable(ctx: DurableObjectState, tableName = "run"): void {
  if (tableName !== "run" && tableName !== "run_current") {
    throw new Error("Invalid run table name.");
  }
  ctx.storage.sql.exec(
    `CREATE TABLE IF NOT EXISTS ${tableName} (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending','running','paused','completed','failed','canceled')),
      model_id TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      completed_at INTEGER
    )`,
  );
}

function ensureCurrentRunTable(ctx: DurableObjectState): void {
  const columns = ctx.storage.sql.exec("PRAGMA table_info(run)").toArray();
  if (columns.length === 0) {
    createRunTable(ctx);
    return;
  }
  const names = columns
    .map((row) => firstRecord([row])?.["name"])
    .filter((name): name is string => typeof name === "string");
  const isCurrent =
    names.length === CURRENT_RUN_COLUMNS.length &&
    CURRENT_RUN_COLUMNS.every((name) => names.includes(name));
  if (isCurrent) {
    return;
  }
  const canPreserve = CURRENT_RUN_COLUMNS.every((name) => names.includes(name));
  ctx.storage.transactionSync(() => {
    ctx.storage.sql.exec("DROP TABLE IF EXISTS run_current");
    createRunTable(ctx, "run_current");
    if (canPreserve) {
      const columnList = CURRENT_RUN_COLUMNS.join(", ");
      ctx.storage.sql.exec(`INSERT INTO run_current (${columnList}) SELECT ${columnList} FROM run`);
    }
    ctx.storage.sql.exec("DROP TABLE run");
    ctx.storage.sql.exec("ALTER TABLE run_current RENAME TO run");
  });
}

function createMessagePartTable(ctx: DurableObjectState): void {
  ctx.storage.sql.exec(
    `CREATE TABLE IF NOT EXISTS message_part (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id TEXT NOT NULL,
      role TEXT NOT NULL,
      part_type TEXT NOT NULL,
      part_id TEXT,
      payload_json TEXT NOT NULL,
      transient INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    )`,
  );
  ctx.storage.sql.exec("CREATE INDEX IF NOT EXISTS idx_part_msg ON message_part(message_id)");
}

function createRunStateTable(ctx: DurableObjectState): void {
  ctx.storage.sql.exec(
    `CREATE TABLE IF NOT EXISTS run_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`,
  );
}

function chunkPartId(chunk: UIMessageChunk): string | null {
  const value = chunkRecord(chunk);
  const id = value["id"] ?? value["toolCallId"] ?? value["sourceId"] ?? null;
  return typeof id === "string" ? id : null;
}

function isTransientChunk(chunk: UIMessageChunk): boolean {
  return chunkRecord(chunk)["transient"] === true;
}

function chunkRecord(chunk: UIMessageChunk): Record<string, unknown> {
  return Object(chunk) as Record<string, unknown>;
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
): "canceled" | "completed" | "failed" | "paused" | "running" | null {
  const value = stringColumn(row, key);
  if (
    value === "canceled" ||
    value === "completed" ||
    value === "failed" ||
    value === "paused" ||
    value === "running"
  ) {
    return value;
  }
  return null;
}

function parseLogicalModelId(value: string | null | undefined): LogicalModelId | undefined {
  const parsed = LogicalModelIdSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
