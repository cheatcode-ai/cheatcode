import { sql } from "drizzle-orm";
import { boolean, check, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
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
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "v2_entitlements_tier_check",
      sql`${table.tier} in ('free','pro','premium','ultra','max')`,
    ),
    uniqueIndex("v2_entitlements_polar_subscription_uidx")
      .on(table.polarSubscriptionId)
      .where(sql`${table.polarSubscriptionId} is not null`),
    check(
      "v2_entitlements_period_order_check",
      sql`${table.currentPeriodStart} is null or ${table.currentPeriodEnd} is null or ${table.currentPeriodStart} <= ${table.currentPeriodEnd}`,
    ),
  ],
);
