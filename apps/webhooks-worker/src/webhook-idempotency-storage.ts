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

const WEBHOOK_EVENT_COLUMNS = [
  column("event_key", "TEXT", true, true),
  column("body_hash", "TEXT", true),
  column("state", "TEXT", true),
  column("workflow_id", "TEXT"),
  column("created_at", "INTEGER", true),
  column("updated_at", "INTEGER", true),
  column("attempts", "INTEGER", true),
  column("last_error", "TEXT"),
  column("expires_at", "INTEGER", true),
] as const;

const WEBHOOK_REQUIRED_COLUMNS = [
  "event_key",
  "body_hash",
  "state",
  "workflow_id",
  "created_at",
  "expires_at",
] as const;

const DAYTONA_STATE_COLUMNS = [
  column("sandbox_id", "TEXT", true, true),
  column("updated_at", "INTEGER", true),
  column("expires_at", "INTEGER", true),
] as const;

const INTERNAL_COMMAND_COLUMNS = [
  column("command_id", "TEXT", true, true),
  column("expires_at", "INTEGER", true),
] as const;
const WEBHOOK_EVENT_TABLE_SQL = `CREATE TABLE webhook_event (
  event_key TEXT PRIMARY KEY CHECK (length(event_key) BETWEEN 1 AND 530),
  body_hash TEXT NOT NULL CHECK (length(body_hash) = 64 AND body_hash NOT GLOB '*[^a-f0-9]*'),
  state TEXT NOT NULL CHECK (state IN ('accepted', 'running', 'processed', 'failed')),
  workflow_id TEXT CHECK (workflow_id IS NULL OR length(workflow_id) BETWEEN 1 AND 512),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
  attempts INTEGER NOT NULL CHECK (attempts > 0),
  last_error TEXT CHECK (last_error IS NULL OR length(last_error) BETWEEN 1 AND 100),
  expires_at INTEGER NOT NULL CHECK (expires_at >= updated_at)
) STRICT`;
const DAYTONA_STATE_TABLE_SQL = `CREATE TABLE daytona_sandbox_state (
  sandbox_id TEXT PRIMARY KEY CHECK (length(sandbox_id) = 36),
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
  expires_at INTEGER NOT NULL CHECK (expires_at >= 0)
) STRICT`;
const INTERNAL_COMMAND_TABLE_SQL = `CREATE TABLE internal_command (
  command_id TEXT PRIMARY KEY CHECK (length(command_id) = 64 AND command_id NOT GLOB '*[^a-f0-9]*'),
  expires_at INTEGER NOT NULL CHECK (expires_at >= 0)
) STRICT`;
const WEBHOOK_STORAGE_SCHEMA: readonly ExpectedSqliteObject[] = [
  {
    name: "daytona_sandbox_state",
    sql: DAYTONA_STATE_TABLE_SQL,
    tableName: "daytona_sandbox_state",
    type: "table",
  },
  {
    name: "internal_command",
    sql: INTERNAL_COMMAND_TABLE_SQL,
    tableName: "internal_command",
    type: "table",
  },
  {
    name: "webhook_event",
    sql: WEBHOOK_EVENT_TABLE_SQL,
    tableName: "webhook_event",
    type: "table",
  },
];

/** Reconciles every dormant object to the one current persisted schema. */
export function initializeWebhookIdempotencyStorage(ctx: DurableObjectState): void {
  reconcileWebhookEvents(ctx);
  reconcileSimpleTable(ctx, "daytona_sandbox_state", DAYTONA_STATE_COLUMNS);
  reconcileSimpleTable(ctx, "internal_command", INTERNAL_COMMAND_COLUMNS);
  setCurrentSqliteStorageVersion(ctx);
  assertWebhookIdempotencyStorage(ctx);
}

/** Force-normalizes dormant webhook objects while provider ingress is closed. */
export function reconcileWebhookIdempotencyStorage(ctx: DurableObjectState): void {
  reconcileWebhookEvents(ctx);
  reconcileSimpleTable(ctx, "daytona_sandbox_state", DAYTONA_STATE_COLUMNS);
  reconcileSimpleTable(ctx, "internal_command", INTERNAL_COMMAND_COLUMNS);
  ctx.storage.transactionSync(() => rebuildWebhookStorage(ctx));
  setCurrentSqliteStorageVersion(ctx);
  assertWebhookIdempotencyStorage(ctx);
}

export function assertWebhookIdempotencyStorage(ctx: DurableObjectState): void {
  assertExactSqliteSchema(ctx, WEBHOOK_STORAGE_SCHEMA);
}

export function hasWebhookIdempotencyStorage(ctx: DurableObjectState): boolean {
  return tableColumns(ctx, "webhook_event").length > 0;
}

