-- The additive Drizzle migration leaves the former one-row-per-run identity in
-- place so the old Worker remains safe during rollout. The segmented Worker
-- hides non-final rows and retries conflicts until this closed-gate contraction
-- removes that obsolete identity.
lock table public.v2_agent_runs in share row exclusive mode;
lock table public.v2_messages in share row exclusive mode;

do $$
begin
  if to_regclass('public.v2_messages_agent_run_segment_assistant_uidx') is null
    or to_regclass('public.v2_messages_agent_run_final_assistant_uidx') is null then
    raise exception
      'assistant transcript contraction refused: segmented-message indexes are missing';
  end if;

  if exists (
    select 1
      from public.v2_agent_runs
     where status is null
        or status not in ('completed', 'failed', 'canceled')
  ) then
    raise exception
      'assistant transcript contraction refused: active AgentRuns must drain before the old identity is removed';
  end if;
end
$$;

drop index public.v2_messages_agent_run_assistant_uidx;
