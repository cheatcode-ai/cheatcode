interface ExpectedColumn {
  defaultValue: string | null;
  isNotNull: boolean;
  isPrimaryKey: boolean;
  name: string;
  type: string;
}

const WEBHOOK_EVENT_COLUMNS = [
  column("event_key", "TEXT", false, true),
  column("body_hash", "TEXT", true),
  column("state", "TEXT", true),
  column("workflow_id", "TEXT"),
  column("created_at", "INTEGER", true),
  column("updated_at", "INTEGER", true),
  column("attempts", "INTEGER", true),
  column("last_error", "TEXT"),
  column("expires_at", "INTEGER", true),
] as const satisfies readonly ExpectedColumn[];

const DAYTONA_STATE_COLUMNS = [
  column("sandbox_id", "TEXT", false, true),
  column("updated_at", "INTEGER", true),
  column("expires_at", "INTEGER", true),
] as const satisfies readonly ExpectedColumn[];

const INTERNAL_COMMAND_COLUMNS = [
  column("command_id", "TEXT", false, true),
  column("expires_at", "INTEGER", true),
] as const satisfies readonly ExpectedColumn[];

const WEBHOOK_EVENT_REQUIRED_COLUMNS = [
  "event_key",
  "body_hash",
  "state",
  "workflow_id",
  "created_at",
  "expires_at",
] as const;

/** Reconcile all WebhookIdempotencyStore tables to their current exact column sets. */
export function initializeWebhookIdempotencyStorage(ctx: DurableObjectState): void {
  ensureWebhookEventSchema(ctx);
  ensureDaytonaStateSchema(ctx);
  ensureInternalCommandSchema(ctx);
}

function ensureWebhookEventSchema(ctx: DurableObjectState): void {
  const columns = ctx.storage.sql.exec("PRAGMA table_info(webhook_event)").toArray();
  if (columns.length === 0) {
    createWebhookEventTable(ctx, "webhook_event");
    return;
  }
  if (hasExactColumns(columns, WEBHOOK_EVENT_COLUMNS)) {
    return;
  }
  if (!WEBHOOK_EVENT_REQUIRED_COLUMNS.every((name) => hasColumn(columns, name))) {
    throw new Error("Unsupported webhook_event schema; refusing a lossy reconciliation.");
  }

  ctx.storage.transactionSync(() => {
    ctx.storage.sql.exec("DROP TABLE IF EXISTS webhook_event_current");
    createWebhookEventTable(ctx, "webhook_event_current");
    copyBaseWebhookRows(ctx);
    restoreProcessedTimestamp(ctx, columns);
    restoreUpdatedTimestamp(ctx, columns);
    restoreAttempts(ctx, columns);
    restoreLastError(ctx, columns);
    ctx.storage.sql.exec("DROP TABLE webhook_event");
    ctx.storage.sql.exec("ALTER TABLE webhook_event_current RENAME TO webhook_event");
  });
}

