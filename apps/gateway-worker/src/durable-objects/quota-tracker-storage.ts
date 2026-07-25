import {
  assertExactSqliteSchema,
  type ExpectedSqliteObject,
  setCurrentSqliteStorageVersion,
} from "@cheatcode/durable-storage";

const MAX_FINITE_REAL = "1.7976931348623157e308";
const FEATURE_CHECK = "feature IN ('composio_calls', 'sandbox_hours')";
const PERIOD_KEY_CHECK =
  "length(period_key) = 7 AND period_key GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'";

const COUNTER_SQL = `CREATE TABLE counter (
  feature TEXT NOT NULL CHECK (${FEATURE_CHECK}),
  period_key TEXT NOT NULL CHECK (${PERIOD_KEY_CHECK}),
  used REAL NOT NULL DEFAULT 0 CHECK (used >= 0 AND abs(used) <= ${MAX_FINITE_REAL}),
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
  PRIMARY KEY (feature, period_key)
) STRICT`;
const LIMIT_OVERRIDE_SQL = `CREATE TABLE limit_override (
  feature TEXT PRIMARY KEY CHECK (${FEATURE_CHECK}),
  limit_val REAL NOT NULL CHECK (limit_val >= 0 AND abs(limit_val) <= ${MAX_FINITE_REAL}),
  entitlement_version INTEGER NOT NULL CHECK (entitlement_version >= 0)
) STRICT`;
const USAGE_EVENT_SQL = `CREATE TABLE usage_event (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  feature TEXT NOT NULL CHECK (${FEATURE_CHECK}),
  amount REAL NOT NULL CHECK (amount > 0 AND abs(amount) <= ${MAX_FINITE_REAL}),
  recorded_at INTEGER NOT NULL CHECK (recorded_at >= 0)
) STRICT`;
const QUOTA_OPERATION_SQL = `CREATE TABLE quota_operation (
  event_id TEXT PRIMARY KEY CHECK (length(event_id) BETWEEN 1 AND 200),
  operation TEXT NOT NULL CHECK (operation IN ('record', 'try-consume')),
  feature TEXT NOT NULL CHECK (${FEATURE_CHECK}),
  period_key TEXT NOT NULL CHECK (${PERIOD_KEY_CHECK}),
  amount REAL NOT NULL CHECK (amount > 0 AND abs(amount) <= ${MAX_FINITE_REAL}),
  allowed INTEGER NOT NULL CHECK (allowed IN (0, 1)),
  limit_val REAL NOT NULL CHECK (limit_val >= 0 AND abs(limit_val) <= ${MAX_FINITE_REAL}),
  remaining REAL NOT NULL CHECK (remaining >= 0 AND abs(remaining) <= ${MAX_FINITE_REAL}),
  used REAL NOT NULL CHECK (used >= 0 AND abs(used) <= ${MAX_FINITE_REAL}),
  recorded_at INTEGER NOT NULL CHECK (recorded_at >= 0)
) STRICT`;
const USAGE_EVENT_INDEX_SQL =
  "CREATE INDEX usage_event_feature_time_idx ON usage_event(feature, recorded_at)";
const QUOTA_OPERATION_INDEX_SQL =
  "CREATE INDEX quota_operation_feature_time_idx ON quota_operation(feature, recorded_at)";

const QUOTA_STORAGE_SCHEMA: readonly ExpectedSqliteObject[] = [
  { name: "counter", sql: COUNTER_SQL, tableName: "counter", type: "table" },
  {
    name: "limit_override",
    sql: LIMIT_OVERRIDE_SQL,
    tableName: "limit_override",
    type: "table",
  },
  {
    name: "quota_operation",
    sql: QUOTA_OPERATION_SQL,
    tableName: "quota_operation",
    type: "table",
  },
  { name: "usage_event", sql: USAGE_EVENT_SQL, tableName: "usage_event", type: "table" },
  {
    name: "quota_operation_feature_time_idx",
    sql: QUOTA_OPERATION_INDEX_SQL,
    tableName: "quota_operation",
    type: "index",
  },
  {
    name: "usage_event_feature_time_idx",
    sql: USAGE_EVENT_INDEX_SQL,
    tableName: "usage_event",
    type: "index",
  },
];

/** Opens quota storage only when it matches the exact current contract. */
export function ensureQuotaTrackerStorage(ctx: DurableObjectState): void {
  if (!hasQuotaTrackerStorage(ctx)) {
    initializeQuotaTrackerStorage(ctx);
    return;
  }
  assertQuotaTrackerStorage(ctx);
}

function assertQuotaTrackerStorage(ctx: DurableObjectState): void {
  assertExactSqliteSchema(ctx, QUOTA_STORAGE_SCHEMA);
}

function initializeQuotaTrackerStorage(ctx: DurableObjectState): void {
  ctx.storage.transactionSync(() => {
    for (const sql of [COUNTER_SQL, LIMIT_OVERRIDE_SQL, USAGE_EVENT_SQL, QUOTA_OPERATION_SQL]) {
      ctx.storage.sql.exec(sql.replace("CREATE TABLE", "CREATE TABLE IF NOT EXISTS"));
    }
    ctx.storage.sql.exec(
      USAGE_EVENT_INDEX_SQL.replace("CREATE INDEX", "CREATE INDEX IF NOT EXISTS"),
    );
    ctx.storage.sql.exec(
      QUOTA_OPERATION_INDEX_SQL.replace("CREATE INDEX", "CREATE INDEX IF NOT EXISTS"),
    );
    setCurrentSqliteStorageVersion(ctx);
    assertQuotaTrackerStorage(ctx);
  });
}

export function hasQuotaTrackerStorage(ctx: DurableObjectState): boolean {
  return (
    ctx.storage.sql
      .exec(
        "SELECT 1 AS present FROM sqlite_schema WHERE type = 'table' AND name = 'counter' LIMIT 1",
      )
      .toArray().length > 0
  );
}
