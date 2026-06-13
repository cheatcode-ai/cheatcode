import type { UIMessageChunk } from "ai";
import { isSeqRow } from "../streaming/ui-message-stream";
import { nextAgentRunAlarm } from "./agent-run-retention";

const AGENT_RUN_SCHEMA_VERSION = 2;
const DEFAULT_AGENT_NAME = "general";
const DEFAULT_MODEL_ID = "claude-sonnet-4-6";

export interface StoredRunIdentity {
  budgetCapUsd?: number | undefined;
  model?: string | undefined;
  projectId: string;
  runId: string;
  threadId: string;
  userId: string;
}

export interface StoredBudgetSnapshot {
  capUsd: number;
  tokensIn: number;
  tokensOut: number;
  usdSpent: number;
}

export interface StoredRunSnapshot {
  budget: StoredBudgetSnapshot;
  completedAt: number | null;
  createdAt: number;
  lastSeq: number;
  messageCount: number;
  modelId: string;
  runId: string;
  startedAt: number | null;
  status: "canceled" | "completed" | "failed" | "running";
}

export interface BudgetEventInput {
  kind: string;
  modelId?: string;
  tokensIn?: number;
  tokensOut?: number;
  usd: number;
}

export function applyAgentRunStorageMigrations(ctx: DurableObjectState): void {
  ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)");
  const current = currentSchemaVersion(ctx);
  if (current < AGENT_RUN_SCHEMA_VERSION) {
    applySchemaV1(ctx);
  }
}

export async function ensureAgentRunRetentionAlarm(ctx: DurableObjectState): Promise<void> {
  const currentAlarm = await ctx.storage.getAlarm();
  if (currentAlarm === null) {
    await ctx.storage.setAlarm(nextAgentRunAlarm(Date.now()));
  }
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
      id, thread_id, project_id, user_id, status, model_id, agent_name,
      budget_cap_usd, tokens_in, tokens_out, cost_usd, created_at, started_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?)`,
    input.runId,
    input.threadId,
    input.projectId,
    input.userId,
    "running",
    input.model ?? DEFAULT_MODEL_ID,
    DEFAULT_AGENT_NAME,
    input.budgetCapUsd ?? 0,
    now,
    now,
  );
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

export function appendBudgetEvent(ctx: DurableObjectState, input: BudgetEventInput): void {
  const tokensIn = normalizedCount(input.tokensIn);
  const tokensOut = normalizedCount(input.tokensOut);
  const usd = normalizedMoney(input.usd);
  ctx.storage.sql.exec(
    "INSERT INTO budget_event (kind, tokens, usd, model_id, ts) VALUES (?, ?, ?, ?, ?)",
    input.kind,
    tokensIn + tokensOut,
    usd,
    input.modelId ?? null,
    Date.now(),
  );
  const runId = getRunStateValue(ctx, "run_id");
  if (!runId) {
    return;
  }
  ctx.storage.sql.exec(
    `UPDATE run
      SET tokens_in = tokens_in + ?,
        tokens_out = tokens_out + ?,
        cost_usd = cost_usd + ?
      WHERE id = ?`,
    tokensIn,
    tokensOut,
    usd,
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
      `SELECT id, status, model_id, budget_cap_usd, tokens_in, tokens_out, cost_usd,
        created_at, started_at, completed_at
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
    budget: {
      capUsd: numberColumn(row, "budget_cap_usd") ?? 0,
      tokensIn: integerColumn(row, "tokens_in") ?? 0,
      tokensOut: integerColumn(row, "tokens_out") ?? 0,
      usdSpent: numberColumn(row, "cost_usd") ?? 0,
    },
    completedAt: integerColumn(row, "completed_at"),
    createdAt: integerColumn(row, "created_at") ?? Date.now(),
    lastSeq: messageStats.lastSeq,
    messageCount: messageStats.messageCount,
    modelId: stringColumn(row, "model_id") ?? DEFAULT_MODEL_ID,
    runId,
    startedAt: integerColumn(row, "started_at"),
    status,
  };
}

function currentSchemaVersion(ctx: DurableObjectState): number {
  const rows = ctx.storage.sql.exec("SELECT max(version) AS version FROM schema_version").toArray();
  const row = rows[0];
  if (!row || typeof row !== "object") {
    return 0;
  }
  const version = (row as Record<string, unknown>)["version"];
  return typeof version === "number" ? version : 0;
}

function applySchemaV1(ctx: DurableObjectState): void {
  ctx.storage.sql.exec(
    `CREATE TABLE IF NOT EXISTS run (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending','running','paused','completed','failed','canceled')),
      model_id TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      budget_cap_usd REAL NOT NULL,
      tokens_in INTEGER NOT NULL DEFAULT 0,
      tokens_out INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0,
      parent_run_id TEXT,
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      completed_at INTEGER,
      error_json TEXT
    )`,
  );
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
  ensureCompatibleMessagePartColumns(ctx);
  ctx.storage.sql.exec("CREATE INDEX IF NOT EXISTS idx_part_msg ON message_part(message_id)");
  ctx.storage.sql.exec(
    `CREATE TABLE IF NOT EXISTS budget_event (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      tokens INTEGER NOT NULL,
      usd REAL NOT NULL,
      model_id TEXT,
      ts INTEGER NOT NULL
    )`,
  );
  ctx.storage.sql.exec(
    `CREATE TABLE IF NOT EXISTS run_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`,
  );
  ctx.storage.sql.exec(
    "INSERT OR IGNORE INTO schema_version (version) VALUES (?)",
    AGENT_RUN_SCHEMA_VERSION,
  );
}

function ensureCompatibleMessagePartColumns(ctx: DurableObjectState): void {
  addColumnIfMissing(ctx, "message_id TEXT NOT NULL DEFAULT 'assistant'");
  addColumnIfMissing(ctx, "role TEXT NOT NULL DEFAULT 'assistant'");
  addColumnIfMissing(ctx, "part_type TEXT NOT NULL DEFAULT 'unknown'");
  addColumnIfMissing(ctx, "part_id TEXT");
  addColumnIfMissing(ctx, "transient INTEGER NOT NULL DEFAULT 0");
}

function addColumnIfMissing(ctx: DurableObjectState, definition: string): void {
  const columnName = definition.split(" ")[0];
  if (!columnName) {
    return;
  }
  try {
    ctx.storage.sql.exec(`ALTER TABLE message_part ADD COLUMN ${definition}`);
  } catch {
    // SQLite throws on duplicate columns; schema creation above covers fresh DOs.
  }
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
): "canceled" | "completed" | "failed" | "running" | null {
  const value = stringColumn(row, key);
  if (value === "canceled" || value === "completed" || value === "failed" || value === "running") {
    return value;
  }
  return null;
}

function normalizedCount(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

function normalizedMoney(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}
