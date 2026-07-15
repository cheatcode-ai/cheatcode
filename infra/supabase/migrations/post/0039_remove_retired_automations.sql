-- Contract only after the automation-free Workers and Vercel frontend are live.
-- DROP remains non-CASCADE so unexpected external dependencies stop for review.
drop table if exists public.v2_retired_automation_run_requests_20260715;
drop table if exists public.v2_retired_automation_runs_20260715;
drop table if exists public.v2_retired_automations_20260715;
