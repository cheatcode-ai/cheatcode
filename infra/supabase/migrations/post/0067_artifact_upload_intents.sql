alter table public.v2_artifact_upload_intents owner to postgres;

alter table public.v2_artifact_upload_intents
  add constraint v2_artifact_upload_intents_project_user_fk
  foreign key (project_id, user_id)
  references public.v2_projects (id, user_id),
  add constraint v2_artifact_upload_intents_agent_run_user_fk
  foreign key (agent_run_id, user_id)
  references public.v2_agent_runs (id, user_id);

revoke all on table public.v2_artifact_upload_intents
from public, anon, authenticated, service_role, app_gateway, app_agent, app_webhooks;

alter table public.v2_artifact_upload_intents enable row level security;
alter table public.v2_artifact_upload_intents force row level security;

create policy v2_artifact_upload_intents_postgres_all
on public.v2_artifact_upload_intents
as permissive for all to postgres using (true) with check (true);

create policy v2_artifact_upload_intents_select_own
on public.v2_artifact_upload_intents
as permissive for select to app_agent
using (user_id = (select public.current_app_user()));

create policy v2_artifact_upload_intents_insert_own
on public.v2_artifact_upload_intents
as permissive for insert to app_agent
with check (user_id = (select public.current_app_user()));

create policy v2_artifact_upload_intents_update_own
on public.v2_artifact_upload_intents
as permissive for update to app_agent
using (user_id = (select public.current_app_user()))
with check (user_id = (select public.current_app_user()));

create policy v2_artifact_upload_intents_delete_own
on public.v2_artifact_upload_intents
as permissive for delete to app_agent
using (user_id = (select public.current_app_user()));

create policy v2_artifact_upload_intents_select_maintenance
on public.v2_artifact_upload_intents
as permissive for select to app_webhooks using (true);

create policy v2_artifact_upload_intents_delete_maintenance
on public.v2_artifact_upload_intents
as permissive for delete to app_webhooks using (true);

grant delete on table public.v2_artifact_upload_intents to app_agent, app_webhooks;
grant select (
  agent_run_id,
  cleanup_not_before,
  id,
  project_id,
  quiesced_at,
  r2_key,
  user_id
) on table public.v2_artifact_upload_intents to app_agent, app_webhooks;
grant insert (
  agent_run_id,
  cleanup_not_before,
  id,
  project_id,
  r2_key,
  user_id
) on table public.v2_artifact_upload_intents to app_agent;
grant update (
  cleanup_not_before,
  quiesced_at
) on table public.v2_artifact_upload_intents to app_agent;

-- Artifact finalization compares an existing output to its originating run,
-- while maintenance proves the joined run is terminal before deleting an
-- abandoned object. These are the only pre-existing columns the new paths add.
grant select (agent_run_id) on table public.v2_generated_outputs to app_agent;
grant select (finished_at, status) on table public.v2_agent_runs to app_webhooks;
grant update (expires_at) on table public.v2_generated_outputs to app_agent;

create policy v2_generated_outputs_update_own
on public.v2_generated_outputs
as permissive for update to app_agent
using (user_id = (select public.current_app_user()))
with check (user_id = (select public.current_app_user()));

create or replace function public.webhooks_list_expired_outputs(
  p_before timestamp with time zone,
  p_cursor_expires_at timestamp with time zone,
  p_cursor_id uuid,
  p_limit integer
)
returns table (expires_at timestamp with time zone, id uuid, r2_key text)
language sql stable security definer set search_path = ''
as $function$
  select output.expires_at, output.id, output.r2_key
    from public.v2_generated_outputs output
    join public.v2_agent_runs terminal_run
      on terminal_run.id = output.agent_run_id
     and terminal_run.user_id = output.user_id
   where output.expires_at <= p_before
     and terminal_run.status in ('completed', 'failed', 'canceled')
     and terminal_run.finished_at is not null
     and (
       (p_cursor_expires_at is null and p_cursor_id is null)
       or (
         p_cursor_expires_at is not null
         and p_cursor_id is not null
         and (output.expires_at, output.id) > (p_cursor_expires_at, p_cursor_id)
       )
     )
   order by output.expires_at, output.id
   limit greatest(1, least(coalesce(p_limit, 1), 500))
$function$;

create or replace function public.webhooks_delete_expired_outputs(
  p_before timestamp with time zone,
  p_outputs jsonb
)
returns integer
language plpgsql security definer set search_path = ''
as $function$
declare
  deleted_count integer;
begin
  if pg_catalog.jsonb_typeof(p_outputs) <> 'array'
     or pg_catalog.jsonb_array_length(p_outputs) > 500
     or pg_catalog.octet_length(p_outputs::text) > 1048576 then
    raise exception 'invalid expired-output deletion batch';
  end if;
  with requested as (
    select record.id, record.expires_at, record.r2_key
      from pg_catalog.jsonb_to_recordset(p_outputs)
        as record(id uuid, expires_at timestamp with time zone, r2_key text)
  ), deleted as (
    delete from public.v2_generated_outputs output
    using requested, public.v2_agent_runs terminal_run
     where output.id = requested.id
       and output.expires_at = requested.expires_at
       and output.r2_key = requested.r2_key
       and output.expires_at <= p_before
       and terminal_run.id = output.agent_run_id
       and terminal_run.user_id = output.user_id
       and terminal_run.status in ('completed', 'failed', 'canceled')
       and terminal_run.finished_at is not null
    returning output.id
  )
  select count(*)::integer into deleted_count from deleted;
  return deleted_count;
end
$function$;

alter function public.webhooks_list_expired_outputs(
  timestamp with time zone,
  timestamp with time zone,
  uuid,
  integer
) owner to postgres;
alter function public.webhooks_delete_expired_outputs(
  timestamp with time zone,
  jsonb
) owner to postgres;

revoke all on function
  public.webhooks_list_expired_outputs(
    timestamp with time zone,
    timestamp with time zone,
    uuid,
    integer
  ),
  public.webhooks_delete_expired_outputs(timestamp with time zone, jsonb)
from public, anon, authenticated, service_role, app_gateway, app_agent, app_webhooks;

grant execute on function
  public.webhooks_list_expired_outputs(
    timestamp with time zone,
    timestamp with time zone,
    uuid,
    integer
  ),
  public.webhooks_delete_expired_outputs(timestamp with time zone, jsonb)
to app_webhooks;
