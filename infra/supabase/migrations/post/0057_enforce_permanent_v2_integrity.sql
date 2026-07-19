-- Close the remaining permanent V2 integrity gaps after the exact-SHA Workers
-- are live and writers are maintenance-fenced. Historical values are repaired
-- only where the current authoritative state makes the result unambiguous;
-- external-identity corruption fails closed for operator review.

lock table
  public.v2_agent_runs,
  public.v2_entitlements,
  public.v2_generated_outputs,
  public.v2_messages,
  public.v2_projects,
  public.v2_provider_keys,
  public.v2_threads,
  public.v2_user_profiles,
  public.v2_user_skills
in share row exclusive mode;

-- `status` is authoritative. Restore the timestamp projection without inventing
-- elapsed work: missing or inverted terminal times collapse to `started_at`,
-- while nonterminal rows cannot retain a stale finish marker.
update public.v2_agent_runs
   set finished_at = started_at
 where status in ('completed', 'failed', 'canceled')
   and (finished_at is null or finished_at < started_at);

update public.v2_agent_runs
   set finished_at = null
 where status in ('pending', 'running', 'paused')
   and finished_at is not null;

-- A project-bound thread has consumed its one-shot launch intent. Quota state
-- also projects one exact read-only/archive state, so repair only the missing
-- half of that pair using the live 30-day retention policy.
update public.v2_threads
   set launch_intent = null,
       updated_at = now()
 where project_id is not null
   and launch_intent is not null;

update public.v2_projects
   set archive_after = null,
       updated_at = now()
 where not over_quota
   and archive_after is not null;

update public.v2_projects
   set archive_after = now() + interval '30 days',
       updated_at = now()
 where over_quota
   and archive_after is null;

-- JSON null is not a logical model selection. Current writers omit the key,
-- so normalize that harmless historical spelling before enforcing the exact
-- canonical-model contract introduced by migration 0041.
update public.v2_projects
   set settings = settings - 'defaultModel',
       updated_at = now()
 where jsonb_typeof(settings) = 'object'
   and settings -> 'defaultModel' = 'null'::jsonb;

update public.v2_threads
   set launch_intent = launch_intent - 'defaultModel',
       updated_at = now()
 where jsonb_typeof(launch_intent) = 'object'
   and launch_intent -> 'defaultModel' = 'null'::jsonb;

-- Fingerprints are a non-secret projection of the owned Vault payload. Repair
-- only malformed projections with the same lowercase SHA-256 prefix used by
-- set_provider_key; migrations 0042-0043 already prove Vault ownership.
update public.v2_provider_keys key
   set fingerprint = substring(
     encode(
       extensions.digest(convert_to(secret.decrypted_secret, 'UTF8'), 'sha256'),
       'hex'
     )
     for 12
   )
  from vault.decrypted_secrets secret
 where secret.id = key.vault_secret_id
   and key.fingerprint !~ '^[0-9a-f]{12}$';

