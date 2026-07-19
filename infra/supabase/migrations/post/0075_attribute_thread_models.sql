-- Expose resolved model attribution without widening gateway access to run rows.
grant update (latest_model_id) on table public.v2_threads to app_gateway, app_agent;

with latest_runs as (
  select distinct on (run.thread_id, run.user_id)
    run.thread_id,
    run.user_id,
    run.model_id
  from public.v2_agent_runs as run
  order by run.thread_id, run.user_id, run.started_at desc, run.id desc
)
update public.v2_threads as thread
set latest_model_id = latest_run.model_id
from latest_runs as latest_run
where thread.id = latest_run.thread_id
  and thread.user_id = latest_run.user_id
  and thread.latest_model_id is distinct from latest_run.model_id;
