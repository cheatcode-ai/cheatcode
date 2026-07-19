import { sql } from "drizzle-orm";
import { check, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { v2TableName } from "./names";
import { users } from "./users";

/**
 * User-created ("custom") skills. Mirrors the bundled SKILL.md shape (name +
 * description + body) but stored per-user in the DB so Workers (no filesystem)
 * can load them at run time and merge them with the build-time bundled catalog.
 * `body` is the full markdown procedure the agent loads via `skill_invoke`.
 */
export const userSkills = pgTable(
  v2TableName("user_skills"),
  {
    id: uuid("id").primaryKey().default(sql`public.uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull(),
    category: text("category").notNull(),
    tags: jsonb("tags").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("v2_user_skills_user_name_idx").on(table.userId, table.name),
    check("v2_user_skills_tags_array_check", sql`jsonb_typeof(${table.tags}) = 'array'`),
  ],
);
