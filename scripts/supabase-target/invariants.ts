import type { PgClient } from "../pg-client";

/**
 * Semantic invariants the migration gate must hold beyond schema presence:
 * constraint/index existence and validity, deletion semantics, the two
 * security-relevant CHECK definitions, and two data invariants. Column and
 * index SHAPE transcription is deliberately absent — presence + validity
 * catches drop/invalid drift without hand-mirroring the schema.
 */

const CANONICAL_PROJECT_WORKSPACE_CONSTRAINT = {
  definition:
    "CHECK ((((octet_length(workspace_slug) >= 38) AND (octet_length(workspace_slug) <= 64)) AND (\"right\"(workspace_slug, 37) = ('-'::text || (id)::text)) AND (\"left\"(workspace_slug, (length(workspace_slug) - 37)) ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text)))",
  name: "v2_projects_workspace_slug_canonical_check",
  tableName: "v2_projects",
} as const;

const CANONICAL_PROVIDER_KEY_CONSTRAINT = {
  definition:
    "CHECK ((provider = ANY (ARRAY['anthropic'::text, 'openai'::text, 'google'::text, 'openrouter'::text, 'deepseek'::text, 'exa'::text, 'firecrawl'::text])))",
  name: "v2_provider_keys_provider_check",
  tableName: "v2_provider_keys",
} as const;

