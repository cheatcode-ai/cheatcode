import {
  assertExactSqliteSchema,
  assertSqliteRowCountPreserved,
  type ExpectedSqliteObject,
  setCurrentSqliteStorageVersion,
} from "@cheatcode/durable-storage";

const MAX_FINITE_REAL = "1.7976931348623157e308";
const BUCKET_TABLE_SQL = `CREATE TABLE bucket (
  key TEXT PRIMARY KEY CHECK (length(key) BETWEEN 1 AND 256),
  tokens REAL NOT NULL CHECK (tokens >= 0 AND abs(tokens) <= ${MAX_FINITE_REAL}),
  last_refill_ms INTEGER NOT NULL CHECK (last_refill_ms >= 0),
  capacity INTEGER NOT NULL CHECK (capacity > 0),
  refill_per_sec REAL NOT NULL CHECK (refill_per_sec > 0 AND abs(refill_per_sec) <= ${MAX_FINITE_REAL}),
  CHECK (tokens <= capacity)
) STRICT`;

const RATE_LIMITER_STORAGE_SCHEMA: readonly ExpectedSqliteObject[] = [
  { name: "bucket", sql: BUCKET_TABLE_SQL, tableName: "bucket", type: "table" },
];

export function initializeRateLimiterStorage(ctx: DurableObjectState): void {
  ensureRateLimiterTable(ctx);
  setCurrentSqliteStorageVersion(ctx);
  assertRateLimiterStorage(ctx);
}

export function hasRateLimiterStorage(ctx: DurableObjectState): boolean {
  return ctx.storage.sql.exec("PRAGMA table_info(bucket)").toArray().length > 0;
}

/** Rebuilds the one live table so same-column legacy constraints cannot survive the cutover. */
export function reconcileRateLimiterStorage(ctx: DurableObjectState): void {
  ensureRateLimiterTable(ctx);
  assertRateLimiterSourceRows(ctx);
  ctx.storage.transactionSync(() => {
    ctx.storage.sql.exec("ALTER TABLE bucket RENAME TO bucket_reconcile_source");
    ctx.storage.sql.exec(BUCKET_TABLE_SQL);
    ctx.storage.sql.exec(
      `INSERT INTO bucket (key, tokens, last_refill_ms, capacity, refill_per_sec)
       SELECT key, tokens, last_refill_ms, capacity, refill_per_sec
       FROM bucket_reconcile_source`,
    );
    assertSqliteRowCountPreserved(ctx, "bucket_reconcile_source", "bucket");
    ctx.storage.sql.exec("DROP TABLE bucket_reconcile_source");
  });
  setCurrentSqliteStorageVersion(ctx);
  assertRateLimiterStorage(ctx);
}

function ensureRateLimiterTable(ctx: DurableObjectState): void {
  ctx.storage.sql.exec(BUCKET_TABLE_SQL.replace("CREATE TABLE", "CREATE TABLE IF NOT EXISTS"));
}

export function assertRateLimiterStorage(ctx: DurableObjectState): void {
  assertExactSqliteSchema(ctx, RATE_LIMITER_STORAGE_SCHEMA);
}

function assertRateLimiterSourceRows(ctx: DurableObjectState): void {
  const invalid = ctx.storage.sql
    .exec(
      `SELECT 1 FROM bucket WHERE
         typeof(key) <> 'text' OR length(key) NOT BETWEEN 1 AND 256 OR
         typeof(tokens) NOT IN ('integer', 'real') OR tokens < 0 OR
         abs(tokens) > ${MAX_FINITE_REAL} OR typeof(last_refill_ms) <> 'integer' OR
         last_refill_ms < 0 OR typeof(capacity) <> 'integer' OR capacity <= 0 OR
         tokens > capacity OR typeof(refill_per_sec) NOT IN ('integer', 'real') OR
         refill_per_sec <= 0 OR abs(refill_per_sec) > ${MAX_FINITE_REAL} LIMIT 1`,
    )
    .toArray();
  if (invalid.length > 0) {
    throw new Error("Rate limiter contains invalid data; refusing lossy evolution.");
  }
}
