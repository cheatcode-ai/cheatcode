import { sql } from "drizzle-orm";
import { jsonb, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { v2TableName } from "./names";
import { users } from "./users";

export interface OnboardingStateValue {
  steps?: Partial<Record<"intro" | "name" | "tools" | "basics" | "plan", "done" | "skipped">>;
}

export const userProfiles = pgTable(v2TableName("user_profiles"), {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  agentDisplayName: text("agent_display_name"),
  globalMemory: text("global_memory"),
  // Per-surface Agent defaults (design 13b). null model = Auto; null budget = No cap.
  appbuilderDefaultModel: text("appbuilder_default_model"),
  generalDefaultModel: text("general_default_model"),
  appbuilderDefaultBudgetUsd: numeric("appbuilder_default_budget_usd", {
    precision: 10,
    scale: 2,
  }).$type<number>(),
  generalDefaultBudgetUsd: numeric("general_default_budget_usd", {
    precision: 10,
    scale: 2,
  }).$type<number>(),
  disabledModels: jsonb("disabled_models").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  onboardingCompletedAt: timestamp("onboarding_completed_at", { withTimezone: true }),
  onboardingState: jsonb("onboarding_state")
    .$type<OnboardingStateValue>()
    .notNull()
    .default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
