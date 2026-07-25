import {
  assertExactSqliteSchema,
  type ExpectedSqliteObject,
  setCurrentSqliteStorageVersion,
} from "@cheatcode/durable-storage";

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

/** Initializes a new object or verifies that an existing object is current. */
export function ensureIdempotencyStorage(ctx: DurableObjectState): void {
  if (!hasIdempotencyStorage(ctx)) {
    ctx.storage.sql.exec(IDEMPOTENCY_TABLE_SQL);
    setCurrentSqliteStorageVersion(ctx);
  }
  assertIdempotencyStorage(ctx);
}

export function hasIdempotencyStorage(ctx: DurableObjectState): boolean {
  return ctx.storage.sql.exec("PRAGMA table_info(idempotency_entry)").toArray().length > 0;
}

function assertIdempotencyStorage(ctx: DurableObjectState): void {
  assertExactSqliteSchema(ctx, IDEMPOTENCY_STORAGE_SCHEMA);
}
