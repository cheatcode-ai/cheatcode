import { z } from "zod";

export type ErrorCode =
  | "auth_token_missing"
  | "auth_token_invalid"
  | "auth_token_expired"
  | "payment_required"
  | "payment_method_failed"
  | "subscription_past_due"
  | "permission_denied"
  | "permission_plan_required"
  | "not_found_user"
  | "not_found_project"
  | "not_found_thread"
  | "not_found_run"
  | "not_found_output"
  | "not_found_tool"
  | "not_found_skill"
  | "invalid_request_body"
  | "invalid_query_param"
  | "invalid_path_param"
  | "validation_model_unavailable"
  | "validation_tool_not_registered"
  | "idempotency_key_reused"
  | "validation_byok_required"
  | "conflict_in_flight"
  | "conflict_run_already_active"
  | "conflict_state_invalid"
  | "rate_limit_exceeded"
  | "quota_exhausted_sandbox_hours"
  | "quota_exhausted_composio_calls"
  | "byok_key_missing"
  | "byok_key_invalid"
  | "byok_key_quota_exhausted"
  | "sandbox_disk_full"
  | "sandbox_cpu_exhausted"
  | "sandbox_failed_to_start"
  | "sandbox_command_failed"
  | "sandbox_process_limit_reached"
  | "tool_validation_failed"
  | "tool_execution_failed"
  | "tool_timeout"
  | "upstream_llm_overloaded"
  | "upstream_llm_failed"
  | "upstream_timeout_llm"
  | "upstream_sandbox_failed"
  | "upstream_timeout_sandbox"
  | "upstream_provider_outage"
  | "repo_import_failed"
  | "internal_error"
  | "unavailable_maintenance";

export const ErrorResponseSchema = z
  .object({
    error: z
      .object({
        code: z.string(),
        message: z.string(),
        hint: z.string().optional(),
        retriable: z.boolean(),
        request_id: z.string(),
        doc_url: z.string().url(),
        details: z.record(z.string(), z.unknown()).optional(),
      })
      .strict(),
  })
  .strict();
