import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { v2TableName } from "./names";
import { users } from "./users";

export const entitlements = pgTable(
  v2TableName("entitlements"),
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    tier: text("tier").notNull().default("free"),
    polarSubscriptionId: text("polar_subscription_id"),
    subscriptionStatus: text("subscription_status").notNull().default("none"),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    currentPeriodStart: timestamp("current_period_start", { withTimezone: true }),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    maxProjects: integer("max_projects").notNull().default(3),
    quotaSandboxHours: numeric("quota_sandbox_hours").notNull().default("5"),
    quotaComposioCalls: integer("quota_composio_calls").notNull().default(1000),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "v2_entitlements_tier_check",
      sql`${table.tier} in ('free','pro','premium','ultra','max')`,
    ),
  ],
);

export const billingEvents = pgTable(v2TableName("billing_events"), {
  id: uuid("id").primaryKey().default(sql`public.uuidv7()`),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  eventType: text("event_type").notNull(),
  polarEventId: text("polar_event_id").unique(),
  payload: jsonb("payload").$type<Record<string, unknown>>(),
  processedAt: timestamp("processed_at", { withTimezone: true }).defaultNow(),
});