do $preflight$
begin
  if exists (
    select 1
      from public.v2_agent_runs
     where status not in ('pending', 'running', 'paused', 'completed', 'failed', 'canceled')
  ) then
    raise exception 'agent-run integrity refused: unsupported status values remain';
  end if;

  if exists (
    select 1
      from public.v2_threads
     where active_run_id is not null
       and project_id is null
  ) then
    raise exception 'thread integrity refused: a project-less thread retains an active run';
  end if;

  if exists (
    select 1
      from public.v2_entitlements
     where current_period_start is not null
       and current_period_end is not null
       and current_period_start > current_period_end
  ) then
    raise exception 'entitlement integrity refused: an inverted subscription period remains';
  end if;

  if exists (
    select 1
      from public.v2_entitlements
     where polar_subscription_id is not null
     group by polar_subscription_id
    having count(*) > 1
  ) then
    raise exception 'entitlement integrity refused: duplicate Polar subscription identities remain';
  end if;

  if exists (
    select 1
      from public.v2_projects
     where jsonb_typeof(settings) <> 'object'
        or (
          settings ? 'defaultModel'
          and (
            jsonb_typeof(settings -> 'defaultModel') <> 'string'
            or char_length(settings ->> 'defaultModel') > 200
            or settings ->> 'defaultModel'
              !~ '^(anthropic|deepseek|google|openai|openrouter)/[^[:space:]]+$'
          )
        )
  ) then
    raise exception 'project integrity refused: invalid settings JSON remains';
  end if;

  if exists (
    select 1
      from public.v2_threads
     where (
         launch_intent is not null
         and jsonb_typeof(launch_intent) <> 'object'
       )
        or (
          launch_intent ? 'defaultModel'
          and (
            jsonb_typeof(launch_intent -> 'defaultModel') <> 'string'
            or char_length(launch_intent ->> 'defaultModel') > 200
            or launch_intent ->> 'defaultModel'
              !~ '^(anthropic|deepseek|google|openai|openrouter)/[^[:space:]]+$'
          )
        )
  ) then
    raise exception 'thread integrity refused: invalid launch-intent JSON remains';
  end if;

  if exists (
    select 1 from public.v2_messages where jsonb_typeof(parts) <> 'array'
  ) then
    raise exception 'message integrity refused: parts must be JSON arrays';
  end if;

  if exists (
    select 1
      from public.v2_user_profiles
     where jsonb_typeof(disabled_models) <> 'array'
        or jsonb_typeof(onboarding_state) <> 'object'
  ) then
    raise exception 'profile integrity refused: invalid JSON containers remain';
  end if;

  if exists (
    select 1 from public.v2_user_skills where jsonb_typeof(tags) <> 'array'
  ) then
    raise exception 'skill integrity refused: tags must be JSON arrays';
  end if;

  if exists (
    select 1
      from public.v2_provider_keys
     where fingerprint !~ '^[0-9a-f]{12}$'
        or ((disabled_at is null) <> (disabled_reason is null))
  ) then
    raise exception 'provider-key integrity refused: malformed metadata remains';
  end if;

  if exists (
    select 1
      from public.v2_generated_outputs
     where r2_key <> user_id::text || '/' || split_part(r2_key, '/', 2) || '/' ||
             agent_run_id::text || '/' || id::text || '-' || filename
        or split_part(r2_key, '/', 2)
             !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        or strpos(filename, '/') <> 0
  ) then
    raise exception 'generated-output integrity refused: a noncanonical R2 identity remains';
  end if;
end
$preflight$;

-- Replace the keyset index with the physical ordering used by
-- listThreadMessages: created_at, transcript segment, then UUID.
drop index public.v2_messages_thread_page_idx;

create index v2_messages_thread_page_idx
  on public.v2_messages (user_id, thread_id, created_at, agent_run_segment, id);

create index v2_agent_runs_user_finished_idx
  on public.v2_agent_runs (user_id, finished_at)
  where finished_at is not null;

create unique index v2_entitlements_polar_subscription_uidx
  on public.v2_entitlements (polar_subscription_id)
  where polar_subscription_id is not null;

create index v2_threads_active_run_idx
  on public.v2_threads (active_run_id)
  where active_run_id is not null;

-- A canonical slug ends in its globally unique project primary key, making the
-- historical (user_id, workspace_slug) uniqueness index redundant.
drop index public.v2_projects_user_workspace_slug_uidx;

-- Preserve transcript grouping identity. A run cannot disappear while any
-- message still references it; project/thread cascade deletion removes both
-- sides through their owning thread.
alter table public.v2_messages
  add constraint v2_messages_agent_run_scope_restrict_fk
  foreign key (agent_run_id, user_id, thread_id)
  references public.v2_agent_runs (id, user_id, thread_id)
  on delete restrict
  not valid;

alter table public.v2_messages
  validate constraint v2_messages_agent_run_scope_restrict_fk;

