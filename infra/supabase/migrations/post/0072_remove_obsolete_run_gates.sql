with obsolete_runs as materialized (
  select distinct (part.value -> 'data' ->> 'runId')::uuid as run_id
  from public.v2_messages message
  cross join lateral jsonb_array_elements(message.parts) as part(value)
  where part.value ->> 'type' in ('data-approval-request', 'data-approval-decision')
    and part.value -> 'data' ->> 'runId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
), closed_runs as (
  update public.v2_agent_runs run
  set status = 'canceled',
      finished_at = greatest(run.started_at, now())
  from obsolete_runs obsolete
  where run.id = obsolete.run_id
    and run.status in ('pending', 'running', 'paused')
  returning run.id
)
update public.v2_threads thread
set active_run_id = null,
    updated_at = now()
from obsolete_runs obsolete
where thread.active_run_id = obsolete.run_id;

update public.v2_messages message
set parts = (
  select coalesce(jsonb_agg(part.value order by part.ordinality), '[]'::jsonb)
  from jsonb_array_elements(message.parts) with ordinality as part(value, ordinality)
  where part.value ->> 'type' not in ('data-approval-request', 'data-approval-decision')
)
where exists (
  select 1
  from jsonb_array_elements(message.parts) as part(value)
  where part.value ->> 'type' in ('data-approval-request', 'data-approval-decision')
);
