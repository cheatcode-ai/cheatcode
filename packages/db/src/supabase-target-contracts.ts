export interface ExpectedColumn {
  datetimePrecision?: number;
  name: string;
  dataType: string;
  nullable: boolean;
}

export interface TableContract {
  tableName: string;
  columns: readonly ExpectedColumn[];
}

export {
  FUNCTION_CONTRACTS,
  functionIdentity,
} from "./supabase-target-function-contracts";

export const RUNTIME_DATABASE_ROLES = ["app_gateway", "app_agent", "app_webhooks"] as const;

export type RuntimeDatabaseRole = (typeof RUNTIME_DATABASE_ROLES)[number];

export const CANONICAL_PROJECT_WORKSPACE_CONSTRAINT = {
  definition:
    "CHECK ((((octet_length(workspace_slug) >= 38) AND (octet_length(workspace_slug) <= 64)) AND (\"right\"(workspace_slug, 37) = ('-'::text || (id)::text)) AND (\"left\"(workspace_slug, (length(workspace_slug) - 37)) ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text)))",
  name: "v2_projects_workspace_slug_canonical_check",
  tableName: "v2_projects",
} as const;

export const CANONICAL_PROVIDER_KEY_CONSTRAINT = {
  definition:
    "CHECK ((provider = ANY (ARRAY['anthropic'::text, 'openai'::text, 'google'::text, 'openrouter'::text, 'deepseek'::text, 'exa'::text, 'firecrawl'::text])))",
  name: "v2_provider_keys_provider_check",
  tableName: "v2_provider_keys",
} as const;

const column = (
  name: string,
  dataType: string,
  nullable = false,
  datetimePrecision?: number,
): ExpectedColumn => ({
  dataType,
  ...(datetimePrecision === undefined ? {} : { datetimePrecision }),
  name,
  nullable,
});

