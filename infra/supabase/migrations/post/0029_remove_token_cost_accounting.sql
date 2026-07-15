-- Contract only after the token-accounting-free backend release is live.
-- DROP remains non-CASCADE so unexpected dependencies stop for review.
drop table if exists public.v2_usage_daily_totals;
drop table if exists public.v2_usage_events;

alter table if exists public.v2_agent_runs
  drop column if exists tokens_in,
  drop column if exists tokens_out,
  drop column if exists tokens_cached,
  drop column if exists cost_usd;

alter table if exists public.v2_entitlements
  drop column if exists free_deepseek_tokens_used;

update public.v2_projects
set settings = settings - 'budgetCapUsd'
where settings ? 'budgetCapUsd';

update public.v2_agent_runs
set config = config - array['budgetCapUsd', 'stepCap', 'workflowName']
where config ?| array['budgetCapUsd', 'stepCap', 'workflowName'];

update public.v2_agent_runs
set error = error - 'stepNumber'
where error ? 'stepNumber';