const REQUIRED_INTEGRITY_CONSTRAINTS = [
  ["v2_users", "v2_users_clerk_updated_at_ms_check"],
  ["v2_projects", "v2_projects_id_user_id_key"],
  [CANONICAL_PROJECT_WORKSPACE_CONSTRAINT.tableName, CANONICAL_PROJECT_WORKSPACE_CONSTRAINT.name],
  ["v2_projects", "v2_projects_quota_archive_pair_check"],
  ["v2_projects", "v2_projects_settings_object_check"],
  ["v2_projects", "v2_projects_settings_default_model_check"],
  ["v2_threads", "v2_threads_id_user_id_key"],
  ["v2_threads", "v2_threads_project_launch_intent_check"],
  ["v2_threads", "v2_threads_launch_intent_object_check"],
  ["v2_threads", "v2_threads_launch_default_model_check"],
  ["v2_threads", "v2_threads_latest_model_id_check"],
  ["v2_agent_runs", "v2_agent_runs_id_user_id_key"],
  ["v2_agent_runs", "v2_agent_runs_id_user_id_thread_id_key"],
  ["v2_threads", "v2_threads_project_user_fk"],
  ["v2_messages", "v2_messages_thread_user_fk"],
  ["v2_messages", "v2_messages_agent_run_scope_fk"],
  ["v2_messages", "v2_messages_agent_run_segment_check"],
  ["v2_messages", "v2_messages_agent_run_segment_scope_check"],
  ["v2_messages", "v2_messages_parts_array_check"],
  ["v2_messages", "v2_messages_parts_size_check"],
  ["v2_messages", "v2_messages_role_check"],
  ["v2_agent_runs", "v2_agent_runs_thread_user_fk"],
  ["v2_agent_runs", "v2_agent_runs_status_check"],
  ["v2_agent_runs", "v2_agent_runs_finished_order_check"],
  ["v2_agent_runs", "v2_agent_runs_skill_runtime_capabilities_array_check"],
  ["v2_agent_runs", "v2_agent_runs_skill_runtime_capabilities_size_check"],
  ["v2_agent_runs", "v2_agent_runs_terminal_timestamp_check"],
  ["v2_threads", "v2_threads_active_run_scope_fk"],
  ["v2_generated_outputs", "v2_generated_outputs_agent_run_user_fk"],
  ["v2_generated_outputs", "v2_generated_outputs_r2_identity_check"],
  ["v2_generated_outputs", "v2_generated_outputs_r2_key_unique"],
  ["v2_generated_outputs", "v2_generated_outputs_key_check"],
  ["v2_generated_outputs", "v2_generated_outputs_filename_check"],
  ["v2_generated_outputs", "v2_generated_outputs_mime_type_check"],
  ["v2_artifact_upload_intents", "v2_artifact_upload_intents_r2_key_unique"],
  ["v2_artifact_upload_intents", "v2_artifact_upload_intents_project_user_fk"],
  ["v2_artifact_upload_intents", "v2_artifact_upload_intents_agent_run_user_fk"],
  ["v2_artifact_upload_intents", "v2_artifact_upload_intents_r2_identity_check"],
  [CANONICAL_PROVIDER_KEY_CONSTRAINT.tableName, CANONICAL_PROVIDER_KEY_CONSTRAINT.name],
  ["v2_provider_keys", "v2_provider_keys_fingerprint_check"],
  ["v2_provider_keys", "v2_provider_keys_disabled_pair_check"],
  ["v2_provider_keys", "v2_provider_keys_revalidation_lease_pair_check"],
  ["v2_deleted_clerk_identities", "v2_deleted_clerk_identities_hash_check"],
  ["v2_agent_runs", "v2_agent_runs_idempotency_key_hash_check"],
  ["v2_agent_runs", "v2_agent_runs_request_body_hash_check"],
  ["v2_agent_runs", "v2_agent_runs_model_id_canonical_check"],
  ["v2_entitlements", "v2_entitlements_period_order_check"],
  ["v2_user_integrations", "v2_user_integrations_composio_connection_id_pk"],
  ["v2_user_integrations", "v2_user_integrations_default_active_check"],
  ["v2_user_integrations", "v2_user_integrations_connection_id_check"],
  ["v2_user_integrations", "v2_user_integrations_integration_check"],
  ["v2_resource_deletion_jobs", "v2_resource_deletion_jobs_kind_check"],
  ["v2_resource_deletion_jobs", "v2_resource_deletion_jobs_phase_check"],
  ["v2_resource_deletion_jobs", "v2_resource_deletion_jobs_status_check"],
  ["v2_resource_deletion_jobs", "v2_resource_deletion_jobs_counter_check"],
  ["v2_resource_deletion_jobs", "v2_resource_deletion_jobs_lease_check"],
  ["v2_user_deletion_jobs", "v2_user_deletion_jobs_phase_check"],
  ["v2_user_deletion_jobs", "v2_user_deletion_jobs_status_check"],
  ["v2_user_deletion_jobs", "v2_user_deletion_jobs_counter_check"],
  ["v2_user_deletion_jobs", "v2_user_deletion_jobs_lease_check"],
  ["v2_user_deletion_jobs", "v2_user_deletion_jobs_id_user_generation_key"],
  ["v2_user_deletion_jobs", "v2_user_deletion_jobs_user_id_v2_users_id_fk"],
  ["v2_user_deletion_refund_intents", "v2_user_deletion_refund_intents_job_identity_fk"],
  ["v2_user_deletion_refund_intents", "v2_user_deletion_refund_intents_amount_check"],
  ["v2_user_deletion_refund_intents", "v2_user_deletion_refund_intents_currency_check"],
  ["v2_user_deletion_refund_intents", "v2_user_deletion_refund_intents_order_check"],
  ["v2_user_deletion_refund_intents", "v2_user_deletion_refund_intents_identity_check"],
  ["v2_user_deletion_refund_intents", "v2_user_deletion_refund_intents_provider_check"],
  ["v2_daily_maintenance_jobs", "v2_daily_maintenance_jobs_day_check"],
  ["v2_daily_maintenance_jobs", "v2_daily_maintenance_jobs_phase_check"],
  ["v2_daily_maintenance_jobs", "v2_daily_maintenance_jobs_status_check"],
  ["v2_daily_maintenance_jobs", "v2_daily_maintenance_jobs_counter_check"],
  ["v2_daily_maintenance_jobs", "v2_daily_maintenance_jobs_error_code_check"],
  ["v2_daily_maintenance_jobs", "v2_daily_maintenance_jobs_activation_cursor_check"],
  ["v2_daily_maintenance_jobs", "v2_daily_maintenance_jobs_phase_cursor_check"],
  ["v2_daily_maintenance_jobs", "v2_daily_maintenance_jobs_lease_check"],
  ["v2_daily_maintenance_jobs", "v2_daily_maintenance_jobs_terminal_phase_check"],
  ["v2_user_profiles", "v2_user_profiles_disabled_models_array_check"],
  ["v2_user_profiles", "v2_user_profiles_onboarding_state_object_check"],
  ["v2_user_skills", "v2_user_skills_tags_array_check"],
] as const;

