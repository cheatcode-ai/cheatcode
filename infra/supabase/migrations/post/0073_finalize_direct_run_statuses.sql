update public.v2_agent_runs
set status = 'canceled',
    finished_at = greatest(started_at, coalesce(finished_at, now()))
where status not in ('pending', 'running', 'completed', 'failed', 'canceled');

update public.v2_threads thread
set active_run_id = null,
    updated_at = now()
from public.v2_agent_runs run
where thread.active_run_id = run.id
  and run.status = 'canceled';

alter table public.v2_agent_runs
  drop constraint v2_agent_runs_status_check;

alter table public.v2_agent_runs
  add constraint v2_agent_runs_status_check
  check (status in ('pending', 'running', 'completed', 'failed', 'canceled'));
