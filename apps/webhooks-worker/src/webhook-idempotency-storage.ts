import {
  assertExactSqliteSchema,
  type ExpectedSqliteObject,
  setCurrentSqliteStorageVersion,
} from "@cheatcode/durable-storage";

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

/** Initializes a new object on the current schema. */
export function initializeWebhookIdempotencyStorage(ctx: DurableObjectState): void {
  ctx.storage.transactionSync(() => {
    ctx.storage.sql.exec(WEBHOOK_EVENT_TABLE_SQL);
    ctx.storage.sql.exec(DAYTONA_STATE_TABLE_SQL);
    ctx.storage.sql.exec(INTERNAL_COMMAND_TABLE_SQL);
    setCurrentSqliteStorageVersion(ctx);
  });
  assertWebhookIdempotencyStorage(ctx);
}

export function assertWebhookIdempotencyStorage(ctx: DurableObjectState): void {
  assertExactSqliteSchema(ctx, WEBHOOK_STORAGE_SCHEMA);
}

export function hasWebhookIdempotencyStorage(ctx: DurableObjectState): boolean {
  return ctx.storage.sql.exec("PRAGMA table_info(webhook_event)").toArray().length > 0;
}
