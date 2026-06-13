import type { UIMessagePart } from "@cheatcode/types";
import { sql } from "drizzle-orm";
import { integer, jsonb, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { v2TableName } from "./names";
import { threads } from "./projects";
import { users } from "./users";

export interface AgentRunConfig {
  agentName: string;
  workflowName?: string;
  budgetCapUsd?: number;
  stepCap?: number;
  source: "web" | "api";
}

export interface AgentRunError {
  type: string;
  message: string;
  stepNumber?: number;
}

export const messages = pgTable(v2TableName("messages"), {
  id: uuid("id").primaryKey().default(sql`public.uuidv7()`),
  threadId: uuid("thread_id")
    .notNull()
    .references(() => threads.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  parts: jsonb("parts").$type<UIMessagePart[]>().notNull(),
  agentRunId: uuid("agent_run_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const agentRuns = pgTable(v2TableName("agent_runs"), {
  id: uuid("id").primaryKey().default(sql`public.uuidv7()`),
  threadId: uuid("thread_id")
    .notNull()
    .references(() => threads.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  status: text("status").notNull(),
  modelId: text("model_id"),
  tokensIn: integer("tokens_in").notNull().default(0),
  tokensOut: integer("tokens_out").notNull().default(0),
  tokensCached: integer("tokens_cached").notNull().default(0),
  costUsd: numeric("cost_usd", { precision: 12, scale: 6 }).notNull().default("0"),
  config: jsonb("config").$type<AgentRunConfig>().notNull().default(sql`'{}'::jsonb`),
  error: jsonb("error").$type<AgentRunError | null>(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});
