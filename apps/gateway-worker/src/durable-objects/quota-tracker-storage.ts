import {
  assertExactSqliteSchema,
  assertSqliteRowCountPreserved,
  type ExpectedSqliteObject,
  setCurrentSqliteStorageVersion,
} from "@cheatcode/durable-storage";
import { QUOTA_FEATURES } from "@cheatcode/types/quota";

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

/** Force-normalizes all quota tables after the release barrier has drained every caller. */
export function reconcileQuotaTrackerStorage(ctx: DurableObjectState): void {
  ensureSourceTables(ctx);
  const limitColumns = ctx.storage.sql.exec("PRAGMA table_info(limit_override)").toArray();
  if (!hasColumn(limitColumns, "feature") || !hasColumn(limitColumns, "limit_val")) {
    throw new Error("Unsupported quota limit schema; refusing lossy evolution.");
  }
  const hasEntitlementVersion = hasColumn(limitColumns, "entitlement_version");
  assertQuotaSourceRows(ctx, hasEntitlementVersion);
  const entitlementVersion = hasEntitlementVersion ? "entitlement_version" : "0";
  ctx.storage.transactionSync(() => rebuildQuotaTables(ctx, entitlementVersion));
  setCurrentSqliteStorageVersion(ctx);
  assertQuotaTrackerStorage(ctx);
}

export function assertQuotaTrackerStorage(ctx: DurableObjectState): void {
  assertExactSqliteSchema(ctx, QUOTA_STORAGE_SCHEMA);
}

