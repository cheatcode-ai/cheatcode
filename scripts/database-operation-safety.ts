import type { PgClient } from "../packages/db/src/supabase-target";

export type DatabaseOperationMode = "apply" | "dry-run";

export interface DatabaseIdentityExpectation {
  expectedDatabase?: string;
  expectedHost?: string;
  expectedRole?: string;
  expectedSystemIdentifier?: string;
}

interface SessionOptions {
  applicationName: string;
  statementTimeout: string;
}

const MAINTENANCE_LOCK_NAME = "cheatcode:database-maintenance:v1";
const RUNTIME_DATABASE_ROLES = new Set(["app_agent", "app_gateway", "app_webhooks", "app_worker"]);

export function assertAdministrativeConnectionTarget(
  databaseUrl: string,
  expectation: DatabaseIdentityExpectation,
  mode: DatabaseOperationMode,
): void {
  const target = new URL(databaseUrl);
  if (RUNTIME_DATABASE_ROLES.has(decodeURIComponent(target.username))) {
    throw new Error("Administrative database operations must never use a runtime Worker role.");
  }
  if (mode === "apply" && !expectation.expectedHost) {
    throw new Error("Set SUPABASE_MIGRATION_EXPECTED_HOST before mutating the database.");
  }
  if (
    expectation.expectedHost &&
    target.hostname.toLowerCase() !== expectation.expectedHost.toLowerCase()
  ) {
    throw new Error(
      `Database target host mismatch: expected ${expectation.expectedHost}, got ${target.hostname}.`,
    );
  }
}

export async function assertPinnedDatabaseIdentity(
  client: PgClient,
  expectation: DatabaseIdentityExpectation,
  mode: DatabaseOperationMode,
): Promise<void> {
  const missing = requiredIdentityVariables(expectation);
  if (mode === "apply" && missing.length > 0) {
    throw new Error(`Set ${missing.join(", ")} before mutating the database.`);
  }
  const result = await client.query(
    `select current_database() as database,
            current_user as role,
            (select system_identifier::text from pg_control_system()) as system_identifier`,
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error("Unable to read database identity.");
  }
  if (typeof row["role"] === "string" && RUNTIME_DATABASE_ROLES.has(row["role"])) {
    throw new Error("Administrative database operations must never run as a runtime Worker role.");
  }
  assertExpectedIdentity("database", row["database"], expectation.expectedDatabase);
  assertExpectedIdentity("role", row["role"], expectation.expectedRole);
  assertExpectedIdentity(
    "system identifier",
    row["system_identifier"],
    expectation.expectedSystemIdentifier,
  );
}

function requiredIdentityVariables(expectation: DatabaseIdentityExpectation): string[] {
  return [
    expectation.expectedDatabase ? null : "SUPABASE_MIGRATION_EXPECTED_DATABASE",
    expectation.expectedRole ? null : "SUPABASE_MIGRATION_EXPECTED_ROLE",
    expectation.expectedSystemIdentifier ? null : "SUPABASE_MIGRATION_EXPECTED_SYSTEM_IDENTIFIER",
  ].filter((value): value is string => value !== null);
}

function assertExpectedIdentity(
  label: string,
  actual: unknown,
  expected: string | undefined,
): void {
  if (expected && actual !== expected) {
    throw new Error(
      `Database target ${label} mismatch: expected ${expected}, got ${String(actual)}.`,
    );
  }
}

export async function configureDatabaseOperationSession(
  client: PgClient,
  options: SessionOptions,
): Promise<void> {
  if (!/^cheatcode-[a-z-]+$/.test(options.applicationName)) {
    throw new Error("Invalid database operation application name.");
  }
  if (!/^\d+(?:ms|s|min)$/.test(options.statementTimeout)) {
    throw new Error("Invalid database statement timeout.");
  }
  await client.query("select set_config('application_name', $1, false)", [options.applicationName]);
  await client.query("set timezone = 'UTC'");
  await client.query("set lock_timeout = '15s'");
  await client.query(`set statement_timeout = '${options.statementTimeout}'`);
  await client.query("set idle_in_transaction_session_timeout = '60s'");
}

export async function acquireDatabaseMaintenanceLock(
  client: PgClient,
  operationLabel: string,
): Promise<void> {
  const result = await client.query(
    "select pg_try_advisory_lock(hashtextextended($1, 0)) as locked",
    [MAINTENANCE_LOCK_NAME],
  );
  if (result.rows[0]?.["locked"] !== true) {
    throw new Error(
      `Another Cheatcode database maintenance operation is running; ${operationLabel} stopped.`,
    );
  }
}

export async function releaseDatabaseMaintenanceLock(client: PgClient): Promise<void> {
  const result = await client.query(
    "select pg_advisory_unlock(hashtextextended($1, 0)) as unlocked",
    [MAINTENANCE_LOCK_NAME],
  );
  if (result.rows[0]?.["unlocked"] !== true) {
    throw new Error("Database maintenance advisory lock was not held by this session.");
  }
}
