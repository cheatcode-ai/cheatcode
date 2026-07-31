import { z } from "zod";

export type ErrorCode =
  | "auth_token_missing"
  | "auth_token_invalid"
  | "auth_token_expired"
  | "payment_method_required"
  | "payment_method_failed"
  | "subscription_past_due"
  | "permission_access_denied"
  | "permission_plan_required"
  | "resource_user_not_found"
  | "resource_project_not_found"
  | "resource_thread_not_found"
  | "resource_run_not_found"
  | "resource_output_not_found"
  | "resource_tool_not_found"
  | "resource_skill_not_found"
  | "request_body_invalid"
  | "request_query_param_invalid"
  | "request_path_param_invalid"
  | "validation_model_unavailable"
  | "validation_tool_not_registered"
  | "idempotency_key_reused"
  | "validation_byok_required"
  | "conflict_request_in_flight"
  | "conflict_run_already_active"
  | "conflict_state_invalid"
  | "rate_limit_exceeded"
  | "quota_sandbox_hours_exhausted"
  | "quota_composio_calls_exhausted"
  | "byok_key_missing"
  | "byok_key_invalid"
  | "byok_key_quota_exhausted"
  | "sandbox_disk_full"
  | "sandbox_cpu_exhausted"
  | "sandbox_start_failed"
  | "sandbox_command_failed"
  | "sandbox_process_limit_reached"
  | "tool_validation_failed"
  | "tool_execution_failed"
  | "tool_execution_timeout"
  | "upstream_llm_overloaded"
  | "upstream_llm_failed"
  | "upstream_llm_timeout"
  | "upstream_sandbox_failed"
  | "upstream_sandbox_timeout"
  | "upstream_provider_outage"
  | "repo_import_failed"
  | "internal_service_error"
  | "service_maintenance_unavailable";

export const ErrorResponseSchema = z.strictObject({
  error: z.strictObject({
    code: z.string(),
    message: z.string(),
    hint: z.string().optional(),
    retriable: z.boolean(),
    request_id: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});