function ensureDaytonaStateSchema(ctx: DurableObjectState): void {
  const columns = ctx.storage.sql.exec("PRAGMA table_info(daytona_sandbox_state)").toArray();
  if (columns.length === 0) {
    createDaytonaStateTable(ctx, "daytona_sandbox_state");
    return;
  }
  if (hasExactColumns(columns, DAYTONA_STATE_COLUMNS)) {
    return;
  }
  if (!DAYTONA_STATE_COLUMNS.every(({ name }) => hasColumn(columns, name))) {
    throw new Error("Unsupported daytona_sandbox_state schema; refusing a lossy reconciliation.");
  }
  ctx.storage.transactionSync(() => {
    ctx.storage.sql.exec("DROP TABLE IF EXISTS daytona_sandbox_state_current");
    createDaytonaStateTable(ctx, "daytona_sandbox_state_current");
    ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO daytona_sandbox_state_current (sandbox_id, updated_at, expires_at)
       SELECT sandbox_id, updated_at, expires_at
       FROM daytona_sandbox_state
       WHERE typeof(sandbox_id) = 'text'
         AND typeof(updated_at) = 'integer'
         AND typeof(expires_at) = 'integer'`,
    );
    ctx.storage.sql.exec("DROP TABLE daytona_sandbox_state");
    ctx.storage.sql.exec(
      "ALTER TABLE daytona_sandbox_state_current RENAME TO daytona_sandbox_state",
    );
  });
}

function ensureInternalCommandSchema(ctx: DurableObjectState): void {
  const columns = ctx.storage.sql.exec("PRAGMA table_info(internal_command)").toArray();
  if (columns.length === 0) {
    createInternalCommandTable(ctx, "internal_command");
    return;
  }
  if (hasExactColumns(columns, INTERNAL_COMMAND_COLUMNS)) {
    return;
  }
  if (!INTERNAL_COMMAND_COLUMNS.every(({ name }) => hasColumn(columns, name))) {
    throw new Error("Unsupported internal_command schema; refusing a lossy reconciliation.");
  }
  ctx.storage.transactionSync(() => {
    ctx.storage.sql.exec("DROP TABLE IF EXISTS internal_command_current");
    createInternalCommandTable(ctx, "internal_command_current");
    ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO internal_command_current (command_id, expires_at)
       SELECT command_id, expires_at
       FROM internal_command
       WHERE typeof(command_id) = 'text'
         AND typeof(expires_at) = 'integer'`,
    );
    ctx.storage.sql.exec("DROP TABLE internal_command");
    ctx.storage.sql.exec("ALTER TABLE internal_command_current RENAME TO internal_command");
  });
}

function createWebhookEventTable(
  ctx: DurableObjectState,
  table: "webhook_event" | "webhook_event_current",
): void {
  if (table === "webhook_event") {
    ctx.storage.sql.exec(
      `CREATE TABLE webhook_event (
        event_key TEXT PRIMARY KEY,
        body_hash TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('accepted', 'running', 'processed', 'failed')),
        workflow_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        attempts INTEGER NOT NULL CHECK (attempts >= 0),
        last_error TEXT,
        expires_at INTEGER NOT NULL
      )`,
    );
    return;
  }
  ctx.storage.sql.exec(
    `CREATE TABLE webhook_event_current (
      event_key TEXT PRIMARY KEY,
      body_hash TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('accepted', 'running', 'processed', 'failed')),
      workflow_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      attempts INTEGER NOT NULL CHECK (attempts >= 0),
      last_error TEXT,
      expires_at INTEGER NOT NULL
    )`,
  );
}

function createDaytonaStateTable(
  ctx: DurableObjectState,
  table: "daytona_sandbox_state" | "daytona_sandbox_state_current",
): void {
  if (table === "daytona_sandbox_state") {
    ctx.storage.sql.exec(
      `CREATE TABLE daytona_sandbox_state (
        sandbox_id TEXT PRIMARY KEY,
        updated_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      )`,
    );
    return;
  }
  ctx.storage.sql.exec(
    `CREATE TABLE daytona_sandbox_state_current (
      sandbox_id TEXT PRIMARY KEY,
      updated_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    )`,
  );
}

function createInternalCommandTable(
  ctx: DurableObjectState,
  table: "internal_command" | "internal_command_current",
): void {
  if (table === "internal_command") {
    ctx.storage.sql.exec(
      `CREATE TABLE internal_command (
        command_id TEXT PRIMARY KEY,
        expires_at INTEGER NOT NULL
      )`,
    );
    return;
  }
  ctx.storage.sql.exec(
    `CREATE TABLE internal_command_current (
      command_id TEXT PRIMARY KEY,
      expires_at INTEGER NOT NULL
    )`,
  );
}

