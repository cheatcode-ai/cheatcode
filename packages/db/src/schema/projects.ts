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
  unique,
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
 * when its first workspace-backed tool lazily materializes the project (chat-first model). The same
 * transaction moves the intent into the project and clears this one-shot field.
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
    // never moves its folder. Its canonical UUID suffix makes it globally unique without a second
    // user-scoped index. Always set because every project owns a workspace folder.
    workspaceSlug: text("workspace_slug").notNull(),
    settings: jsonb("settings").$type<ProjectSettings>().notNull().default(sql`'{}'::jsonb`),
    overQuota: boolean("over_quota").notNull().default(false),
    archiveAfter: timestamp("archive_after", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { precision: 3, withTimezone: true }),
  },
  (table) => [
    unique("v2_projects_id_user_id_key").on(table.id, table.userId),
    check(
      "v2_projects_mode_check",
      sql`${table.mode} in ('app-builder', 'app-builder-mobile', 'general')`,
    ),
    check(
      "v2_projects_workspace_slug_canonical_check",
      sql`octet_length(${table.workspaceSlug}) between 38 and 64
        and right(${table.workspaceSlug}, 37) = '-' || ${table.id}::text
        and left(${table.workspaceSlug}, length(${table.workspaceSlug}) - 37)
          ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`,
    ),
    check(
      "v2_projects_quota_archive_pair_check",
      sql`${table.overQuota} = (${table.archiveAfter} is not null)`,
    ),
    check("v2_projects_settings_object_check", sql`jsonb_typeof(${table.settings}) = 'object'`),
    check(
      "v2_projects_settings_default_model_check",
      sql`not (${table.settings} ? 'defaultModel') or (
        jsonb_typeof(${table.settings} -> 'defaultModel') = 'string'
        and char_length(${table.settings} ->> 'defaultModel') <= 200
        and ${table.settings} ->> 'defaultModel'
          ~ '^(anthropic|deepseek|google|openai|openrouter)/[^[:space:]]+$'
      )`,
    ),
    index("v2_projects_user_page_idx")
      .on(table.userId, table.updatedAt.desc(), table.id.desc())
      .where(sql`deleted_at is null`),
    // The live-page index is partial, so PostgreSQL cannot use it while
    // cascading a physical user deletion across already archived projects.
    index("v2_projects_user_delete_idx").on(table.userId, table.id),
    index("v2_projects_deletion_queue_idx")
      .on(table.deletedAt, table.id)
      .where(sql`deleted_at is not null`),
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
    // Denormalized from the newest run so the gateway can render the resolved model
    // without widening its least-privilege access to agent-run rows.
    latestModelId: text("latest_model_id").$type<LogicalModelId | null>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { precision: 3, withTimezone: true }),
  },
  (table) => [
    // Serves the chat-first sidebar's per-user recent-threads listing (newest first).
    index("v2_threads_user_page_idx")
      .on(table.userId, table.updatedAt.desc(), table.id.desc())
      .where(sql`deleted_at is null`),
    index("v2_threads_project_page_idx")
      .on(table.userId, table.projectId, table.updatedAt.desc(), table.id.desc())
      .where(sql`deleted_at is null`),
    index("v2_threads_project_delete_idx").on(table.userId, table.projectId, table.id),
    index("v2_threads_active_run_idx")
      .on(table.activeRunId)
      .where(sql`${table.activeRunId} is not null`),
    index("v2_threads_deletion_queue_idx")
      .on(table.deletedAt, table.id)
      .where(sql`deleted_at is not null`),
    check(
      "v2_threads_project_launch_intent_check",
      sql`${table.projectId} is null or ${table.launchIntent} is null`,
    ),
    check(
      "v2_threads_launch_intent_object_check",
      sql`${table.launchIntent} is null or jsonb_typeof(${table.launchIntent}) = 'object'`,
    ),
    check(
      "v2_threads_launch_default_model_check",
      sql`${table.launchIntent} is null or not (${table.launchIntent} ? 'defaultModel') or (
        jsonb_typeof(${table.launchIntent} -> 'defaultModel') = 'string'
        and char_length(${table.launchIntent} ->> 'defaultModel') <= 200
        and ${table.launchIntent} ->> 'defaultModel'
          ~ '^(anthropic|deepseek|google|openai|openrouter)/[^[:space:]]+$'
      )`,
    ),
    check(
      "v2_threads_latest_model_id_check",
      sql`${table.latestModelId} is null or (
        char_length(${table.latestModelId}) <= 200
        and ${table.latestModelId}
          ~ '^(anthropic|deepseek|google|openai|openrouter)/[^[:space:]]+$'
      )`,
    ),
  ],
);