alter table public.v2_messages
  drop constraint v2_messages_agent_run_scope_fk;

alter table public.v2_messages
  rename constraint v2_messages_agent_run_scope_restrict_fk
  to v2_messages_agent_run_scope_fk;

alter table public.v2_agent_runs
  add constraint v2_agent_runs_status_check
    check (status in ('pending', 'running', 'paused', 'completed', 'failed', 'canceled'))
    not valid,
  add constraint v2_agent_runs_finished_order_check
    check (finished_at is null or finished_at >= started_at)
    not valid,
  add constraint v2_agent_runs_terminal_timestamp_check
    check ((status in ('completed', 'failed', 'canceled')) = (finished_at is not null))
    not valid;

alter table public.v2_entitlements
  add constraint v2_entitlements_period_order_check
    check (
      current_period_start is null
      or current_period_end is null
      or current_period_start <= current_period_end
    )
    not valid;

alter table public.v2_generated_outputs
  add constraint v2_generated_outputs_r2_identity_check
    check (
      r2_key = user_id::text || '/' || split_part(r2_key, '/', 2) || '/' ||
        agent_run_id::text || '/' || id::text || '-' || filename
      and split_part(r2_key, '/', 2)
        ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and strpos(filename, '/') = 0
    )
    not valid;

alter table public.v2_messages
  add constraint v2_messages_parts_array_check
    check (jsonb_typeof(parts) = 'array')
    not valid;

alter table public.v2_projects
  add constraint v2_projects_quota_archive_pair_check
    check (over_quota = (archive_after is not null))
    not valid,
  add constraint v2_projects_settings_object_check
    check (jsonb_typeof(settings) = 'object')
    not valid,
  add constraint v2_projects_settings_default_model_check
    check (
      not (settings ? 'defaultModel')
      or (
        jsonb_typeof(settings -> 'defaultModel') = 'string'
        and char_length(settings ->> 'defaultModel') <= 200
        and settings ->> 'defaultModel'
          ~ '^(anthropic|deepseek|google|openai|openrouter)/[^[:space:]]+$'
      )
    )
    not valid;

alter table public.v2_provider_keys
  add constraint v2_provider_keys_fingerprint_check
    check (fingerprint ~ '^[0-9a-f]{12}$')
    not valid;

alter table public.v2_threads
  add constraint v2_threads_project_launch_intent_check
    check (project_id is null or launch_intent is null)
    not valid,
  add constraint v2_threads_active_run_project_check
    check (active_run_id is null or project_id is not null)
    not valid,
  add constraint v2_threads_launch_intent_object_check
    check (launch_intent is null or jsonb_typeof(launch_intent) = 'object')
    not valid,
  add constraint v2_threads_launch_default_model_check
    check (
      launch_intent is null
      or not (launch_intent ? 'defaultModel')
      or (
        jsonb_typeof(launch_intent -> 'defaultModel') = 'string'
        and char_length(launch_intent ->> 'defaultModel') <= 200
        and launch_intent ->> 'defaultModel'
          ~ '^(anthropic|deepseek|google|openai|openrouter)/[^[:space:]]+$'
      )
    )
    not valid;

alter table public.v2_user_profiles
  add constraint v2_user_profiles_disabled_models_array_check
    check (jsonb_typeof(disabled_models) = 'array')
    not valid,
  add constraint v2_user_profiles_onboarding_state_object_check
    check (jsonb_typeof(onboarding_state) = 'object')
    not valid;

alter table public.v2_user_skills
  add constraint v2_user_skills_tags_array_check
    check (jsonb_typeof(tags) = 'array')
    not valid;

alter table public.v2_agent_runs
  validate constraint v2_agent_runs_status_check,
  validate constraint v2_agent_runs_finished_order_check,
  validate constraint v2_agent_runs_terminal_timestamp_check;

alter table public.v2_entitlements
  validate constraint v2_entitlements_period_order_check;

