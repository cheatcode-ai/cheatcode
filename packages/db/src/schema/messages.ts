import type { UIMessagePart } from "@cheatcode/types";
import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { v2TableName } from "./names";
import { users } from "./users";

export interface AgentRunError {
  type: string;
  message: string;
}

export const messages = pgTable(
  v2TableName("messages"),
  {
    id: uuid("id").primaryKey().default(sql`public.uuidv7()`),
    threadId: uuid("thread_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    parts: jsonb("parts").$type<UIMessagePart[]>().notNull(),
    agentRunId: uuid("agent_run_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("v2_messages_thread_page_idx").on(
      table.userId,
      table.threadId,
      table.createdAt,
      table.id,
    ),
    uniqueIndex("v2_messages_agent_run_assistant_uidx")
      .on(table.agentRunId)
      .where(sql`${table.agentRunId} is not null and ${table.role} = 'assistant'`),
  ],
);

export const agentRuns = pgTable(
  v2TableName("agent_runs"),
  {
    id: uuid("id").primaryKey().default(sql`public.uuidv7()`),
    threadId: uuid("thread_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: text("status").notNull(),
    modelId: text("model_id").notNull(),
    error: jsonb("error").$type<AgentRunError | null>(),
    idempotencyKeyHash: text("idempotency_key_hash"),
    requestBodyHash: text("request_body_hash"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("v2_agent_runs_user_idempotency_key_unique").on(
      table.userId,
      table.idempotencyKeyHash,
    ),
    index("v2_agent_runs_user_delete_page_idx").on(table.userId, table.id),
    check(
      "v2_agent_runs_idempotency_key_hash_check",
      sql`${table.idempotencyKeyHash} is null or ${table.idempotencyKeyHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "v2_agent_runs_request_body_hash_check",
      sql`${table.requestBodyHash} is null or ${table.requestBodyHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "v2_agent_runs_model_id_canonical_check",
      sql`char_length(${table.modelId}) <= 200 and ${table.modelId} ~ '^(anthropic|deepseek|google|openai|openrouter)/[^[:space:]]+$'`,
    ),
  ],
);
