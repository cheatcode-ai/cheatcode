import { sql } from "drizzle-orm";
import { boolean, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { v2TableName } from "./names";
import { users } from "./users";

export interface ProjectSettings {
  defaultModel?: string;
  budgetCapUsd?: number;
  /** Public GitHub URL captured at project creation; consumed once by the app-builder scaffold. */
  importRepoUrl?: string;
}

export interface DirectoryBackupHandle {
  id: string;
  dir: string;
}

export const projects = pgTable(v2TableName("projects"), {
  id: uuid("id").primaryKey().default(sql`public.uuidv7()`),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  mode: text("mode").notNull(),
  masterInstructions: text("master_instructions"),
  sandboxId: text("sandbox_id"),
  containerBackup: jsonb("container_backup").$type<DirectoryBackupHandle | null>(),
  settings: jsonb("settings").$type<ProjectSettings>().notNull().default(sql`'{}'::jsonb`),
  overQuota: boolean("over_quota").notNull().default(false),
  archivedPendingAction: boolean("archived_pending_action").notNull().default(false),
  archiveAfter: timestamp("archive_after", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const threads = pgTable(v2TableName("threads"), {
  id: uuid("id").primaryKey().default(sql`public.uuidv7()`),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: text("title"),
  activeRunId: uuid("active_run_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});