export const TABLE_CONTRACTS: readonly TableContract[] = [
  {
    tableName: "_audit_archive_manifest",
    columns: [
      column("partition_name", "text"),
      column("month_start", "date"),
      column("bucket", "text"),
      column("format_version", "integer"),
      column("object_key", "text", true),
      column("row_count", "bigint", true),
      column("size_bytes", "bigint", true),
      column("sha256", "text", true),
      column("state", "text"),
      column("detached_at", "timestamp with time zone", false, 6),
      column("verified_at", "timestamp with time zone", true, 6),
      column("dropped_at", "timestamp with time zone", true, 6),
    ],
  },
  {
    tableName: "_raw_migrations",
    columns: [
      column("filename", "text"),
      column("sha256", "text"),
      column("applied_at", "timestamp with time zone", false, 6),
    ],
  },
  {
    tableName: "v2_users",
    columns: [
      column("id", "uuid"),
      column("clerk_id", "text"),
      column("clerk_updated_at_ms", "bigint"),
      column("email", "text"),
      column("display_name", "text", true),
      column("avatar_url", "text", true),
      column("polar_customer_id", "text", true),
      column("first_artifact_at", "timestamp with time zone", true, 6),
      column("created_at", "timestamp with time zone", false, 6),
      column("deleted_at", "timestamp with time zone", true, 6),
      column("deletion_fence", "text", true),
    ],
  },
  {
    tableName: "v2_user_profiles",
    columns: [
      column("user_id", "uuid"),
      column("agent_display_name", "text", true),
      column("global_memory", "text", true),
      column("disabled_models", "jsonb"),
      column("onboarding_completed_at", "timestamp with time zone", true, 6),
      column("onboarding_state", "jsonb"),
      column("updated_at", "timestamp with time zone", false, 6),
    ],
  },
  {
    tableName: "v2_projects",
    columns: [
      column("id", "uuid"),
      column("user_id", "uuid"),
      column("name", "text"),
      column("mode", "text"),
      column("workspace_slug", "text"),
      column("settings", "jsonb"),
      column("over_quota", "boolean"),
      column("archive_after", "timestamp with time zone", true, 6),
      column("created_at", "timestamp with time zone", false, 6),
      column("updated_at", "timestamp with time zone", false, 6),
      column("deleted_at", "timestamp with time zone", true, 3),
    ],
  },
  {
    tableName: "v2_threads",
    columns: [
      column("id", "uuid"),
      column("project_id", "uuid", true),
      column("user_id", "uuid"),
      column("title", "text", true),
      column("launch_intent", "jsonb", true),
      column("active_run_id", "uuid", true),
      column("latest_model_id", "text", true),
      column("created_at", "timestamp with time zone", false, 6),
      column("updated_at", "timestamp with time zone", false, 6),
      column("deleted_at", "timestamp with time zone", true, 3),
    ],
  },
  {
    tableName: "v2_messages",
    columns: [
      column("id", "uuid"),
      column("thread_id", "uuid"),
      column("user_id", "uuid"),
      column("role", "text"),
      column("parts", "jsonb"),
      column("agent_run_id", "uuid", true),
      column("agent_run_segment", "integer"),
      column("agent_run_segment_final", "boolean"),
      column("created_at", "timestamp with time zone", false, 6),
    ],
  },
  {
    tableName: "v2_agent_runs",
    columns: [
      column("id", "uuid"),
      column("thread_id", "uuid"),
      column("user_id", "uuid"),
      column("status", "text"),
      column("model_id", "text"),
      column("idempotency_key_hash", "text", true),
      column("request_body_hash", "text", true),
      column("started_at", "timestamp with time zone", false, 6),
      column("finished_at", "timestamp with time zone", true, 6),
    ],
  },
  {
    tableName: "v2_provider_keys",
    columns: [
      column("user_id", "uuid"),
      column("provider", "text"),
      column("vault_secret_id", "uuid"),
      column("fingerprint", "text"),
      column("last_revalidated_at", "timestamp with time zone", true, 6),
      column("revalidation_claimed_at", "timestamp with time zone", true, 6),
      column("revalidation_lease_token", "uuid", true),
      column("disabled_at", "timestamp with time zone", true, 6),
      column("disabled_reason", "text", true),
      column("created_at", "timestamp with time zone", false, 6),
    ],
  },
  {
    tableName: "v2_user_integrations",
    columns: [
      column("user_id", "uuid"),
      column("integration", "text"),
      column("composio_connection_id", "text"),
      column("is_default", "boolean"),
      column("status", "text"),
      column("connected_at", "timestamp with time zone", false, 6),
      column("updated_at", "timestamp with time zone", false, 6),
    ],
  },
  {
    tableName: "v2_generated_outputs",
    columns: [
      column("id", "uuid"),
      column("user_id", "uuid"),
      column("agent_run_id", "uuid"),
      column("filename", "text"),
      column("r2_key", "text"),
      column("mime_type", "text"),
      column("created_at", "timestamp with time zone", false, 6),
    ],
  },
  {
    tableName: "v2_artifact_upload_intents",
    columns: [
      column("id", "uuid"),
      column("user_id", "uuid"),
      column("project_id", "uuid"),
      column("agent_run_id", "uuid"),
      column("r2_key", "text"),
      column("cleanup_not_before", "timestamp with time zone", false, 3),
      column("quiesced_at", "timestamp with time zone", true, 3),
    ],
  },
  {
    tableName: "v2_resource_deletion_jobs",
    columns: [
      column("id", "uuid"),
      column("user_id", "uuid"),
      column("kind", "text"),
      column("resource_id", "uuid"),
      column("generation", "timestamp with time zone", false, 3),
      column("phase", "text"),
      column("cursor", "uuid", true),
      column("continuation", "integer"),
      column("status", "text"),
      column("lease_token", "uuid", true),
      column("lease_expires_at", "timestamp with time zone", true, 3),
      column("failure_count", "integer"),
      column("next_attempt_at", "timestamp with time zone", false, 3),
      column("last_error_code", "text", true),
    ],
  },
  {
    tableName: "v2_user_deletion_jobs",
    columns: [
      column("id", "uuid"),
      column("user_id", "uuid"),
      column("generation", "timestamp with time zone", false, 6),
      column("phase", "text"),
      column("cursor", "text", true),
      column("continuation", "integer"),
      column("status", "text"),
      column("lease_token", "uuid", true),
      column("lease_expires_at", "timestamp with time zone", true, 3),
      column("failure_count", "integer"),
      column("next_attempt_at", "timestamp with time zone", false, 3),
      column("last_error_code", "text", true),
    ],
  },
  {
    tableName: "v2_user_deletion_refund_intents",
    columns: [
      column("job_id", "uuid"),
      column("user_id", "uuid"),
      column("generation", "timestamp with time zone", false, 6),
      column("order_id", "text"),
      column("amount", "integer"),
      column("currency", "text"),
      column("idempotency_key", "text"),
      column("provider_refund_id", "text", true),
      column("provider_status", "text", true),
      column("created_at", "timestamp with time zone", false, 3),
      column("reconciled_at", "timestamp with time zone", true, 3),
    ],
  },
  {
    tableName: "v2_daily_maintenance_jobs",
    columns: [
      column("day", "date"),
      column("scheduled_at", "timestamp with time zone", false, 3),
      column("phase", "text"),
      column("activation_cursor_event", "text", true),
      column("activation_cursor_user_id", "uuid", true),
      column("continuation", "integer"),
      column("status", "text"),
      column("release_version_id", "uuid", true),
      column("lease_token", "uuid", true),
      column("lease_expires_at", "timestamp with time zone", true, 3),
      column("failure_count", "integer"),
      column("next_attempt_at", "timestamp with time zone", false, 3),
      column("last_error_code", "text", true),
      column("completed_at", "timestamp with time zone", true, 3),
    ],
  },
  {
    tableName: "v2_entitlements",
    columns: [
      column("user_id", "uuid"),
      column("tier", "text"),
      column("polar_subscription_id", "text", true),
      column("subscription_status", "text"),
      column("cancel_at_period_end", "boolean"),
      column("current_period_start", "timestamp with time zone", true, 6),
      column("current_period_end", "timestamp with time zone", true, 6),
      column("updated_at", "timestamp with time zone", false, 6),
    ],
  },
  {
    tableName: "v2_user_skills",
    columns: [
      column("id", "uuid"),
      column("user_id", "uuid"),
      column("name", "text"),
      column("description", "text"),
      column("category", "text"),
      column("tags", "jsonb"),
      column("body", "text"),
      column("created_at", "timestamp with time zone", false, 6),
      column("updated_at", "timestamp with time zone", false, 6),
    ],
  },
  {
    tableName: "v2_deleted_clerk_identities",
    columns: [column("clerk_identity_hash", "text")],
  },
  {
    tableName: "v2_audit_log",
    columns: [
      column("id", "uuid"),
      column("user_id", "uuid", true),
      column("action", "text"),
      column("resource_type", "text", true),
      column("resource_id", "text", true),
      column("metadata", "jsonb"),
      column("created_at", "timestamp with time zone", false, 6),
    ],
  },
] as const;

