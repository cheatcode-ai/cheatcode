import { sql } from "drizzle-orm";
import { check, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { v2TableName } from "./names";

/**
 * Non-reversible identity tombstones prevent a stale Clerk delivery from
 * resurrecting an account after its user row and external resources are gone.
 */
export const deletedClerkIdentities = pgTable(
  v2TableName("deleted_clerk_identities"),
  {
    clerkIdentityHash: text("clerk_identity_hash").primaryKey(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "v2_deleted_clerk_identities_hash_check",
      sql`${table.clerkIdentityHash} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);