function reconcileWebhookEvents(ctx: DurableObjectState): void {
  const columns = tableColumns(ctx, "webhook_event");
  if (columns.length === 0) {
    createWebhookEventTable(ctx, "webhook_event");
    return;
  }
  if (hasExactColumns(columns, WEBHOOK_EVENT_COLUMNS)) {
    return;
  }
  if (!WEBHOOK_REQUIRED_COLUMNS.every((name) => hasColumn(columns, name))) {
    throw new Error("Unsupported webhook_event schema; refusing lossy evolution.");
  }
  const updatedAt = timestampExpression(columns);
  const attempts = hasColumn(columns, "attempts")
    ? "CASE WHEN typeof(attempts) = 'integer' AND attempts > 0 THEN attempts ELSE 1 END"
    : "1";
  const lastError = hasColumn(columns, "last_error")
    ? "CASE WHEN last_error IS NULL OR typeof(last_error) = 'text' THEN last_error ELSE NULL END"
    : "NULL";
  ctx.storage.transactionSync(() => {
    ctx.storage.sql.exec("DROP TABLE IF EXISTS webhook_event_next");
    createWebhookEventTable(ctx, "webhook_event_next");
    ctx.storage.sql.exec(
      `INSERT INTO webhook_event_next (
        event_key, body_hash, state, workflow_id, created_at,
        updated_at, attempts, last_error, expires_at
      )
      SELECT event_key, body_hash, state, workflow_id, created_at,
             ${updatedAt}, ${attempts}, ${lastError}, expires_at
        FROM webhook_event`,
    );
    assertSqliteRowCountPreserved(ctx, "webhook_event", "webhook_event_next");
    ctx.storage.sql.exec("DROP TABLE webhook_event");
    ctx.storage.sql.exec("ALTER TABLE webhook_event_next RENAME TO webhook_event");
  });
}

function reconcileSimpleTable(
  ctx: DurableObjectState,
  table: "daytona_sandbox_state" | "internal_command",
  expected: readonly ExpectedColumn[],
): void {
  const columns = tableColumns(ctx, table);
  if (columns.length === 0) {
    createSimpleTable(ctx, table);
    return;
  }
  if (hasExactColumns(columns, expected)) {
    return;
  }
  if (!expected.every(({ name }) => hasColumn(columns, name))) {
    throw new Error(`Unsupported ${table} schema; refusing lossy evolution.`);
  }
  const next =
    table === "daytona_sandbox_state" ? "daytona_sandbox_state_next" : "internal_command_next";
  const names = expected.map(({ name }) => name).join(", ");
  ctx.storage.transactionSync(() => {
    ctx.storage.sql.exec(`DROP TABLE IF EXISTS ${next}`);
    createSimpleTable(ctx, next);
    ctx.storage.sql.exec(`INSERT INTO ${next} (${names}) SELECT ${names} FROM ${table}`);
    assertSqliteRowCountPreserved(ctx, table, next);
    ctx.storage.sql.exec(`DROP TABLE ${table}`);
    ctx.storage.sql.exec(`ALTER TABLE ${next} RENAME TO ${table}`);
  });
}

function createWebhookEventTable(
  ctx: DurableObjectState,
  table: "webhook_event" | "webhook_event_next",
): void {
  ctx.storage.sql.exec(
    WEBHOOK_EVENT_TABLE_SQL.replace("CREATE TABLE webhook_event", `CREATE TABLE ${table}`),
  );
}

function createSimpleTable(
  ctx: DurableObjectState,
  table:
    | "daytona_sandbox_state"
    | "daytona_sandbox_state_next"
    | "internal_command"
    | "internal_command_next",
): void {
  if (table.startsWith("daytona_sandbox_state")) {
    ctx.storage.sql.exec(
      DAYTONA_STATE_TABLE_SQL.replace(
        "CREATE TABLE daytona_sandbox_state",
        `CREATE TABLE ${table}`,
      ),
    );
    return;
  }
  ctx.storage.sql.exec(
    INTERNAL_COMMAND_TABLE_SQL.replace("CREATE TABLE internal_command", `CREATE TABLE ${table}`),
  );
}

function rebuildWebhookStorage(ctx: DurableObjectState): void {
  const tables = ["webhook_event", "daytona_sandbox_state", "internal_command"] as const;
  for (const table of tables) {
    ctx.storage.sql.exec(`DROP TABLE IF EXISTS ${table}_next`);
    ctx.storage.sql.exec(`DROP TABLE IF EXISTS ${table}_reconcile_source`);
    ctx.storage.sql.exec(`ALTER TABLE ${table} RENAME TO ${table}_reconcile_source`);
  }
  ctx.storage.sql.exec(WEBHOOK_EVENT_TABLE_SQL);
  ctx.storage.sql.exec(DAYTONA_STATE_TABLE_SQL);
  ctx.storage.sql.exec(INTERNAL_COMMAND_TABLE_SQL);
  ctx.storage.sql.exec(
    `INSERT INTO webhook_event
      (event_key, body_hash, state, workflow_id, created_at,
       updated_at, attempts, last_error, expires_at)
     SELECT event_key, body_hash, state, workflow_id, created_at,
            updated_at, attempts, last_error, expires_at
     FROM webhook_event_reconcile_source`,
  );
  ctx.storage.sql.exec(
    `INSERT INTO daytona_sandbox_state (sandbox_id, updated_at, expires_at)
     SELECT sandbox_id, updated_at, expires_at FROM daytona_sandbox_state_reconcile_source`,
  );
  ctx.storage.sql.exec(
    `INSERT INTO internal_command (command_id, expires_at)
     SELECT command_id, expires_at FROM internal_command_reconcile_source`,
  );
  for (const table of tables) {
    assertSqliteRowCountPreserved(ctx, `${table}_reconcile_source`, table);
    ctx.storage.sql.exec(`DROP TABLE ${table}_reconcile_source`);
  }
}

function timestampExpression(columns: unknown[]): string {
  if (hasColumn(columns, "updated_at")) {
    return "CASE WHEN typeof(updated_at) = 'integer' THEN updated_at ELSE created_at END";
  }
  if (hasColumn(columns, "processed_at")) {
    return "CASE WHEN typeof(processed_at) = 'integer' THEN processed_at ELSE created_at END";
  }
  return "created_at";
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
