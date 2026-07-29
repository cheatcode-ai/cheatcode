export const EXPECTED_PUBLIC_TABLES = [
  "v2_agent_runs",
  "v2_artifact_upload_intents",
  "v2_audit_log",
  "v2_deleted_clerk_identities",
  "v2_entitlements",
  "v2_generated_outputs",
  "v2_messages",
  "v2_projects",
  "v2_provider_keys",
  "v2_resource_deletion_jobs",
  "v2_threads",
  "v2_user_deletion_jobs",
  "v2_user_deletion_refund_intents",
  "v2_user_integrations",
  "v2_user_profiles",
  "v2_user_skills",
  "v2_users",
] as const;

export const RUNTIME_DATABASE_ROLES = ["app_gateway", "app_agent", "app_webhooks"] as const;

export const DATA_API_ROLES = ["anon", "authenticated", "service_role"] as const;

export const REQUIRED_SCHEMAS = ["extensions", "public", "vault"] as const;

export const REQUIRED_EXTENSIONS = new Map([
  ["pg_stat_statements", "extensions"],
  ["pgcrypto", "extensions"],
  ["plpgsql", "pg_catalog"],
  ["supabase_vault", "vault"],
  ["vector", "extensions"],
]);

export const REQUIRED_FUNCTIONS = [
  "claim_provider_key_revalidation_targets(integer)",
  "current_app_user()",
  "delete_all_provider_keys()",
  "delete_provider_key(text)",
  "gateway_resolve_clerk_user(text)",
  "get_provider_key(text)",
  "scrub_current_user_audit()",
  "set_provider_key(text, text)",
  "sync_clerk_user(text, text, text, text, bigint)",
  "uuidv7()",
  "v2_audit_entitlement_change()",
  "v2_audit_integration_change()",
  "v2_audit_provider_key_change()",
  "v2_delete_provider_vault_secret()",
  "v2_guard_terminal_agent_run_state()",
  "v2_guard_user_deletion_refund_resolution()",
  "v2_touch_updated_at()",
  "webhooks_claim_ready_resource_deletion_jobs(uuid, integer, integer, timestamp with time zone)",
  "webhooks_claim_ready_user_deletion_jobs(uuid, integer, integer, timestamp with time zone)",
  "webhooks_discover_resource_deletion_jobs(integer)",
  "webhooks_discover_user_deletion_jobs(timestamp with time zone, integer)",
  "webhooks_expire_composio_connection(text)",
  "webhooks_finalize_current_user_deletion(text, text)",
  "webhooks_mark_clerk_user_deleted(text, timestamp with time zone)",
  "webhooks_record_user_deletion_refund_evidence(uuid, timestamp with time zone, integer, uuid, text, text, integer, text, text, text, text)",
  "webhooks_reserve_user_deletion_refund_intent(uuid, timestamp with time zone, integer, uuid, text, text, integer, text)",
  "webhooks_resolve_polar_customer(text)",
] as const;
