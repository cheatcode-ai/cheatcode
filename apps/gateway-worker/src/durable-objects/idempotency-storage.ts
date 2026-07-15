const IDEMPOTENCY_ENTRY_COLUMNS = [
  { defaultValue: null, isNotNull: false, isPrimaryKey: true, name: "key", type: "TEXT" },
  { defaultValue: null, isNotNull: true, isPrimaryKey: false, name: "body_hash", type: "TEXT" },
  { defaultValue: null, isNotNull: false, isPrimaryKey: false, name: "claim_id", type: "TEXT" },
  { defaultValue: null, isNotNull: true, isPrimaryKey: false, name: "state", type: "TEXT" },
  {
    defaultValue: null,
    isNotNull: false,
    isPrimaryKey: false,
    name: "response_status",
    type: "INTEGER",
  },
  {
    defaultValue: null,
    isNotNull: false,
    isPrimaryKey: false,
    name: "response_headers_json",
    type: "TEXT",
  },
  {
    defaultValue: null,
    isNotNull: false,
    isPrimaryKey: false,
    name: "response_body",
    type: "TEXT",
  },
  {
    defaultValue: null,
    isNotNull: true,
    isPrimaryKey: false,
    name: "expires_at",
    type: "INTEGER",
  },
] as const;

const REQUIRED_PERSISTED_COLUMNS = [
  "key",
  "body_hash",
  "state",
  "response_status",
  "response_headers_json",
  "response_body",
  "expires_at",
] as const;

/** Reconcile deployed Durable Object storage to the one current idempotency schema. */
export function initializeIdempotencyStorage(ctx: DurableObjectState): void {
  const columns = ctx.storage.sql.exec("PRAGMA table_info(idempotency_entry)").toArray();
  if (columns.length === 0) {
    createIdempotencyEntryTable(ctx, "idempotency_entry");
    return;
  }
  if (hasExactColumns(columns, IDEMPOTENCY_ENTRY_COLUMNS)) {
    return;
  }
  if (!REQUIRED_PERSISTED_COLUMNS.every((name) => hasColumn(columns, name))) {
    throw new Error("Unsupported idempotency_entry schema; refusing a lossy reconciliation.");
  }

  const hasClaimId = hasColumn(columns, "claim_id");
  ctx.storage.transactionSync(() => {
    ctx.storage.sql.exec("DROP TABLE IF EXISTS idempotency_entry_current");
    createIdempotencyEntryTable(ctx, "idempotency_entry_current");
    copyIdempotencyEntries(ctx, hasClaimId);
    ctx.storage.sql.exec("DROP TABLE idempotency_entry");
    ctx.storage.sql.exec("ALTER TABLE idempotency_entry_current RENAME TO idempotency_entry");
  });
}

function createIdempotencyEntryTable(
  ctx: DurableObjectState,
  table: "idempotency_entry" | "idempotency_entry_current",
): void {
  if (table === "idempotency_entry") {
    ctx.storage.sql.exec(
      `CREATE TABLE idempotency_entry (
        key TEXT PRIMARY KEY,
        body_hash TEXT NOT NULL,
        claim_id TEXT,
        state TEXT NOT NULL CHECK (state IN ('in_flight', 'completed')),
        response_status INTEGER,
        response_headers_json TEXT,
        response_body TEXT,
        expires_at INTEGER NOT NULL
      )`,
    );
    return;
  }
  ctx.storage.sql.exec(
    `CREATE TABLE idempotency_entry_current (
      key TEXT PRIMARY KEY,
      body_hash TEXT NOT NULL,
      claim_id TEXT,
      state TEXT NOT NULL CHECK (state IN ('in_flight', 'completed')),
      response_status INTEGER,
      response_headers_json TEXT,
      response_body TEXT,
      expires_at INTEGER NOT NULL
    )`,
  );
}

function copyIdempotencyEntries(ctx: DurableObjectState, hasClaimId: boolean): void {
  if (hasClaimId) {
    ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO idempotency_entry_current (
        key, body_hash, claim_id, state, response_status,
        response_headers_json, response_body, expires_at
      )
      SELECT key, body_hash, claim_id, state, response_status,
             response_headers_json, response_body, expires_at
      FROM idempotency_entry
      WHERE typeof(key) = 'text'
        AND typeof(body_hash) = 'text'
        AND (claim_id IS NULL OR typeof(claim_id) = 'text')
        AND state IN ('in_flight', 'completed')
        AND (response_status IS NULL OR typeof(response_status) = 'integer')
        AND (response_headers_json IS NULL OR typeof(response_headers_json) = 'text')
        AND (response_body IS NULL OR typeof(response_body) = 'text')
        AND typeof(expires_at) = 'integer'`,
    );
    return;
  }
  ctx.storage.sql.exec(
    `INSERT OR REPLACE INTO idempotency_entry_current (
      key, body_hash, claim_id, state, response_status,
      response_headers_json, response_body, expires_at
    )
    SELECT key, body_hash, NULL, state, response_status,
           response_headers_json, response_body, expires_at
    FROM idempotency_entry
    WHERE typeof(key) = 'text'
      AND typeof(body_hash) = 'text'
      AND state IN ('in_flight', 'completed')
      AND (response_status IS NULL OR typeof(response_status) = 'integer')
      AND (response_headers_json IS NULL OR typeof(response_headers_json) = 'text')
      AND (response_body IS NULL OR typeof(response_body) = 'text')
      AND typeof(expires_at) = 'integer'`,
  );
}

function hasExactColumns(
  rows: unknown[],
  expected: ReadonlyArray<{
    defaultValue: string | null;
    isNotNull: boolean;
    isPrimaryKey: boolean;
    name: string;
    type: string;
  }>,
): boolean {
  return (
    rows.length === expected.length &&
    expected.every((column, index) => isColumn(rows[index], index, column))
  );
}

function hasColumn(rows: unknown[], name: string): boolean {
  return rows.some((row) => isRecord(row) && row["name"] === name);
}

function isColumn(
  value: unknown,
  index: number,
  expected: {
    defaultValue: string | null;
    isNotNull: boolean;
    isPrimaryKey: boolean;
    name: string;
    type: string;
  },
): boolean {
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
