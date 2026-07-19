-- Remove user-visible product-policy limits only after the matching Workers are live.

update public.v2_provider_keys
set disabled_at = null,
    disabled_reason = null
where disabled_reason = 'tier_slot_limit';

revoke update (expires_at) on table public.v2_generated_outputs from app_agent;
drop policy if exists v2_generated_outputs_update_own on public.v2_generated_outputs;

drop function if exists public.webhooks_list_expired_outputs(
  timestamp with time zone,
  timestamp with time zone,
  uuid,
  integer
);
drop function if exists public.webhooks_delete_expired_outputs(
  timestamp with time zone,
  jsonb
);

drop index if exists public.v2_generated_outputs_expiry_idx;
alter table public.v2_generated_outputs
  drop constraint if exists v2_generated_outputs_expiry_check,
  drop column if exists expires_at;

alter table public.v2_projects
  drop column if exists master_instructions;

revoke update (
  output_cursor_expires_at,
  output_cursor_id
) on table public.v2_retention_jobs from app_webhooks;

alter table public.v2_retention_jobs
  drop constraint if exists v2_retention_jobs_output_cursor_check,
  drop constraint if exists v2_retention_jobs_phase_cursor_check,
  drop column if exists output_cursor_expires_at,
  drop column if exists output_cursor_id,
  add constraint v2_retention_jobs_phase_cursor_check
  check (
    phase = 'activation'
    or (
      phase = 'cleanup'
      and activation_cursor_event is null
      and activation_cursor_user_id is null
    )
  );