alter table public.v2_generated_outputs
  validate constraint v2_generated_outputs_r2_identity_check;

alter table public.v2_messages
  validate constraint v2_messages_parts_array_check;

alter table public.v2_projects
  validate constraint v2_projects_quota_archive_pair_check,
  validate constraint v2_projects_settings_object_check,
  validate constraint v2_projects_settings_default_model_check;

alter table public.v2_provider_keys
  validate constraint v2_provider_keys_fingerprint_check;

alter table public.v2_threads
  validate constraint v2_threads_project_launch_intent_check,
  validate constraint v2_threads_active_run_project_check,
  validate constraint v2_threads_launch_intent_object_check,
  validate constraint v2_threads_launch_default_model_check;

alter table public.v2_user_profiles
  validate constraint v2_user_profiles_disabled_models_array_check,
  validate constraint v2_user_profiles_onboarding_state_object_check;

alter table public.v2_user_skills
  validate constraint v2_user_skills_tags_array_check;

-- Partition creation is database maintenance, not an application capability.
-- A postgres-owned daily job maintains a short rolling runway while the admin
-- archive command remains responsible for export, verification, and detach.
create or replace function public.ensure_v2_audit_partitions()
returns integer
language plpgsql
set search_path = ''
as $function$
declare
  child_oid oid;
  created_count integer := 0;
  expected_bound text;
  month_offset integer;
  partition_bound text;
  partition_end date;
  partition_name text;
  partition_start date;
begin
  if pg_catalog.to_regclass('public.v2_audit_log') is null then
    raise exception 'audit partition maintenance requires public.v2_audit_log';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('cheatcode:v2:audit-partitions', 0)
  );

  for month_offset in 0..3 loop
    partition_start := (
      pg_catalog.date_trunc(
        'month',
        pg_catalog.timezone('UTC', pg_catalog.statement_timestamp())
      ) + pg_catalog.make_interval(months => month_offset)
    )::date;
    partition_end := (
      partition_start + pg_catalog.make_interval(months => 1)
    )::date;
    partition_name := 'v2_audit_log_' || pg_catalog.to_char(partition_start, 'YYYY_MM');
    expected_bound := pg_catalog.format(
      'FOR VALUES FROM (%L) TO (%L)',
      partition_start::text || ' 00:00:00+00',
      partition_end::text || ' 00:00:00+00'
    );
    child_oid := pg_catalog.to_regclass(
      pg_catalog.format('public.%I', partition_name)
    );

    if child_oid is null then
      execute pg_catalog.format(
        'create table public.%I partition of public.v2_audit_log for values from (%L) to (%L)',
        partition_name,
        partition_start::text || ' 00:00:00+00',
        partition_end::text || ' 00:00:00+00'
      );
      created_count := created_count + 1;
    elsif not exists (
      select 1
        from pg_catalog.pg_inherits inheritance
       where inheritance.inhrelid = child_oid
         and inheritance.inhparent = 'public.v2_audit_log'::regclass
    ) then
      raise exception 'audit partition name % is occupied by an unattached relation',
        partition_name;
    else
      select pg_catalog.pg_get_expr(relation.relpartbound, relation.oid)
        into partition_bound
        from pg_catalog.pg_class relation
       where relation.oid = child_oid;
      if partition_bound is distinct from expected_bound then
        raise exception 'audit partition % has unexpected bounds: %',
          partition_name,
          partition_bound;
      end if;
    end if;
  end loop;

  return created_count;
end
$function$;

alter function public.ensure_v2_audit_partitions() owner to postgres;
revoke all on function public.ensure_v2_audit_partitions()
  from public, anon, authenticated, service_role,
       app_worker, app_gateway, app_agent, app_webhooks;

select public.ensure_v2_audit_partitions();

select cron.schedule(
  'cheatcode-v2-audit-partitions',
  '17 2 * * *',
  'select public.ensure_v2_audit_partitions();'
);
