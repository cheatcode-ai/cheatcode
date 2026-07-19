import { sql } from "drizzle-orm";
import { bigint, check, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { v2TableName } from "./names";

export const users = pgTable(
  v2TableName("users"),
  {
    id: uuid("id").primaryKey().default(sql`public.uuidv7()`),
    clerkId: text("clerk_id").notNull().unique(),
    clerkUpdatedAtMs: bigint("clerk_updated_at_ms", { mode: "number" }).notNull(),
    email: text("email").notNull(),
    displayName: text("display_name"),
    avatarUrl: text("avatar_url"),
    polarCustomerId: text("polar_customer_id").unique(),
    firstArtifactAt: timestamp("first_artifact_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletionFence: text("deletion_fence"),
  },
  (table) => [
    check(
      "v2_users_clerk_updated_at_ms_check",
      sql`${table.clerkUpdatedAtMs} between 0 and 9007199254740991`,
    ),
    index("v2_users_activation_created_idx")
      .on(table.createdAt, table.id)
      .where(sql`${table.deletedAt} is null`),
    index("v2_users_deletion_due_idx")
      .on(table.deletedAt, table.id)
      .where(sql`${table.deletedAt} is not null`),
  ],
);
