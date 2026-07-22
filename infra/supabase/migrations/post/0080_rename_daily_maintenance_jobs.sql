-- Rename the durable daily job aggregate without replacing the table or losing queued work.

do $$
begin
  if exists (
    select 1
    from public.v2_retention_jobs
    where status = 'leased'
  ) then
    raise exception 'daily maintenance migration requires every active lease to drain first';
  end if;
end;
$$;

alter table public.v2_retention_jobs
  rename to v2_daily_maintenance_jobs;

alter table public.v2_daily_maintenance_jobs
  drop constraint v2_retention_jobs_phase_check,
  drop constraint v2_retention_jobs_phase_cursor_check,
  drop constraint v2_retention_jobs_terminal_phase_check;

update public.v2_daily_maintenance_jobs
set phase = 'orphan-upload-cleanup'
where phase = 'cleanup';

alter table public.v2_daily_maintenance_jobs
  rename constraint v2_retention_jobs_pkey to v2_daily_maintenance_jobs_pkey;
alter table public.v2_daily_maintenance_jobs
  rename constraint v2_retention_jobs_day_check to v2_daily_maintenance_jobs_day_check;
alter table public.v2_daily_maintenance_jobs
  rename constraint v2_retention_jobs_status_check to v2_daily_maintenance_jobs_status_check;
alter table public.v2_daily_maintenance_jobs
  rename constraint v2_retention_jobs_counter_check to v2_daily_maintenance_jobs_counter_check;
alter table public.v2_daily_maintenance_jobs
  rename constraint v2_retention_jobs_error_code_check to v2_daily_maintenance_jobs_error_code_check;
alter table public.v2_daily_maintenance_jobs
  rename constraint v2_retention_jobs_activation_cursor_check
  to v2_daily_maintenance_jobs_activation_cursor_check;
alter table public.v2_daily_maintenance_jobs
  rename constraint v2_retention_jobs_lease_check to v2_daily_maintenance_jobs_lease_check;

alter index public.v2_retention_jobs_ready_idx
  rename to v2_daily_maintenance_jobs_ready_idx;
alter index public.v2_retention_jobs_lease_idx
  rename to v2_daily_maintenance_jobs_lease_idx;
alter index public.v2_retention_jobs_completed_idx
  rename to v2_daily_maintenance_jobs_completed_idx;

alter table public.v2_daily_maintenance_jobs
  add constraint v2_daily_maintenance_jobs_phase_check
  check (phase in ('activation', 'orphan-upload-cleanup')),
  add constraint v2_daily_maintenance_jobs_phase_cursor_check
  check (
    phase = 'activation'
    or (
      phase = 'orphan-upload-cleanup'
      and activation_cursor_event is null
      and activation_cursor_user_id is null
    )
  ),
  add constraint v2_daily_maintenance_jobs_terminal_phase_check
  check (status <> 'complete' or phase = 'orphan-upload-cleanup');

alter policy v2_retention_jobs_postgres_all
  on public.v2_daily_maintenance_jobs
  rename to v2_daily_maintenance_jobs_postgres_all;
alter policy v2_retention_jobs_select_maintenance
  on public.v2_daily_maintenance_jobs
  rename to v2_daily_maintenance_jobs_select_maintenance;
alter policy v2_retention_jobs_insert_maintenance
  on public.v2_daily_maintenance_jobs
  rename to v2_daily_maintenance_jobs_insert_maintenance;
alter policy v2_retention_jobs_update_maintenance
  on public.v2_daily_maintenance_jobs
  rename to v2_daily_maintenance_jobs_update_maintenance;
alter policy v2_retention_jobs_delete_maintenance
  on public.v2_daily_maintenance_jobs
  rename to v2_daily_maintenance_jobs_delete_maintenance;

comment on table public.v2_daily_maintenance_jobs is
  'Durable daily activation-metric and orphan-upload-cleanup workflow state.';
