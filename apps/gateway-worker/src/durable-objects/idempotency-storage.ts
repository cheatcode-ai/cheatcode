import {
  assertExactSqliteSchema,
  assertSqliteRowCountPreserved,
  type ExpectedSqliteObject,
  setCurrentSqliteStorageVersion,
} from "@cheatcode/durable-storage";

interface ExpectedColumn {
  defaultValue: string | null;
  isNotNull: boolean;
  isPrimaryKey: boolean;
  name: string;
  type: string;
}

const IDEMPOTENCY_COLUMNS = [
  column("key", "TEXT", true, true),
  column("body_hash", "TEXT", true),
  column("claim_id", "TEXT"),
  column("state", "TEXT", true),
  column("response_status", "INTEGER"),
  column("response_headers_json", "TEXT"),
  column("response_body", "TEXT"),
  column("expires_at", "INTEGER", true),
] as const;

const REQUIRED_COLUMNS = IDEMPOTENCY_COLUMNS.filter(({ name }) => name !== "claim_id");

const IDEMPOTENCY_TABLE_SQL = `CREATE TABLE idempotency_entry (
  key TEXT PRIMARY KEY CHECK (length(key) BETWEEN 1 AND 255),
  body_hash TEXT NOT NULL CHECK (length(body_hash) = 64 AND body_hash NOT GLOB '*[^a-f0-9]*'),
  claim_id TEXT CHECK (claim_id IS NULL OR length(claim_id) = 36),
  state TEXT NOT NULL CHECK (state IN ('in_flight', 'completed')),
  response_status INTEGER CHECK (response_status IS NULL OR response_status BETWEEN 100 AND 599),
  response_headers_json TEXT,
  response_body TEXT CHECK (response_body IS NULL OR length(cast(response_body AS blob)) <= 65536),
  expires_at INTEGER NOT NULL CHECK (expires_at >= 0)
) STRICT`;

const IDEMPOTENCY_STORAGE_SCHEMA: readonly ExpectedSqliteObject[] = [
  {
    name: "idempotency_entry",
    sql: IDEMPOTENCY_TABLE_SQL,
    tableName: "idempotency_entry",
    type: "table",
  },
];

/** Reconciles every dormant object to the one current persisted schema. */
export function initializeIdempotencyStorage(ctx: DurableObjectState): void {
  normalizeIdempotencyStorage(ctx, false);
  assertIdempotencyStorage(ctx);
}

export function hasIdempotencyStorage(ctx: DurableObjectState): boolean {
  return tableColumns(ctx, "idempotency_entry").length > 0;
}

/** One-shot cutover normalizer; a later release removes this force-rebuild entrypoint. */
export function reconcileIdempotencyStorage(ctx: DurableObjectState): void {
  normalizeIdempotencyStorage(ctx, true);
  assertExactSqliteSchema(ctx, IDEMPOTENCY_STORAGE_SCHEMA);
}

export function assertIdempotencyStorage(ctx: DurableObjectState): void {
  assertExactSqliteSchema(ctx, IDEMPOTENCY_STORAGE_SCHEMA);
}

function normalizeIdempotencyStorage(ctx: DurableObjectState, forceRebuild: boolean): void {
  const columns = tableColumns(ctx, "idempotency_entry");
  if (columns.length === 0) {
    createIdempotencyTable(ctx, "idempotency_entry");
    setCurrentSqliteStorageVersion(ctx);
    return;
  }
  if (!forceRebuild && hasExactColumns(columns, IDEMPOTENCY_COLUMNS)) {
    setCurrentSqliteStorageVersion(ctx);
    return;
  }
  if (!REQUIRED_COLUMNS.every(({ name }) => hasColumn(columns, name))) {
    throw new Error("Unsupported idempotency_entry schema; refusing lossy evolution.");
  }
  const claimId = hasColumn(columns, "claim_id") ? "claim_id" : "NULL";
  ctx.storage.transactionSync(() => {
    ctx.storage.sql.exec("DROP TABLE IF EXISTS idempotency_entry_next");
    createIdempotencyTable(ctx, "idempotency_entry_next");
    ctx.storage.sql.exec(
      `INSERT INTO idempotency_entry_next (
        key, body_hash, claim_id, state, response_status,
        response_headers_json, response_body, expires_at
      )
      SELECT key, body_hash, ${claimId}, state, response_status,
             response_headers_json, response_body, expires_at
        FROM idempotency_entry`,
    );
    assertSqliteRowCountPreserved(ctx, "idempotency_entry", "idempotency_entry_next");
    ctx.storage.sql.exec("DROP TABLE idempotency_entry");
    ctx.storage.sql.exec("ALTER TABLE idempotency_entry_next RENAME TO idempotency_entry");
  });
  setCurrentSqliteStorageVersion(ctx);
}

function createIdempotencyTable(
  ctx: DurableObjectState,
  table: "idempotency_entry" | "idempotency_entry_next",
): void {
  ctx.storage.sql.exec(IDEMPOTENCY_TABLE_SQL.replace("idempotency_entry", table));
}

function tableColumns(ctx: DurableObjectState, table: string): unknown[] {
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
