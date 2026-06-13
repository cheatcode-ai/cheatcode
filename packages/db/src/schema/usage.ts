import { sql } from "drizzle-orm";
import {
  bigint,
  date,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { v2TableName } from "./names";
import { users } from "./users";

export const usageEvents = pgTable(v2TableName("usage_events"), {
  id: uuid("id").primaryKey().default(sql`public.uuidv7()`),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  agentRunId: uuid("agent_run_id"),
  eventType: text("event_type").notNull(),
  provider: text("provider"),
  model: text("model"),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  cachedTokens: integer("cached_tokens").notNull().default(0),
  costUsd: numeric("cost_usd", { precision: 12, scale: 6 }).notNull().default("0"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const usageDailyTotals = pgTable(
  v2TableName("usage_daily_totals"),
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    day: date("day").notNull(),
    totalInputTokens: bigint("total_input_tokens", { mode: "number" }).notNull().default(0),
    totalOutputTokens: bigint("total_output_tokens", { mode: "number" }).notNull().default(0),
    totalCachedTokens: bigint("total_cached_tokens", { mode: "number" }).notNull().default(0),
    totalCostUsd: numeric("total_cost_usd", { precision: 12, scale: 4 }).notNull().default("0"),
    agentRunCount: integer("agent_run_count").notNull().default(0),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.day] }),
  }),
);
