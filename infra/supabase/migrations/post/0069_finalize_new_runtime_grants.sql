-- 0059 intentionally rebuilds the worker privilege surface. These grants are the
-- exact delta introduced by later expand migrations and must run after that
-- contraction during a fresh bootstrap.

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

grant select (agent_run_id) on table public.v2_generated_outputs to app_agent;
grant select (finished_at, status) on table public.v2_agent_runs to app_webhooks;
grant update (expires_at) on table public.v2_generated_outputs to app_agent;

drop policy if exists v2_generated_outputs_update_own on public.v2_generated_outputs;
create policy v2_generated_outputs_update_own
on public.v2_generated_outputs
as permissive for update to app_agent
using (user_id = (select public.current_app_user()))
with check (user_id = (select public.current_app_user()));

create or replace function public.v2_guard_terminal_agent_run_state()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if old.status in ('completed', 'failed', 'canceled')
     and (
       new.status is distinct from old.status
       or new.finished_at is distinct from old.finished_at
     ) then
    raise exception 'terminal agent-run state is immutable'
      using errcode = '23514';
  end if;
  return new;
end
$function$;

alter function public.v2_guard_terminal_agent_run_state() owner to postgres;
revoke all on function public.v2_guard_terminal_agent_run_state()
from public, anon, authenticated, service_role, app_gateway, app_agent, app_webhooks;

create trigger trg_v2_agent_runs_terminal_state
before update of finished_at, status on public.v2_agent_runs
for each row execute function public.v2_guard_terminal_agent_run_state();

grant select on table public.v2_user_deletion_refund_intents to app_webhooks;
grant execute on function
  public.webhooks_reserve_user_deletion_refund_intent(
    uuid,
    timestamp with time zone,
    integer,
    uuid,
    text,
    text,
    integer,
    text
  ),
  public.webhooks_record_user_deletion_refund_evidence(
    uuid,
    timestamp with time zone,
    integer,
    uuid,
    text,
    text,
    integer,
    text,
    text,
    text,
    text
  )
to app_webhooks;
