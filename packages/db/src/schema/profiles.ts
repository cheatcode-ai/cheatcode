import { sql } from "drizzle-orm";
import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
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
  disabledModels: jsonb("disabled_models").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  onboardingCompletedAt: timestamp("onboarding_completed_at", { withTimezone: true }),
  onboardingState: jsonb("onboarding_state")
    .$type<OnboardingStateValue>()
    .notNull()
    .default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
