import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { v2TableName } from "./names";
import { projects } from "./projects";
import { users } from "./users";

/** A delivery target for an automation run summary. Telegram is intentionally excluded (web-only). */
export interface AutomationDeliveryChannel {
  type: "slack" | "notion" | "email";
  /** Slack channel id, Notion database/page id, or email address. */
  target: string;
}

/** Per-channel delivery outcome recorded on a run row; delivery retries independently of the run. */
export interface AutomationDelivery {
  type: AutomationDeliveryChannel["type"];
  target: string;
  status: "pending" | "delivered" | "failed";
  error?: string;
}

/**
 * Automations: scheduled or event-triggered agent runs (bud-parity). One dedicated
 * project (and therefore one persistent sandbox) per automation is its stateful
 * workspace; each run gets a fresh thread inside that project.
 */
export const automations = pgTable(
  v2TableName("automations"),
  {
    id: uuid("id").primaryKey().default(sql`public.uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Dedicated project that owns the persistent workspace for this automation. */
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    status: text("status").notNull().default("running"), // running | paused
    kind: text("kind").notNull(), // scheduled | event
    /** Cron expression (UTC) for kind=scheduled. */
    schedule: text("schedule"),
    /** Composio toolkit slug + trigger slug + registered trigger id for kind=event. */
    triggerToolkit: text("trigger_toolkit"),
    triggerSlug: text("trigger_slug"),
    triggerId: text("trigger_id"),
    prompt: text("prompt").notNull(),
    model: text("model"),
    deliveryChannels: jsonb("delivery_channels")
      .$type<AutomationDeliveryChannel[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("v2_automations_user_idx").on(table.userId),
    // Scheduler scan: due, running, scheduled automations.
    index("v2_automations_due_idx").on(table.status, table.nextRunAt),
    // Event dispatch lookup by registered Composio trigger.
    index("v2_automations_trigger_idx").on(table.triggerId),
  ],
);

/**
 * Idempotent outbox. Both the cron (scheduled) and the Composio webhook (event)
 * insert one row here; a claimer drives it through the AgentRun path. The UNIQUE
 * dedupeKey collapses retried cron ticks / re-delivered webhooks to one row.
 */
export const automationRunRequests = pgTable(
  v2TableName("automation_run_requests"),
  {
    id: uuid("id").primaryKey().default(sql`public.uuidv7()`),
    automationId: uuid("automation_id")
      .notNull()
      .references(() => automations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    source: text("source").notNull(), // scheduled | event | manual
    // scheduled:<automationId>:<scheduledForIso> | event:<automationId>:<composioEventId> | manual:<uuid>
    dedupeKey: text("dedupe_key").notNull(),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
    status: text("status").notNull().default("pending"), // pending | claimed | running | done | failed | dead
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    /** Only normalized fields needed to run — never raw provider payloads. */
    normalized: jsonb("normalized").$type<Record<string, string>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("v2_automation_run_requests_dedupe_idx").on(table.dedupeKey),
    // Claimer scan + stale-claim sweep.
    index("v2_automation_run_requests_status_idx").on(table.status, table.claimedAt),
    index("v2_automation_run_requests_automation_idx").on(table.automationId),
  ],
);

/** One row per executed automation run; powers the run-history UI. */
export const automationRuns = pgTable(
  v2TableName("automation_runs"),
  {
    id: uuid("id").primaryKey().default(sql`public.uuidv7()`),
    automationId: uuid("automation_id")
      .notNull()
      .references(() => automations.id, { onDelete: "cascade" }),
    requestId: uuid("request_id"),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    threadId: uuid("thread_id"),
    status: text("status").notNull().default("running"), // running | succeeded | failed | skipped
    summary: text("summary"),
    error: text("error"),
    deliveries: jsonb("deliveries")
      .$type<AutomationDelivery[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    index("v2_automation_runs_automation_idx").on(table.automationId, table.startedAt),
    // Per-automation concurrency lock: at most one active run per automation.
    uniqueIndex("v2_automation_runs_active_idx")
      .on(table.automationId)
      .where(sql`status in ('running')`),
  ],
);
