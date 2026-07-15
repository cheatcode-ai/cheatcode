-- The pre-deploy overlay rejects invalid historical rows, installs checks for new
-- writes, and creates the privileged audit API. Tighten the remaining physical
-- and privilege contracts only after matching Workers have been verified.
alter table public.v2_generated_outputs
  alter column sha256 set not null,
  alter column expires_at set not null;

alter table public.v2_threads
  drop constraint v2_threads_project_id_v2_projects_id_fk;
alter table public.v2_messages
  drop constraint v2_messages_thread_id_v2_threads_id_fk;
alter table public.v2_agent_runs
  drop constraint v2_agent_runs_thread_id_v2_threads_id_fk;
alter table public.v2_generated_outputs
  drop constraint v2_generated_outputs_project_id_v2_projects_id_fk,
  drop constraint v2_generated_outputs_agent_run_id_v2_agent_runs_id_fk;

alter table public.v2_provider_keys enable row level security;
alter table public.v2_provider_keys force row level security;
alter table public.v2_audit_log enable row level security;
alter table public.v2_audit_log force row level security;

drop policy if exists v2_audit_log_insert_system on public.v2_audit_log;
revoke insert, update, delete, truncate on public.v2_audit_log from public, app_worker;
grant select on public.v2_audit_log to app_worker;