const REQUIRED_INTEGRITY_INDEXES = [
  "v2_agent_runs_user_idempotency_key_unique",
  "v2_agent_runs_user_finished_idx",
  "v2_agent_runs_user_started_idx",
  "v2_agent_runs_thread_started_idx",
  "v2_agent_runs_thread_delete_page_idx",
  "v2_audit_log_action_created_idx",
  "v2_audit_log_created_brin_idx",
  "v2_audit_log_user_created_idx",
  "v2_messages_agent_run_scope_idx",
  "v2_messages_thread_page_idx",
  "v2_entitlements_polar_subscription_uidx",
  "v2_projects_user_delete_idx",
  "v2_projects_user_page_idx",
  "v2_projects_deletion_queue_idx",
  "v2_threads_project_page_idx",
  "v2_threads_project_delete_idx",
  "v2_threads_active_run_idx",
  "v2_threads_deletion_queue_idx",
  "v2_threads_user_page_idx",
  "v2_agent_runs_user_delete_page_idx",
  "v2_messages_agent_run_segment_assistant_uidx",
  "v2_messages_agent_run_final_assistant_uidx",
  "v2_generated_outputs_agent_run_idx",
  "v2_generated_outputs_user_created_idx",
  "v2_artifact_upload_intents_cleanup_idx",
  "v2_artifact_upload_intents_user_idx",
  "v2_artifact_upload_intents_project_idx",
  "v2_artifact_upload_intents_run_idx",
  "v2_provider_keys_revalidation_lease_idx",
  "v2_provider_keys_vault_secret_uidx",
  "v2_user_integrations_delete_page_idx",
  "v2_user_integrations_one_default_idx",
  "v2_user_integrations_user_toolkit_idx",
  "v2_user_skills_user_name_idx",
  "v2_users_activation_created_idx",
  "v2_users_deletion_due_idx",
  "v2_resource_deletion_jobs_generation_uidx",
  "v2_resource_deletion_jobs_user_idx",
  "v2_resource_deletion_jobs_ready_idx",
  "v2_resource_deletion_jobs_lease_idx",
  "v2_user_deletion_jobs_generation_uidx",
  "v2_user_deletion_jobs_ready_idx",
  "v2_user_deletion_jobs_lease_idx",
  "v2_user_deletion_refund_intents_idempotency_uidx",
  "v2_user_deletion_refund_intents_provider_uidx",
  "v2_user_deletion_refund_intents_unresolved_idx",
  "v2_daily_maintenance_jobs_ready_idx",
  "v2_daily_maintenance_jobs_lease_idx",
  "v2_daily_maintenance_jobs_completed_idx",
] as const;

