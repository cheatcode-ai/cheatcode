import type { LogicalModelId, ProjectMode } from "@cheatcode/types";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { v2TableName } from "./names";
import { users } from "./users";

export interface ProjectSettings {
  defaultModel?: LogicalModelId;
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
  mode?: ProjectMode;
  importRepoUrl?: string;
  defaultModel?: LogicalModelId;
}

export const projects = pgTable(
  v2TableName("projects"),
  {
    id: uuid("id").primaryKey().default(sql`public.uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    mode: text("mode").$type<ProjectMode>().notNull(),
    // Immutable, filesystem-safe folder name under /workspace in the user's per-user "computer"
    // sandbox (/workspace/<workspaceSlug>). Decoupled from the display `name` so a project rename
    // never moves its folder. Unique per user. Always set (every project owns a workspace folder).
    workspaceSlug: text("workspace_slug").notNull(),
    masterInstructions: text("master_instructions"),
    settings: jsonb("settings").$type<ProjectSettings>().notNull().default(sql`'{}'::jsonb`),
    overQuota: boolean("over_quota").notNull().default(false),
    archivedPendingAction: boolean("archived_pending_action").notNull().default(false),
    archiveAfter: timestamp("archive_after", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    workspaceCleanupRequestedAt: timestamp("workspace_cleanup_requested_at", {
      withTimezone: true,
    }),
    workspaceCleanupCompletedAt: timestamp("workspace_cleanup_completed_at", {
      withTimezone: true,
    }),
  },
  (table) => [
    check(
      "v2_projects_mode_check",
      sql`${table.mode} in ('app-builder', 'app-builder-mobile', 'general')`,
    ),
    // Enforces the "workspace_slug unique per user" invariant that /workspace/<slug> folder,
    // dev-server slot, and port allocation all key on.
    uniqueIndex("v2_projects_user_workspace_slug_uidx").on(table.userId, table.workspaceSlug),
    index("v2_projects_user_page_idx")
      .on(table.userId, table.updatedAt.desc(), table.id.desc())
      .where(sql`deleted_at is null`),
  ],
);

export const threads = pgTable(
  v2TableName("threads"),
  {
    id: uuid("id").primaryKey().default(sql`public.uuidv7()`),
    // Nullable (chat-first): a chat exists with no project until its first run lazily
    // creates one. The FK already tolerates null; cascade-on-project-delete unchanged.
    projectId: uuid("project_id"),
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
    index("v2_threads_user_page_idx")
      .on(table.userId, table.updatedAt.desc(), table.id.desc())
      .where(sql`deleted_at is null`),
    index("v2_threads_project_page_idx")
      .on(table.userId, table.projectId, table.updatedAt.desc(), table.id.desc())
      .where(sql`deleted_at is null`),
  ],
);
