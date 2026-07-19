import { sql } from "drizzle-orm";
import { check, foreignKey, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { agentRuns } from "./messages";
import { v2TableName } from "./names";
import { projects } from "./projects";

/**
 * Cross-store intent. The row exists before R2 can be mutated and is atomically
 * replaced by the public generated-output record only after the put.
 */
export const artifactUploadIntents = pgTable(
  v2TableName("artifact_upload_intents"),
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id").notNull(),
    projectId: uuid("project_id").notNull(),
    agentRunId: uuid("agent_run_id").notNull(),
    r2Key: text("r2_key").notNull().unique("v2_artifact_upload_intents_r2_key_unique"),
    cleanupNotBefore: timestamp("cleanup_not_before", {
      precision: 3,
      withTimezone: true,
    }).notNull(),
    quiescedAt: timestamp("quiesced_at", { precision: 3, withTimezone: true }),
  },
  (table) => [
    foreignKey({
      columns: [table.projectId, table.userId],
      foreignColumns: [projects.id, projects.userId],
      name: "v2_artifact_upload_intents_project_user_fk",
    }),
    foreignKey({
      columns: [table.agentRunId, table.userId],
      foreignColumns: [agentRuns.id, agentRuns.userId],
      name: "v2_artifact_upload_intents_agent_run_user_fk",
    }),
    index("v2_artifact_upload_intents_cleanup_idx")
      .on(table.cleanupNotBefore, table.quiescedAt, table.id)
      .where(sql`${table.quiescedAt} is not null`),
    index("v2_artifact_upload_intents_user_idx").on(table.userId, table.id),
    index("v2_artifact_upload_intents_project_idx").on(table.userId, table.projectId, table.id),
    index("v2_artifact_upload_intents_run_idx").on(table.userId, table.agentRunId, table.id),
    check(
      "v2_artifact_upload_intents_r2_identity_check",
      sql`${table.r2Key} like ${table.userId}::text || '/' || ${table.projectId}::text || '/' || ${table.agentRunId}::text || '/' || ${table.id}::text || '-%'
        and strpos(substr(${table.r2Key}, length(${table.userId}::text || '/' || ${table.projectId}::text || '/' || ${table.agentRunId}::text || '/' || ${table.id}::text || '-') + 1), '/') = 0
        and octet_length(${table.r2Key}) <= 512`,
    ),
  ],
);
