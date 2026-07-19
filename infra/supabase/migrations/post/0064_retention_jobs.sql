alter table public.v2_retention_jobs owner to postgres;

revoke all on table public.v2_retention_jobs
from public, anon, authenticated, service_role, app_gateway, app_agent, app_webhooks;

alter table public.v2_retention_jobs enable row level security;
alter table public.v2_retention_jobs force row level security;

create policy v2_retention_jobs_postgres_all on public.v2_retention_jobs
  as permissive for all to postgres using (true) with check (true);
create policy v2_retention_jobs_select_maintenance on public.v2_retention_jobs
  as permissive for select to app_webhooks using (true);
create policy v2_retention_jobs_insert_maintenance on public.v2_retention_jobs
  as permissive for insert to app_webhooks with check (true);
create policy v2_retention_jobs_update_maintenance on public.v2_retention_jobs
  as permissive for update to app_webhooks using (true) with check (true);
create policy v2_retention_jobs_delete_maintenance on public.v2_retention_jobs
  as permissive for delete to app_webhooks using (true);

grant select, delete on table public.v2_retention_jobs to app_webhooks;
grant insert (day, scheduled_at) on table public.v2_retention_jobs to app_webhooks;
grant update (
  activation_cursor_event,
  activation_cursor_user_id,
  completed_at,
  continuation,
  failure_count,
  last_error_code,
  lease_expires_at,
  lease_token,
  next_attempt_at,
  output_cursor_expires_at,
  output_cursor_id,
  phase,
  release_version_id,
  status
) on table public.v2_retention_jobs to app_webhooks;