export function initializeQuotaTrackerStorage(ctx: DurableObjectState): void {
  ensureSourceTables(ctx);
  ctx.storage.sql.exec(USAGE_EVENT_INDEX_SQL.replace("CREATE INDEX", "CREATE INDEX IF NOT EXISTS"));
  ctx.storage.sql.exec(
    QUOTA_OPERATION_INDEX_SQL.replace("CREATE INDEX", "CREATE INDEX IF NOT EXISTS"),
  );
  setCurrentSqliteStorageVersion(ctx);
  assertQuotaTrackerStorage(ctx);
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

function ensureSourceTables(ctx: DurableObjectState): void {
  for (const sql of [COUNTER_SQL, LIMIT_OVERRIDE_SQL, USAGE_EVENT_SQL, QUOTA_OPERATION_SQL]) {
    ctx.storage.sql.exec(sql.replace("CREATE TABLE", "CREATE TABLE IF NOT EXISTS"));
  }
}

function rebuildQuotaTables(ctx: DurableObjectState, entitlementVersion: string): void {
  ctx.storage.sql.exec("DROP INDEX IF EXISTS usage_event_feature_time_idx");
  ctx.storage.sql.exec("DROP INDEX IF EXISTS quota_operation_feature_time_idx");
  for (const table of ["counter", "limit_override", "usage_event", "quota_operation"] as const) {
    ctx.storage.sql.exec(`ALTER TABLE ${table} RENAME TO ${table}_reconcile_source`);
  }
  for (const sql of [COUNTER_SQL, LIMIT_OVERRIDE_SQL, USAGE_EVENT_SQL, QUOTA_OPERATION_SQL]) {
    ctx.storage.sql.exec(sql);
  }
  copyQuotaRows(ctx, entitlementVersion);
  for (const table of ["counter", "limit_override", "usage_event", "quota_operation"] as const) {
    assertSqliteRowCountPreserved(ctx, `${table}_reconcile_source`, table);
    ctx.storage.sql.exec(`DROP TABLE ${table}_reconcile_source`);
  }
  ctx.storage.sql.exec(USAGE_EVENT_INDEX_SQL);
  ctx.storage.sql.exec(QUOTA_OPERATION_INDEX_SQL);
}

function copyQuotaRows(ctx: DurableObjectState, entitlementVersion: string): void {
  ctx.storage.sql.exec(
    `INSERT INTO counter (feature, period_key, used, updated_at)
     SELECT feature, period_key, used, updated_at FROM counter_reconcile_source`,
  );
  ctx.storage.sql.exec(
    `INSERT INTO limit_override (feature, limit_val, entitlement_version)
     SELECT feature, limit_val, ${entitlementVersion} FROM limit_override_reconcile_source`,
  );
  ctx.storage.sql.exec(
    `INSERT INTO usage_event (id, feature, amount, recorded_at)
     SELECT id, feature, amount, recorded_at FROM usage_event_reconcile_source`,
  );
  ctx.storage.sql.exec(
    `INSERT INTO quota_operation
      (event_id, operation, feature, period_key, amount, allowed,
       limit_val, remaining, used, recorded_at)
     SELECT event_id, operation, feature, period_key, amount, allowed,
            limit_val, remaining, used, recorded_at
     FROM quota_operation_reconcile_source`,
  );
}

function assertQuotaSourceRows(ctx: DurableObjectState, hasEntitlementVersion: boolean): void {
  const features = [QUOTA_FEATURES.composioCalls, QUOTA_FEATURES.sandboxHours] as const;
  assertNoInvalidRows(
    ctx,
    `SELECT 1 FROM counter WHERE
       typeof(feature) <> 'text' OR feature NOT IN (?, ?) OR
       typeof(period_key) <> 'text' OR length(period_key) <> 7 OR
       period_key NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]' OR
       typeof(used) NOT IN ('integer', 'real') OR used < 0 OR abs(used) > ${MAX_FINITE_REAL} OR
       typeof(updated_at) <> 'integer' OR updated_at < 0 LIMIT 1`,
    features,
  );
  const entitlementPredicate = hasEntitlementVersion
    ? " OR typeof(entitlement_version) <> 'integer' OR entitlement_version < 0"
    : "";
  assertNoInvalidRows(
    ctx,
    `SELECT 1 FROM limit_override WHERE
       typeof(feature) <> 'text' OR feature NOT IN (?, ?) OR
       typeof(limit_val) NOT IN ('integer', 'real') OR limit_val < 0 OR
       abs(limit_val) > ${MAX_FINITE_REAL}${entitlementPredicate} LIMIT 1`,
    features,
  );
  assertNoInvalidRows(
    ctx,
    `SELECT 1 FROM usage_event WHERE
       typeof(id) <> 'integer' OR typeof(feature) <> 'text' OR feature NOT IN (?, ?) OR
       typeof(amount) NOT IN ('integer', 'real') OR amount <= 0 OR
       abs(amount) > ${MAX_FINITE_REAL} OR typeof(recorded_at) <> 'integer' OR
       recorded_at < 0 LIMIT 1`,
    features,
  );
  assertNoInvalidRows(
    ctx,
    `SELECT 1 FROM quota_operation WHERE
       typeof(event_id) <> 'text' OR length(event_id) NOT BETWEEN 1 AND 200 OR
       typeof(operation) <> 'text' OR operation NOT IN ('record', 'try-consume') OR
       typeof(feature) <> 'text' OR feature NOT IN (?, ?) OR
       typeof(period_key) <> 'text' OR length(period_key) <> 7 OR
       period_key NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]' OR
       typeof(amount) NOT IN ('integer', 'real') OR amount <= 0 OR
       abs(amount) > ${MAX_FINITE_REAL} OR typeof(allowed) <> 'integer' OR
       allowed NOT IN (0, 1) OR typeof(limit_val) NOT IN ('integer', 'real') OR
       limit_val < 0 OR abs(limit_val) > ${MAX_FINITE_REAL} OR
       typeof(remaining) NOT IN ('integer', 'real') OR remaining < 0 OR
       abs(remaining) > ${MAX_FINITE_REAL} OR typeof(used) NOT IN ('integer', 'real') OR
       used < 0 OR abs(used) > ${MAX_FINITE_REAL} OR
       typeof(recorded_at) <> 'integer' OR recorded_at < 0 LIMIT 1`,
    features,
  );
}

function assertNoInvalidRows(
  ctx: DurableObjectState,
  sql: string,
  features: readonly [string, string],
): void {
  if (ctx.storage.sql.exec(sql, ...features).toArray().length > 0) {
    throw new Error("Quota storage contains invalid or retired data; refusing lossy evolution.");
  }
}

function hasColumn(rows: unknown[], name: string): boolean {
  return rows.some((row) => isRecord(row) && row["name"] === name);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
