import { sql } from "drizzle-orm";
import { boolean, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { v2TableName } from "./names";
import { users } from "./users";

export interface ProjectSettings {
  defaultModel?: string;
  budgetCapUsd?: number;
  /** Public GitHub URL captured at project creation; consumed once by the app-builder scaffold. */
  importRepoUrl?: string;
}

/**
 * Build intent captured on a (project-less) chat at creation, consumed exactly once
 * when its first run lazily materializes the project (chat-first model). After that
 * the project owns these via its `mode`/`settings`; the thread copy is vestigial.
 */
export interface ThreadLaunchIntent {
  initialPrompt?: string;
  mode?: string;
  importRepoUrl?: string;
  defaultModel?: string;
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

export const threads = pgTable(
  v2TableName("threads"),
  {
    id: uuid("id").primaryKey().default(sql`public.uuidv7()`),
    // Nullable (chat-first): a chat exists with no project until its first run lazily
    // creates one. The FK already tolerates null; cascade-on-project-delete unchanged.
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title"),
    // Build intent for the lazy first-run project materialization (project-less chats).
    launchIntent: jsonb("launch_intent").$type<ThreadLaunchIntent | null>(),
    activeRunId: uuid("active_run_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    // Serves the chat-first sidebar's per-user recent-threads listing (newest first).
    index("v2_threads_user_recent_idx")
      .on(table.userId, table.updatedAt.desc())
      .where(sql`deleted_at is null`),
  ],
);
