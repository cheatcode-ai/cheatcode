import { sql } from "drizzle-orm";
import { bigint, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { v2TableName } from "./names";
import { users } from "./users";

export const generatedOutputs = pgTable(
  v2TableName("generated_outputs"),
  {
    id: uuid("id").primaryKey().default(sql`public.uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    projectId: uuid("project_id"),
    agentRunId: uuid("agent_run_id"),
    kind: text("kind").notNull(),
    filename: text("filename").notNull(),
    r2Bucket: text("r2_bucket").notNull().default("cheatcode-outputs"),
    r2Key: text("r2_key").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    sha256: text("sha256").notNull(),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("v2_generated_outputs_expiry_idx")
      .on(table.expiresAt, table.id)
      .where(sql`${table.expiresAt} is not null`),
  ],
);