export async function validateIntegrityConstraints(client: PgClient): Promise<string[]> {
  const result = await client.query(
    `select
       relation.relname as table_name,
       constraint_record.conname,
       pg_get_constraintdef(constraint_record.oid) as definition,
       constraint_record.confdeltype::text as delete_action
       from pg_constraint constraint_record
       join pg_class relation on relation.oid = constraint_record.conrelid
       join pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'public'
        and constraint_record.convalidated
        and constraint_record.conname = any($1::text[])`,
    [REQUIRED_INTEGRITY_CONSTRAINTS.map(([, name]) => name)],
  );
  const present = new Set(
    result.rows.map((row) => `${stringField(row, "table_name")}.${stringField(row, "conname")}`),
  );
  const issues = REQUIRED_INTEGRITY_CONSTRAINTS.filter(
    ([tableName, name]) => !present.has(`${tableName}.${name}`),
  ).map(
    ([tableName, name]) =>
      `Required integrity constraint public.${tableName}.${name} is missing or not validated.`,
  );
  const outputRunForeignKey = result.rows.find(
    (row) => row["conname"] === "v2_generated_outputs_agent_run_user_fk",
  );
  const deleteAction = outputRunForeignKey?.["delete_action"];
  if (deleteAction !== "a" && deleteAction !== "r") {
    issues.push("Generated-output/run integrity must use NO ACTION or RESTRICT deletion.");
  }
  for (const contract of [
    CANONICAL_PROJECT_WORKSPACE_CONSTRAINT,
    CANONICAL_PROVIDER_KEY_CONSTRAINT,
  ]) {
    const row = result.rows.find((candidate) => candidate["conname"] === contract.name);
    if (row && normalizedSqlDefinition(row["definition"]) !== contract.definition) {
      issues.push(`Security check public.${contract.tableName}.${contract.name} has drifted.`);
    }
  }
  return issues;
}

export async function validateIntegrityIndexes(client: PgClient): Promise<string[]> {
  const result = await client.query(
    `select
       index_relation.relname as index_name,
       index_record.indisvalid,
       index_record.indisready,
       index_record.indisunique
       from pg_index index_record
       join pg_class index_relation on index_relation.oid = index_record.indexrelid
       join pg_namespace namespace on namespace.oid = index_relation.relnamespace
      where namespace.nspname = 'public'
        and index_relation.relname = any($1::text[])`,
    [[...REQUIRED_INTEGRITY_INDEXES]],
  );
  const usable = new Map(
    result.rows
      .filter((row) => row["indisvalid"] === true && row["indisready"] === true)
      .map((row) => [stringField(row, "index_name"), row["indisunique"] === true] as const),
  );
  const issues = REQUIRED_INTEGRITY_INDEXES.filter((name) => !usable.has(name)).map(
    (name) => `Required production index public.${name} is missing, invalid, or not ready.`,
  );
  for (const name of REQUIRED_INTEGRITY_INDEXES) {
    const needsUnique = name.endsWith("_uidx") || name.endsWith("_unique");
    if (needsUnique && usable.has(name) && usable.get(name) !== true) {
      issues.push(`Required index public.${name} must be UNIQUE.`);
    }
  }
  return issues;
}

export async function validateCanonicalProjectWorkspaces(client: PgClient): Promise<string[]> {
  const result = await client.query(
    `select count(*)::text as invalid_count
       from public.v2_projects
      where not (
        octet_length(workspace_slug) between 38 and 64
        and right(workspace_slug, 37) = '-' || id::text
        and left(workspace_slug, length(workspace_slug) - 37)
          ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
      )`,
  );
  return result.rows[0]?.["invalid_count"] === "0"
    ? []
    : ["Every project workspace slug must be a safe bounded base owned by its UUID suffix."];
}

export async function validateFirstArtifactMilestone(client: PgClient): Promise<string[]> {
  const result = await client.query(
    `select
       count(*)::text as invalid_count
     from public.v2_users users
     join (
       select user_id, min(created_at) as created_at
         from public.v2_generated_outputs
        group by user_id
     ) first_output on first_output.user_id = users.id
    where users.first_artifact_at is null
       or users.first_artifact_at > first_output.created_at`,
  );
  return result.rows[0]?.["invalid_count"] === "0"
    ? []
    : ["Every user with generated outputs must retain the true first-artifact milestone."];
}

function stringField(row: Record<string, unknown>, key: string): string | undefined {
  const value = row[key];
  return typeof value === "string" ? value : undefined;
}

function normalizedSqlDefinition(value: unknown): string {
  return typeof value === "string" ? value.replaceAll(/\s+/g, " ").trim() : "";
}
