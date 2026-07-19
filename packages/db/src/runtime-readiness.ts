import { UserId } from "@cheatcode/types";
import { sql } from "drizzle-orm";
import { type Database, withUserContext } from "./client";
import type { DatabaseRuntimeAudience } from "./database-context";

const DATABASE_READINESS_SENTINEL = UserId("00000000-0000-4000-8000-000000000001");

/**
 * Proves the live connection role and that its role-specific signed context agrees with Vault.
 * The sentinel is deliberately not a tenant row, so the probe reads or mutates no customer data.
 */
export async function assertDatabaseRuntimeReadiness(
  db: Database,
  expectedRole: DatabaseRuntimeAudience,
): Promise<void> {
  const result = await withUserContext(db, DATABASE_READINESS_SENTINEL, (transaction) =>
    transaction.execute(sql`
      select
        public.current_app_user()::text as actor_id,
        session_user::text as database_role
    `),
  );
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (
    result.rows.length !== 1 ||
    row?.["actor_id"] !== DATABASE_READINESS_SENTINEL ||
    row?.["database_role"] !== expectedRole
  ) {
    throw new Error("Database runtime identity did not match its signed readiness contract");
  }
}