export const EXPECTED_PUBLIC_TABLES = new Set(TABLE_CONTRACTS.map(({ tableName }) => tableName));

export const EXPECTED_EXTENSIONS = new Set([
  "pg_cron",
  "pg_stat_statements",
  "pgcrypto",
  "plpgsql",
  "supabase_vault",
  "vector",
]);

export const REQUIRED_INTEGRITY_CONSTRAINTS = [
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

export const REQUIRED_INTEGRITY_INDEXES = [
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

export const FORBIDDEN_SUPERSEDED_INDEXES = [
  "v2_messages_thread_created_idx",
  "v2_messages_user_created_idx",
  "v2_projects_user_created_idx",
  "v2_threads_project_created_idx",
  "v2_threads_user_project_created_idx",
  "v2_threads_user_recent_idx",
  "v2_user_skills_user_idx",
  "v2_messages_agent_run_assistant_uidx",
  "v2_provider_keys_revalidation_idx",
  "v2_projects_user_workspace_slug_uidx",
] as const;

export interface ExactIntegrityConstraint {
  definition: string;
  deleteAction?: "a" | "c" | "n" | "r";
  name: string;
  tableName: string;
}

export const EXACT_INTEGRITY_CONSTRAINTS: readonly ExactIntegrityConstraint[] = [
  {
    definition:
      "CHECK (((clerk_updated_at_ms >= 0) AND (clerk_updated_at_ms <= '9007199254740991'::bigint)))",
    name: "v2_users_clerk_updated_at_ms_check",
    tableName: "v2_users",
  },
  {
    definition: "FOREIGN KEY (user_id) REFERENCES v2_users(id) ON DELETE CASCADE",
    deleteAction: "c",
    name: "v2_user_deletion_jobs_user_id_v2_users_id_fk",
    tableName: "v2_user_deletion_jobs",
  },
  {
    definition:
      "FOREIGN KEY (job_id, user_id, generation) REFERENCES v2_user_deletion_jobs(id, user_id, generation) ON DELETE CASCADE",
    deleteAction: "c",
    name: "v2_user_deletion_refund_intents_job_identity_fk",
    tableName: "v2_user_deletion_refund_intents",
  },
  {
    definition:
      "FOREIGN KEY (agent_run_id, user_id, thread_id) REFERENCES v2_agent_runs(id, user_id, thread_id) ON DELETE RESTRICT",
    deleteAction: "r",
    name: "v2_messages_agent_run_scope_fk",
    tableName: "v2_messages",
  },
  {
    definition: "FOREIGN KEY (project_id, user_id) REFERENCES v2_projects(id, user_id)",
    deleteAction: "a",
    name: "v2_artifact_upload_intents_project_user_fk",
    tableName: "v2_artifact_upload_intents",
  },
  {
    definition: "FOREIGN KEY (agent_run_id, user_id) REFERENCES v2_agent_runs(id, user_id)",
    deleteAction: "a",
    name: "v2_artifact_upload_intents_agent_run_user_fk",
    tableName: "v2_artifact_upload_intents",
  },
  {
    definition: "CHECK (((finished_at IS NULL) OR (finished_at >= started_at)))",
    name: "v2_agent_runs_finished_order_check",
    tableName: "v2_agent_runs",
  },
  {
    definition:
      "CHECK ((status = ANY (ARRAY['pending'::text, 'running'::text, 'completed'::text, 'failed'::text, 'canceled'::text])))",
    name: "v2_agent_runs_status_check",
    tableName: "v2_agent_runs",
  },
  {
    definition:
      "CHECK (((status = ANY (ARRAY['completed'::text, 'failed'::text, 'canceled'::text])) = (finished_at IS NOT NULL)))",
    name: "v2_agent_runs_terminal_timestamp_check",
    tableName: "v2_agent_runs",
  },
  {
    definition:
      "CHECK (((current_period_start IS NULL) OR (current_period_end IS NULL) OR (current_period_start <= current_period_end)))",
    name: "v2_entitlements_period_order_check",
    tableName: "v2_entitlements",
  },
  {
    definition:
      "CHECK (((r2_key = (((((((((user_id)::text || '/'::text) || split_part(r2_key, '/'::text, 2)) || '/'::text) || (agent_run_id)::text) || '/'::text) || (id)::text) || '-'::text) || filename)) AND (split_part(r2_key, '/'::text, 2) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'::text) AND (strpos(filename, '/'::text) = 0)))",
    name: "v2_generated_outputs_r2_identity_check",
    tableName: "v2_generated_outputs",
  },
  {
    definition: "CHECK ((jsonb_typeof(parts) = 'array'::text))",
    name: "v2_messages_parts_array_check",
    tableName: "v2_messages",
  },
  {
    definition: "CHECK ((over_quota = (archive_after IS NOT NULL)))",
    name: "v2_projects_quota_archive_pair_check",
    tableName: "v2_projects",
  },
  {
    definition:
      "CHECK (((NOT (settings ? 'defaultModel'::text)) OR ((jsonb_typeof((settings -> 'defaultModel'::text)) = 'string'::text) AND (char_length((settings ->> 'defaultModel'::text)) <= 200) AND ((settings ->> 'defaultModel'::text) ~ '^(anthropic|deepseek|google|openai|openrouter)/[^[:space:]]+$'::text))))",
    name: "v2_projects_settings_default_model_check",
    tableName: "v2_projects",
  },
  {
    definition: "CHECK ((jsonb_typeof(settings) = 'object'::text))",
    name: "v2_projects_settings_object_check",
    tableName: "v2_projects",
  },
  {
    definition:
      "CHECK ((((disabled_at IS NULL) AND (disabled_reason IS NULL)) OR ((disabled_at IS NOT NULL) AND (disabled_reason IS NOT NULL))))",
    name: "v2_provider_keys_disabled_pair_check",
    tableName: "v2_provider_keys",
  },
  {
    definition: "CHECK ((fingerprint ~ '^[0-9a-f]{12}$'::text))",
    name: "v2_provider_keys_fingerprint_check",
    tableName: "v2_provider_keys",
  },
  {
    definition:
      "CHECK (((launch_intent IS NULL) OR (NOT (launch_intent ? 'defaultModel'::text)) OR ((jsonb_typeof((launch_intent -> 'defaultModel'::text)) = 'string'::text) AND (char_length((launch_intent ->> 'defaultModel'::text)) <= 200) AND ((launch_intent ->> 'defaultModel'::text) ~ '^(anthropic|deepseek|google|openai|openrouter)/[^[:space:]]+$'::text))))",
    name: "v2_threads_launch_default_model_check",
    tableName: "v2_threads",
  },
  {
    definition:
      "CHECK (((latest_model_id IS NULL) OR ((char_length(latest_model_id) <= 200) AND (latest_model_id ~ '^(anthropic|deepseek|google|openai|openrouter)/[^[:space:]]+$'::text))))",
    name: "v2_threads_latest_model_id_check",
    tableName: "v2_threads",
  },
  {
    definition:
      "CHECK (((launch_intent IS NULL) OR (jsonb_typeof(launch_intent) = 'object'::text)))",
    name: "v2_threads_launch_intent_object_check",
    tableName: "v2_threads",
  },
  {
    definition: "CHECK (((project_id IS NULL) OR (launch_intent IS NULL)))",
    name: "v2_threads_project_launch_intent_check",
    tableName: "v2_threads",
  },
  {
    definition: "CHECK ((jsonb_typeof(disabled_models) = 'array'::text))",
    name: "v2_user_profiles_disabled_models_array_check",
    tableName: "v2_user_profiles",
  },
  {
    definition: "CHECK ((jsonb_typeof(onboarding_state) = 'object'::text))",
    name: "v2_user_profiles_onboarding_state_object_check",
    tableName: "v2_user_profiles",
  },
  {
    definition: "CHECK ((jsonb_typeof(tags) = 'array'::text))",
    name: "v2_user_skills_tags_array_check",
    tableName: "v2_user_skills",
  },
] as const;
