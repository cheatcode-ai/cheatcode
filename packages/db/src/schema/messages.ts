import type { UIMessagePart } from "@cheatcode/types";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { v2TableName } from "./names";
import { users } from "./users";

export const messages = pgTable(
  v2TableName("messages"),
  {
    id: uuid("id").primaryKey().default(sql`public.uuidv7()`),
    threadId: uuid("thread_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").$type<"assistant" | "user">().notNull(),
    parts: jsonb("parts").$type<UIMessagePart[]>().notNull(),
    agentRunId: uuid("agent_run_id"),
    agentRunSegment: integer("agent_run_segment").notNull().default(0),
    agentRunSegmentFinal: boolean("agent_run_segment_final").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("v2_messages_thread_page_idx").on(
      table.userId,
      table.threadId,
      table.createdAt,
      table.agentRunSegment,
      table.id,
    ),
    uniqueIndex("v2_messages_agent_run_segment_assistant_uidx")
      .on(table.agentRunId, table.agentRunSegment)
      .where(sql`${table.agentRunId} is not null and ${table.role} = 'assistant'`),
    uniqueIndex("v2_messages_agent_run_final_assistant_uidx")
      .on(table.agentRunId)
      .where(
        sql`${table.agentRunId} is not null and ${table.role} = 'assistant' and ${table.agentRunSegmentFinal}`,
      ),
    check("v2_messages_agent_run_segment_check", sql`${table.agentRunSegment} >= 0`),
    check("v2_messages_role_check", sql`${table.role} in ('assistant', 'user')`),
    check(
      "v2_messages_agent_run_segment_scope_check",
      sql`(${table.agentRunSegment} = 0 and ${table.agentRunSegmentFinal}) or (${table.role} = 'assistant' and ${table.agentRunId} is not null)`,
    ),
    check("v2_messages_parts_array_check", sql`jsonb_typeof(${table.parts}) = 'array'`),
    check("v2_messages_parts_size_check", sql`octet_length(${table.parts}::text) <= 196608`),
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
    idempotencyKeyHash: text("idempotency_key_hash"),
    requestBodyHash: text("request_body_hash"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    unique("v2_agent_runs_id_user_id_key").on(table.id, table.userId),
    uniqueIndex("v2_agent_runs_user_idempotency_key_unique").on(
      table.userId,
      table.idempotencyKeyHash,
    ),
    index("v2_agent_runs_user_started_idx").on(table.userId, table.startedAt.desc().nullsFirst()),
    index("v2_agent_runs_user_finished_idx")
      .on(table.userId, table.finishedAt)
      .where(sql`${table.finishedAt} is not null`),
    index("v2_agent_runs_user_delete_page_idx").on(table.userId, table.id),
    index("v2_agent_runs_thread_delete_page_idx").on(table.userId, table.threadId, table.id),
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
    check(
      "v2_agent_runs_status_check",
      sql`${table.status} in ('pending', 'running', 'completed', 'failed', 'canceled')`,
    ),
    check(
      "v2_agent_runs_finished_order_check",
      sql`${table.finishedAt} is null or ${table.finishedAt} >= ${table.startedAt}`,
    ),
    check(
      "v2_agent_runs_terminal_timestamp_check",
      sql`(${table.status} in ('completed', 'failed', 'canceled')) = (${table.finishedAt} is not null)`,
    ),
  ],
);
