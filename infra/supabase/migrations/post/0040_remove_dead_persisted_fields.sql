-- Contract only after the schema-clean Workers and Vercel frontend are live.
-- These fields have no remaining runtime readers or writers.
alter table public.v2_agent_runs
  drop column if exists config;

alter table public.v2_projects
  drop column if exists sandbox_id;

-- A project-backed thread derives its mode from the project. Keeping the
-- pre-project launch payload would preserve two competing sources of truth.
update public.v2_threads
   set launch_intent = null,
       updated_at = now()
 where project_id is not null
   and launch_intent is not null;

-- `web` was the V1 spelling for the web app-builder surface. Normalize the
-- existing rows before the canonical constraint is validated; do not silently
-- coerce any other unexpected value.
update public.v2_projects
   set mode = 'app-builder',
       updated_at = now()
 where mode = 'web';

do $$
begin
  if exists (
    select 1
      from public.v2_projects
     where mode not in ('app-builder', 'app-builder-mobile', 'general')
  ) then
    raise exception 'v2_projects contains an unsupported project mode';
  end if;
end
$$;

alter table public.v2_projects
  add constraint v2_projects_mode_check
  check (mode in ('app-builder', 'app-builder-mobile', 'general'))
  not valid;

alter table public.v2_projects
  validate constraint v2_projects_mode_check;

-- Clerk identity lives on v2_users; entitlement rows contain only the current
-- commercial state used to authorize product capabilities.
alter table public.v2_entitlements
  drop column if exists polar_customer_id,
  drop column if exists webhook_event_id,
  drop column if exists source;
