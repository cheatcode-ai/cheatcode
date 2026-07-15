export interface ExpectedColumn {
  name: string;
  dataType?: string;
  nullable?: boolean;
}

export interface TableContract {
  tableName: string;
  columns: readonly ExpectedColumn[];
}

export const TABLE_CONTRACTS: readonly TableContract[] = [
  {
    tableName: "v2_users",
    columns: [
      { name: "id", dataType: "uuid" },
      { name: "clerk_id", dataType: "text" },
      { name: "email", dataType: "text" },
      { name: "display_name", dataType: "text" },
      { name: "avatar_url", dataType: "text" },
      { name: "first_artifact_at", dataType: "timestamp with time zone" },
    ],
  },
  {
    tableName: "v2_user_profiles",
    columns: [
      { name: "user_id", dataType: "uuid" },
      { name: "agent_display_name", dataType: "text" },
      { name: "global_memory", dataType: "text" },
      { name: "disabled_models", dataType: "jsonb" },
      { name: "onboarding_completed_at", dataType: "timestamp with time zone" },
      { name: "onboarding_state", dataType: "jsonb" },
    ],
  },
  {
    tableName: "v2_projects",
    columns: [
      { name: "id", dataType: "uuid" },
      { name: "user_id", dataType: "uuid" },
      { name: "name", dataType: "text" },
      { name: "mode", dataType: "text" },
      { name: "workspace_slug", dataType: "text" },
      { name: "settings", dataType: "jsonb" },
      { name: "over_quota", dataType: "boolean" },
      { name: "archived_pending_action", dataType: "boolean" },
      { name: "archive_after", dataType: "timestamp with time zone" },
    ],
  },
  {
    tableName: "v2_threads",
    columns: [
      { name: "id", dataType: "uuid" },
      { name: "project_id", dataType: "uuid" },
      { name: "user_id", dataType: "uuid" },
      { name: "launch_intent", dataType: "jsonb" },
      { name: "active_run_id", dataType: "uuid" },
    ],
  },
  {
    tableName: "v2_messages",
    columns: [
      { name: "id", dataType: "uuid" },
      { name: "thread_id", dataType: "uuid" },
      { name: "user_id", dataType: "uuid" },
      { name: "role", dataType: "text" },
      { name: "parts", dataType: "jsonb" },
      { name: "agent_run_id", dataType: "uuid" },
    ],
  },
  {
    tableName: "v2_agent_runs",
    columns: [
      { name: "id", dataType: "uuid" },
      { name: "thread_id", dataType: "uuid" },
      { name: "user_id", dataType: "uuid" },
      { name: "status", dataType: "text" },
      { name: "model_id", dataType: "text", nullable: false },
    ],
  },
  {
    tableName: "v2_provider_keys",
    columns: [
      { name: "id", dataType: "uuid" },
      { name: "user_id", dataType: "uuid" },
      { name: "provider", dataType: "text" },
      { name: "vault_secret_id", dataType: "uuid" },
      { name: "fingerprint", dataType: "text" },
      { name: "disabled_at", dataType: "timestamp with time zone" },
      { name: "disabled_reason", dataType: "text" },
    ],
  },
  {
    tableName: "v2_user_integrations",
    columns: [
      { name: "user_id", dataType: "uuid" },
      { name: "integration", dataType: "text" },
      { name: "composio_connection_id", dataType: "text" },
      { name: "is_default", dataType: "boolean" },
      { name: "status", dataType: "text" },
    ],
  },
  {
    tableName: "v2_generated_outputs",
    columns: [
      { name: "id", dataType: "uuid" },
      { name: "user_id", dataType: "uuid" },
      { name: "project_id", dataType: "uuid" },
      { name: "agent_run_id", dataType: "uuid" },
      { name: "kind", dataType: "text" },
      { name: "filename", dataType: "text" },
      { name: "r2_bucket", dataType: "text" },
      { name: "r2_key", dataType: "text" },
      { name: "mime_type", dataType: "text" },
      { name: "size_bytes", dataType: "bigint" },
      { name: "sha256", dataType: "text", nullable: false },
      { name: "expires_at", dataType: "timestamp with time zone", nullable: false },
    ],
  },
  {
    tableName: "v2_entitlements",
    columns: [
      { name: "user_id", dataType: "uuid" },
      { name: "tier", dataType: "text" },
      { name: "subscription_status", dataType: "text" },
      { name: "cancel_at_period_end", dataType: "boolean" },
      { name: "max_projects", dataType: "integer" },
      { name: "quota_sandbox_hours", dataType: "numeric" },
      { name: "quota_composio_calls", dataType: "integer" },
    ],
  },
  {
    tableName: "v2_billing_events",
    columns: [
      { name: "id", dataType: "uuid" },
      { name: "event_type", dataType: "text" },
      { name: "polar_event_id", dataType: "text" },
      { name: "payload", dataType: "jsonb" },
      { name: "processed_at", dataType: "timestamp with time zone" },
    ],
  },
  {
    tableName: "v2_user_skills",
    columns: [
      { name: "id", dataType: "uuid" },
      { name: "user_id", dataType: "uuid" },
      { name: "name", dataType: "text" },
      { name: "description", dataType: "text" },
      { name: "category", dataType: "text" },
      { name: "tags", dataType: "jsonb" },
      { name: "body", dataType: "text" },
      { name: "deleted_at", dataType: "timestamp with time zone" },
    ],
  },
  {
    tableName: "v2_deleted_clerk_identities",
    columns: [
      { name: "clerk_identity_hash", dataType: "text", nullable: false },
      { name: "deleted_at", dataType: "timestamp with time zone", nullable: false },
    ],
  },
  {
    tableName: "v2_audit_log",
    columns: [
      { name: "id", dataType: "uuid" },
      { name: "user_id", dataType: "uuid" },
      { name: "action", dataType: "text" },
      { name: "metadata", dataType: "jsonb" },
      { name: "created_at", dataType: "timestamp with time zone" },
    ],
  },
] as const;
