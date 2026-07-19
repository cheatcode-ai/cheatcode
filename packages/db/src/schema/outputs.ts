import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { v2TableName } from "./names";
import { users } from "./users";

export const generatedOutputs = pgTable(
  v2TableName("generated_outputs"),
  {
    id: uuid("id").primaryKey().default(sql`public.uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    agentRunId: uuid("agent_run_id").notNull(),
    filename: text("filename").notNull(),
    r2Key: text("r2_key").notNull().unique("v2_generated_outputs_r2_key_unique"),
    mimeType: text("mime_type").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("v2_generated_outputs_agent_run_idx").on(table.agentRunId),
    check(
      "v2_generated_outputs_r2_identity_check",
      sql`${table.r2Key} = ${table.userId}::text || '/' || split_part(${table.r2Key}, '/', 2) || '/' || ${table.agentRunId}::text || '/' || ${table.id}::text || '-' || ${table.filename}
        and split_part(${table.r2Key}, '/', 2) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        and strpos(${table.filename}, '/') = 0`,
    ),
  ],
);