function copyBaseWebhookRows(ctx: DurableObjectState): void {
  ctx.storage.sql.exec(
    `INSERT OR REPLACE INTO webhook_event_current (
      event_key, body_hash, state, workflow_id, created_at,
      updated_at, attempts, last_error, expires_at
    )
    SELECT event_key, body_hash, state, workflow_id, created_at,
           created_at, 1, NULL, expires_at
    FROM webhook_event
    WHERE typeof(event_key) = 'text'
      AND typeof(body_hash) = 'text'
      AND state IN ('accepted', 'running', 'processed', 'failed')
      AND (workflow_id IS NULL OR typeof(workflow_id) = 'text')
      AND typeof(created_at) = 'integer'
      AND typeof(expires_at) = 'integer'`,
  );
}

function restoreProcessedTimestamp(ctx: DurableObjectState, columns: unknown[]): void {
  if (!hasColumn(columns, "processed_at")) {
    return;
  }
  ctx.storage.sql.exec(
    `UPDATE webhook_event_current
     SET updated_at = COALESCE(
       (SELECT legacy.processed_at
        FROM webhook_event AS legacy
        WHERE legacy.event_key = webhook_event_current.event_key
          AND typeof(legacy.processed_at) = 'integer'
          AND legacy.processed_at > 0),
       updated_at
     )`,
  );
}

function restoreUpdatedTimestamp(ctx: DurableObjectState, columns: unknown[]): void {
  if (!hasColumn(columns, "updated_at")) {
    return;
  }
  ctx.storage.sql.exec(
    `UPDATE webhook_event_current
     SET updated_at = COALESCE(
       (SELECT legacy.updated_at
        FROM webhook_event AS legacy
        WHERE legacy.event_key = webhook_event_current.event_key
          AND typeof(legacy.updated_at) = 'integer'
          AND legacy.updated_at > 0),
       updated_at
     )`,
  );
}

function restoreAttempts(ctx: DurableObjectState, columns: unknown[]): void {
  if (!hasColumn(columns, "attempts")) {
    return;
  }
  ctx.storage.sql.exec(
    `UPDATE webhook_event_current
     SET attempts = COALESCE(
       (SELECT legacy.attempts
        FROM webhook_event AS legacy
        WHERE legacy.event_key = webhook_event_current.event_key
          AND typeof(legacy.attempts) = 'integer'
          AND legacy.attempts > 0),
       attempts
     )`,
  );
}

function restoreLastError(ctx: DurableObjectState, columns: unknown[]): void {
  if (!hasColumn(columns, "last_error")) {
    return;
  }
  ctx.storage.sql.exec(
    `UPDATE webhook_event_current
     SET last_error = (
       SELECT CASE
         WHEN legacy.last_error IS NULL OR typeof(legacy.last_error) = 'text'
           THEN legacy.last_error
         ELSE NULL
       END
       FROM webhook_event AS legacy
       WHERE legacy.event_key = webhook_event_current.event_key
     )`,
  );
}

function column(
  name: string,
  type: string,
  isNotNull = false,
  isPrimaryKey = false,
): ExpectedColumn {
  return { defaultValue: null, isNotNull, isPrimaryKey, name, type };
}

function hasExactColumns(rows: unknown[], expected: readonly ExpectedColumn[]): boolean {
  return (
    rows.length === expected.length &&
    expected.every((expectedColumn, index) => isColumn(rows[index], index, expectedColumn))
  );
}

function hasColumn(rows: unknown[], name: string): boolean {
  return rows.some((row) => isRecord(row) && row["name"] === name);
}

function isColumn(value: unknown, index: number, expected: ExpectedColumn): boolean {
  if (!isRecord(value)) {
    return false;
  }
  return (
    value["cid"] === index &&
    value["name"] === expected.name &&
    value["type"] === expected.type &&
    value["notnull"] === Number(expected.isNotNull) &&
    value["dflt_value"] === expected.defaultValue &&
    value["pk"] === Number(expected.isPrimaryKey)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
