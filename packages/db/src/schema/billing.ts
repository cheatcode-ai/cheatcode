import { sql } from "drizzle-orm";
import {
  bigint,
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
    polarCustomerId: text("polar_customer_id"),
    polarSubscriptionId: text("polar_subscription_id"),
    subscriptionStatus: text("subscription_status").notNull().default("none"),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    currentPeriodStart: timestamp("current_period_start", { withTimezone: true }),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    maxProjects: integer("max_projects").notNull().default(3),
    maxConcurrentSandboxes: integer("max_concurrent_sandboxes").notNull().default(1),
    maxSeats: integer("max_seats").notNull().default(1),
    quotaSandboxHours: numeric("quota_sandbox_hours").notNull().default("5"),
    quotaComposioCalls: integer("quota_composio_calls").notNull().default(1000),
    quotaDeployments: integer("quota_deployments").notNull().default(5),
    // Lifetime free DeepSeek token allowance: consumed counter (limit is a code constant,
    // FREE_DEEPSEEK_TOKEN_LIMIT). Defaults to 0 so every new account has the full grant.
    freeDeepseekTokensUsed: bigint("free_deepseek_tokens_used", { mode: "number" })
      .notNull()
      .default(0),
    flagPrivateProjects: boolean("flag_private_projects").notNull().default(false),
    flagSso: boolean("flag_sso").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    webhookEventId: text("webhook_event_id"),
    source: text("source"),
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
