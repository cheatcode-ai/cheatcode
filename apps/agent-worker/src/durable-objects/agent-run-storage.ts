import {
  assertExactSqliteSchema,
  assertSqliteRowCountPreserved,
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

interface ExpectedColumn {
  defaultValue: string | null;
  isNotNull: boolean;
  isPrimaryKey: boolean;
  name: string;
  type: string;
}

const RUN_COLUMNS = [
  column("id", "TEXT", true, true),
  column("status", "TEXT", true),
  column("model_id", "TEXT", true),
  column("created_at", "INTEGER", true),
  column("started_at", "INTEGER"),
  column("completed_at", "INTEGER"),
] as const;
const MESSAGE_PART_COLUMNS = [
  column("seq", "INTEGER", false, true),
  column("part_type", "TEXT", true),
  column("payload_json", "TEXT", true),
] as const;
const MESSAGE_PART_PAGE_MAX_BYTES = 256 * 1024;
const MESSAGE_PART_PAGE_MAX_ROWS = 32;
const RUN_STATE_COLUMNS = [
  column("key", "TEXT", true, true),
  column("value", "TEXT", true),
] as const;
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
  reconcileRunTable(ctx);
  reconcileMessagePartTable(ctx);
  reconcileRunStateTable(ctx);
  normalizeRunStateStatus(ctx);
  setCurrentSqliteStorageVersion(ctx);
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

/** Force-normalizes dormant run objects while the production release gate is closed. */
export function reconcileAgentRunStorage(ctx: DurableObjectState): void {
  prepareAgentRunRebuild(ctx);
  ctx.storage.transactionSync(() => {
    rebuildAgentRunTables(ctx);
    normalizeRunStateStatus(ctx);
    removePersistedArtifactCapabilities(ctx);
  });
  setCurrentSqliteStorageVersion(ctx);
  assertAgentRunStorage(ctx);
}

function prepareAgentRunRebuild(ctx: DurableObjectState): void {
  const sources = [
    { columns: RUN_COLUMNS, create: () => createRunTable(ctx, "run"), table: "run" },
    {
      columns: MESSAGE_PART_COLUMNS,
      create: () => createMessagePartTable(ctx, "message_part"),
      table: "message_part",
    },
    {
      columns: RUN_STATE_COLUMNS,
      create: () => createRunStateTable(ctx, "run_state"),
      table: "run_state",
    },
  ] as const;
  for (const source of sources) {
    const columns = tableColumns(ctx, source.table);
    if (columns.length === 0) {
      source.create();
      continue;
    }
    if (!source.columns.every(({ name }) => hasColumn(columns, name))) {
      throw new Error(`Unsupported AgentRun ${source.table} schema; refusing lossy evolution.`);
    }
  }
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

function removePersistedArtifactCapabilities(ctx: DurableObjectState): void {
  const rows = ctx.storage.sql
    .exec("SELECT seq, payload_json FROM message_part WHERE part_type = 'data-artifact'")
    .toArray();
  for (const row of rows) {
    if (
      !isRecord(row) ||
      typeof row["seq"] !== "number" ||
      typeof row["payload_json"] !== "string"
    ) {
      throw new Error("Invalid stored artifact transcript row; refusing lossy reconciliation.");
    }
    const parsed = JSON.parse(row["payload_json"]) as unknown;
    if (!isRecord(parsed) || parsed["type"] !== "data-artifact" || !isRecord(parsed["data"])) {
      throw new Error("Invalid stored artifact payload; refusing lossy reconciliation.");
    }
    if (!("downloadUrl" in parsed["data"])) {
      continue;
    }
    const data = { ...parsed["data"], downloadUrl: undefined };
    ctx.storage.sql.exec(
      "UPDATE message_part SET payload_json = ? WHERE seq = ?",
      JSON.stringify({ ...parsed, data }),
      row["seq"],
    );
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

function reconcileRunTable(ctx: DurableObjectState): void {
  const columns = tableColumns(ctx, "run");
  if (columns.length === 0) {
    createRunTable(ctx, "run");
    return;
  }
  if (hasExactColumns(columns, RUN_COLUMNS) && hasCurrentRunTableSql(ctx)) {
    return;
  }
  if (!RUN_COLUMNS.every(({ name }) => hasColumn(columns, name))) {
    throw new Error("Unsupported AgentRun run schema; refusing lossy evolution.");
  }
  ctx.storage.transactionSync(() => {
    ctx.storage.sql.exec("DROP TABLE IF EXISTS run_next");
    createRunTable(ctx, "run_next");
    copyRunRows(ctx, "run", "run_next");
    assertSqliteRowCountPreserved(ctx, "run", "run_next");
    ctx.storage.sql.exec("DROP TABLE run");
    ctx.storage.sql.exec("ALTER TABLE run_next RENAME TO run");
  });
}

function createRunTable(ctx: DurableObjectState, table: "run" | "run_next"): void {
  ctx.storage.sql.exec(RUN_TABLE_SQL.replace("CREATE TABLE run", `CREATE TABLE ${table}`));
}

function reconcileMessagePartTable(ctx: DurableObjectState): void {
  const columns = tableColumns(ctx, "message_part");
  if (columns.length === 0) {
    createMessagePartTable(ctx, "message_part");
    return;
  }
  if (hasExactColumns(columns, MESSAGE_PART_COLUMNS)) {
    return;
  }
  if (!MESSAGE_PART_COLUMNS.every(({ name }) => hasColumn(columns, name))) {
    throw new Error("Unsupported AgentRun message schema; refusing lossy evolution.");
  }
  ctx.storage.transactionSync(() => {
    ctx.storage.sql.exec("DROP TABLE IF EXISTS message_part_next");
    createMessagePartTable(ctx, "message_part_next");
    const names = MESSAGE_PART_COLUMNS.map(({ name }) => name).join(", ");
    ctx.storage.sql.exec(
      `INSERT INTO message_part_next (${names}) SELECT ${names} FROM message_part`,
    );
    assertSqliteRowCountPreserved(ctx, "message_part", "message_part_next");
    ctx.storage.sql.exec("DROP TABLE message_part");
    ctx.storage.sql.exec("ALTER TABLE message_part_next RENAME TO message_part");
  });
}

function createMessagePartTable(
  ctx: DurableObjectState,
  table: "message_part" | "message_part_next",
): void {
  ctx.storage.sql.exec(
    MESSAGE_PART_TABLE_SQL.replace("CREATE TABLE message_part", `CREATE TABLE ${table}`),
  );
}

function reconcileRunStateTable(ctx: DurableObjectState): void {
  const columns = tableColumns(ctx, "run_state");
  if (columns.length === 0) {
    createRunStateTable(ctx, "run_state");
    return;
  }
  if (hasExactColumns(columns, RUN_STATE_COLUMNS)) {
    return;
  }
  if (!RUN_STATE_COLUMNS.every(({ name }) => hasColumn(columns, name))) {
    throw new Error("Unsupported AgentRun state schema; refusing lossy evolution.");
  }
  ctx.storage.transactionSync(() => {
    ctx.storage.sql.exec("DROP TABLE IF EXISTS run_state_next");
    createRunStateTable(ctx, "run_state_next");
    ctx.storage.sql.exec(
      "INSERT INTO run_state_next (key, value) SELECT key, value FROM run_state",
    );
    assertSqliteRowCountPreserved(ctx, "run_state", "run_state_next");
    ctx.storage.sql.exec("DROP TABLE run_state");
    ctx.storage.sql.exec("ALTER TABLE run_state_next RENAME TO run_state");
  });
}

function createRunStateTable(ctx: DurableObjectState, table: "run_state" | "run_state_next"): void {
  ctx.storage.sql.exec(
    RUN_STATE_TABLE_SQL.replace("CREATE TABLE run_state", `CREATE TABLE ${table}`),
  );
}

function rebuildAgentRunTables(ctx: DurableObjectState): void {
  for (const table of ["run", "message_part", "run_state"] as const) {
    ctx.storage.sql.exec(`DROP TABLE IF EXISTS ${table}_reconcile_source`);
    ctx.storage.sql.exec(`ALTER TABLE ${table} RENAME TO ${table}_reconcile_source`);
  }
  ctx.storage.sql.exec(RUN_TABLE_SQL);
  ctx.storage.sql.exec(MESSAGE_PART_TABLE_SQL);
  ctx.storage.sql.exec(RUN_STATE_TABLE_SQL);
  copyRunRows(ctx, "run_reconcile_source", "run");
  ctx.storage.sql.exec(
    `INSERT INTO message_part (seq, part_type, payload_json)
     SELECT seq, part_type, payload_json FROM message_part_reconcile_source`,
  );
  ctx.storage.sql.exec(
    "INSERT INTO run_state (key, value) SELECT key, value FROM run_state_reconcile_source",
  );
  for (const table of ["run", "message_part", "run_state"] as const) {
    assertSqliteRowCountPreserved(ctx, `${table}_reconcile_source`, table);
    ctx.storage.sql.exec(`DROP TABLE ${table}_reconcile_source`);
  }
}

function tableColumns(ctx: DurableObjectState, table: "message_part" | "run" | "run_state") {
  return ctx.storage.sql.exec(`PRAGMA table_info(${table})`).toArray();
}

function hasExactColumns(rows: unknown[], expected: readonly ExpectedColumn[]): boolean {
  return (
    rows.length === expected.length &&
    expected.every((value, index) => {
      const row = rows[index];
      return (
        isRecord(row) &&
        row["cid"] === index &&
        row["name"] === value.name &&
        row["type"] === value.type &&
        row["notnull"] === Number(value.isNotNull) &&
        row["pk"] === Number(value.isPrimaryKey) &&
        row["dflt_value"] === value.defaultValue
      );
    })
  );
}

function hasColumn(rows: unknown[], name: string): boolean {
  return rows.some((row) => isRecord(row) && row["name"] === name);
}

function column(
  name: string,
  type: string,
  isNotNull = false,
  isPrimaryKey = false,
  defaultValue: string | null = null,
): ExpectedColumn {
  return { defaultValue, isNotNull, isPrimaryKey, name, type };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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

function hasCurrentRunTableSql(ctx: DurableObjectState): boolean {
  const row = firstRecord(
    ctx.storage.sql
      .exec("SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'run'")
      .toArray(),
  );
  const sql = row?.["sql"];
  return typeof sql === "string" && compactSql(sql) === compactSql(RUN_TABLE_SQL);
}

function compactSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim().toLowerCase();
}

function copyRunRows(
  ctx: DurableObjectState,
  source: "run" | "run_reconcile_source",
  target: "run" | "run_next",
): void {
  ctx.storage.sql.exec(
    `INSERT INTO ${target} (id, status, model_id, created_at, started_at, completed_at)
     SELECT id,
            CASE WHEN status IN (${RUN_STATUS_VALUES_SQL}) THEN status ELSE 'canceled' END,
            model_id,
            created_at,
            started_at,
            CASE
              WHEN status IN (${RUN_STATUS_VALUES_SQL}) THEN completed_at
              ELSE COALESCE(completed_at, started_at, created_at)
            END
       FROM ${source}`,
  );
}

function normalizeRunStateStatus(ctx: DurableObjectState): void {
  const status = getRunStateValue(ctx, "status");
  if (!status || ["running", "completed", "failed", "canceled"].includes(status)) {
    return;
  }
  setRunStateValue(ctx, "status", "canceled");
  if (!getRunStateValue(ctx, "completed_at")) {
    setRunStateValue(ctx, "completed_at", String(Date.now()));
  }
}

function parseLogicalModelId(value: string | null | undefined): LogicalModelId | undefined {
  const parsed = LogicalModelIdSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
