import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { v2TableName } from "./names";

export const auditLog = pgTable(
  v2TableName("audit_log"),
  {
    id: uuid("id").primaryKey().default(sql`public.uuidv7()`),
    userId: uuid("user_id"),
    action: text("action").notNull(),
    resourceType: text("resource_type"),
    resourceId: text("resource_id"),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("v2_audit_log_action_created_idx").on(table.action, table.createdAt.desc()),
    index("v2_audit_log_created_brin_idx").using("brin", table.createdAt),
    index("v2_audit_log_user_created_idx").on(table.userId, table.createdAt.desc()),
  ],
);
