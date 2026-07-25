import {
  assertExactSqliteSchema,
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

/** Initializes a new object or verifies that an existing object is current. */
export function ensureRateLimiterStorage(ctx: DurableObjectState): void {
  if (!hasRateLimiterStorage(ctx)) {
    ctx.storage.sql.exec(BUCKET_TABLE_SQL);
    setCurrentSqliteStorageVersion(ctx);
  }
  assertRateLimiterStorage(ctx);
}

export function hasRateLimiterStorage(ctx: DurableObjectState): boolean {
  return ctx.storage.sql.exec("PRAGMA table_info(bucket)").toArray().length > 0;
}

function assertRateLimiterStorage(ctx: DurableObjectState): void {
  assertExactSqliteSchema(ctx, RATE_LIMITER_STORAGE_SCHEMA);
}
