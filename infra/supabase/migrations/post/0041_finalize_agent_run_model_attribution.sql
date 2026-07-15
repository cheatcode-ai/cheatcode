-- Contract only after Workers persist a canonical logical model for every run.
-- Existing automatic selections predate that invariant and cannot be
-- reconstructed after the fact, so attribute NULLs to the production plan.
-- Known provider-local historical values retain their exact suffix.
create function pg_temp.cheatcode_canonical_model_id(candidate text)
returns text
language sql
immutable
parallel safe
as $function$
  select case
    when candidate is null then null
    when btrim(candidate) ~ '^claude-' then 'anthropic/' || btrim(candidate)
    when btrim(candidate) ~ '^(gpt-|chatgpt-|o[0-9]+(-|$))' then 'openai/' || btrim(candidate)
    when btrim(candidate) ~ '^gemini-' then 'google/' || btrim(candidate)
    when btrim(candidate) ~ '^deepseek-' then 'deepseek/' || btrim(candidate)
    else btrim(candidate)
  end
$function$;

update public.v2_agent_runs
   set model_id = coalesce(
     pg_temp.cheatcode_canonical_model_id(model_id),
     'anthropic/claude-sonnet-4-6'
   )
 where model_id is distinct from coalesce(
   pg_temp.cheatcode_canonical_model_id(model_id),
   'anthropic/claude-sonnet-4-6'
 );

update public.v2_projects
   set settings = jsonb_set(
     settings,
     '{defaultModel}',
     to_jsonb(pg_temp.cheatcode_canonical_model_id(settings ->> 'defaultModel')),
     false
   )
 where jsonb_typeof(settings -> 'defaultModel') = 'string'
   and settings ->> 'defaultModel' is distinct from
     pg_temp.cheatcode_canonical_model_id(settings ->> 'defaultModel');

update public.v2_threads
   set launch_intent = jsonb_set(
     launch_intent,
     '{defaultModel}',
     to_jsonb(pg_temp.cheatcode_canonical_model_id(launch_intent ->> 'defaultModel')),
     false
   )
 where jsonb_typeof(launch_intent -> 'defaultModel') = 'string'
   and launch_intent ->> 'defaultModel' is distinct from
     pg_temp.cheatcode_canonical_model_id(launch_intent ->> 'defaultModel');

do $validation$
begin
  if exists (
    select 1
      from public.v2_projects
     where settings ? 'defaultModel'
       and settings -> 'defaultModel' <> 'null'::jsonb
       and (
         jsonb_typeof(settings -> 'defaultModel') <> 'string'
         or char_length(settings ->> 'defaultModel') > 200
         or settings ->> 'defaultModel'
           !~ '^(anthropic|deepseek|google|openai|openrouter)/[^[:space:]]+$'
       )
  ) then
    raise exception 'v2_projects.settings.defaultModel contains a noncanonical model id'
      using errcode = '23514';
  end if;

  if exists (
    select 1
      from public.v2_threads
     where launch_intent ? 'defaultModel'
       and launch_intent -> 'defaultModel' <> 'null'::jsonb
       and (
         jsonb_typeof(launch_intent -> 'defaultModel') <> 'string'
         or char_length(launch_intent ->> 'defaultModel') > 200
         or launch_intent ->> 'defaultModel'
           !~ '^(anthropic|deepseek|google|openai|openrouter)/[^[:space:]]+$'
       )
  ) then
    raise exception 'v2_threads.launch_intent.defaultModel contains a noncanonical model id'
      using errcode = '23514';
  end if;
end
$validation$;

alter table public.v2_agent_runs
  add constraint v2_agent_runs_model_id_canonical_check
  check (
    char_length(model_id) <= 200
    and model_id ~ '^(anthropic|deepseek|google|openai|openrouter)/[^[:space:]]+$'
  )
  not valid;

alter table public.v2_agent_runs
  validate constraint v2_agent_runs_model_id_canonical_check;

alter table public.v2_agent_runs
  add constraint v2_agent_runs_model_id_not_null_check
  check (model_id is not null)
  not valid;

alter table public.v2_agent_runs
  validate constraint v2_agent_runs_model_id_not_null_check;

alter table public.v2_agent_runs
  alter column model_id set not null;

alter table public.v2_agent_runs
  drop constraint v2_agent_runs_model_id_not_null_check;
