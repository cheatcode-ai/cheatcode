-- V1 project rows are the durable inventory for externally owned Daytona and
-- Vercel resources. Refuse to erase that inventory unless the
-- migration runner supplies a fresh, database-bound cleanup attestation from
-- the protected production environment. A clean V2-only database has no V1
-- projects table and needs no one-time attestation.
do $external_cleanup_attestation$
declare
  attestation jsonb;
  attestation_keys text[];
  checked_at timestamptz;
  database_keys text[];
  expected_reference_count bigint;
  expires_at timestamptz;
  inventory_keys text[];
  inventory_count bigint;
  inventory_sha256 text;
  migration_sha256 text;
  provider text;
  provider_keys text[];
  proof jsonb;
  proof_keys text[];
  raw_attestation text;
begin
  if to_regclass('public.projects') is null then
    return;
  end if;

  raw_attestation := current_setting('cheatcode.migration_attestation', true);
  migration_sha256 := current_setting('cheatcode.migration_sha256', true);
  if nullif(btrim(raw_attestation), '') is null
     or length(raw_attestation) > 65536
     or migration_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'V1 external cleanup attestation is required';
  end if;

  begin
    attestation := raw_attestation::jsonb;
  exception when others then
    raise exception 'V1 external cleanup attestation is not valid JSON';
  end;

  if jsonb_typeof(attestation) is distinct from 'object' then
    raise exception 'V1 external cleanup attestation must be an object';
  end if;

  select array_agg(attestation_key order by attestation_key)
    into attestation_keys
    from jsonb_object_keys(attestation) attestation_key;
  if attestation_keys is distinct from array[
       'database',
       'expiresAt',
       'inventory',
       'migration',
       'migrationSha256',
       'providers',
       'schemaVersion',
       'scope'
     ]::text[]
     or jsonb_typeof(attestation->'schemaVersion') is distinct from 'number'
     or jsonb_typeof(attestation->'scope') is distinct from 'string'
     or jsonb_typeof(attestation->'migration') is distinct from 'string'
     or jsonb_typeof(attestation->'migrationSha256') is distinct from 'string'
     or jsonb_typeof(attestation->'expiresAt') is distinct from 'string'
     or jsonb_typeof(attestation->'database') is distinct from 'object'
     or jsonb_typeof(attestation->'inventory') is distinct from 'object'
     or jsonb_typeof(attestation->'providers') is distinct from 'object'
     or attestation->>'schemaVersion' is distinct from '1'
     or attestation->>'scope' is distinct from 'v1-external-cleanup'
     or attestation->>'migration' is distinct from
       'infra/supabase/migrations/post/0046_remove_v1_database_surface.sql'
     or attestation->>'migrationSha256' is distinct from migration_sha256 then
    raise exception 'V1 external cleanup attestation identity does not match this migration target';
  end if;

  select array_agg(database_key order by database_key)
    into database_keys
    from jsonb_object_keys(attestation->'database') database_key;
  select array_agg(inventory_key order by inventory_key)
    into inventory_keys
    from jsonb_object_keys(attestation->'inventory') inventory_key;
  if database_keys is distinct from array['name', 'systemIdentifier']::text[]
     or inventory_keys is distinct from array['count', 'sha256']::text[]
     or jsonb_typeof(attestation#>'{database,name}') is distinct from 'string'
     or jsonb_typeof(attestation#>'{database,systemIdentifier}') is distinct from 'string'
     or jsonb_typeof(attestation#>'{inventory,count}') is distinct from 'number'
     or jsonb_typeof(attestation#>'{inventory,sha256}') is distinct from 'string'
     or attestation#>>'{database,name}' is distinct from current_database()
     or attestation#>>'{database,systemIdentifier}' is distinct from
       (select system_identifier::text from pg_control_system()) then
    raise exception 'V1 external cleanup attestation database inventory identity is invalid';
  end if;

  select
    count(*),
    encode(
      extensions.digest(
        convert_to(
          coalesce(
            jsonb_agg(to_jsonb(project_record) order by project_record.project_id),
            '[]'::jsonb
          )::text,
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    )
    into inventory_count, inventory_sha256
    from public.projects project_record;

  if attestation#>>'{inventory,count}' is distinct from inventory_count::text
     or attestation#>>'{inventory,sha256}' is distinct from inventory_sha256 then
    raise exception 'V1 external cleanup attestation does not match the live project inventory';
  end if;

  begin
    expires_at := (attestation->>'expiresAt')::timestamptz;
  exception when others then
    raise exception 'V1 external cleanup attestation has an invalid expiry';
  end;
  if attestation->>'expiresAt' !~
       '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
     or expires_at <= clock_timestamp()
     or expires_at > clock_timestamp() + interval '7 days' then
    raise exception 'V1 external cleanup attestation is expired or valid for too long';
  end if;

  select array_agg(provider_name order by provider_name)
    into provider_keys
    from jsonb_object_keys(attestation->'providers') provider_name;
  if provider_keys is distinct from array['daytona', 'vercel']::text[] then
    raise exception 'V1 external cleanup attestation must cover Daytona and Vercel';
  end if;

  foreach provider in array provider_keys
  loop
    proof := attestation->'providers'->provider;
    expected_reference_count := case provider
      when 'daytona' then 297
      when 'vercel' then 9
    end;
    if jsonb_typeof(proof) is distinct from 'object' then
      raise exception 'V1 % cleanup proof must be an object', provider;
    end if;
    select array_agg(proof_key order by proof_key)
      into proof_keys
      from jsonb_object_keys(proof) proof_key;
    if proof_keys is distinct from array[
         'checkedAt',
         'evidenceReference',
         'evidenceSha256',
         'referencedResourceCount',
         'remainingResourceCount',
         'status'
       ]::text[]
       or jsonb_typeof(proof->'checkedAt') is distinct from 'string'
       or jsonb_typeof(proof->'evidenceReference') is distinct from 'string'
       or jsonb_typeof(proof->'evidenceSha256') is distinct from 'string'
       or jsonb_typeof(proof->'referencedResourceCount') is distinct from 'number'
       or jsonb_typeof(proof->'remainingResourceCount') is distinct from 'number'
       or jsonb_typeof(proof->'status') is distinct from 'string' then
      raise exception 'V1 % cleanup proof shape is invalid', provider;
    end if;
    begin
      checked_at := (proof->>'checkedAt')::timestamptz;
    exception when others then
      raise exception 'V1 % cleanup proof has an invalid check time', provider;
    end;
    if proof->>'checkedAt' !~
         '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
       or proof->>'status' is distinct from 'verified-clean'
       or proof->>'referencedResourceCount' is distinct from expected_reference_count::text
       or proof->>'remainingResourceCount' is distinct from '0'
       or proof->>'evidenceSha256' !~ '^[0-9a-f]{64}$'
       or proof->>'evidenceSha256' ~ '^0{64}$'
       or length(btrim(coalesce(proof->>'evidenceReference', ''))) not between 1 and 512
       or proof->>'evidenceReference' is distinct from btrim(proof->>'evidenceReference')
       or checked_at < clock_timestamp() - interval '7 days'
       or checked_at > clock_timestamp() + interval '5 minutes' then
      raise exception 'V1 % external cleanup proof is incomplete, stale, or not clean', provider;
    end if;
  end loop;
end
$external_cleanup_attestation$;

-- The V1 runtime was permanently removed. Unschedule its only database cron
-- entry before dropping the exact legacy function set.
do $cron_cleanup$
declare
  job_record record;
  was_unscheduled boolean;
begin
  if to_regprocedure('cron.unschedule(bigint)') is not null
     and to_regclass('cron.job') is not null then
    for job_record in execute
      $query$
        select jobid
          from cron.job
         where jobname = 'reset-expired-quotas'
            or command ~ 'public\.(reset_expired_quotas|reset_monthly_token_quotas)\s*\('
      $query$
    loop
      execute 'select cron.unschedule($1)' into was_unscheduled using job_record.jobid;
      if was_unscheduled is distinct from true then
        raise exception 'failed to unschedule obsolete cron job %', job_record.jobid;
      end if;
    end loop;
  end if;
end
$cron_cleanup$;

-- Trigger dependencies must go before their exact backing functions. Guard
-- every relation so the same migration also works on a clean V2-only database.
do $legacy_triggers$
begin
  if to_regclass('public.agent_runs') is not null then
    execute 'drop trigger if exists update_agent_runs_updated_at on public.agent_runs';
  end if;
  if to_regclass('public.messages') is not null then
    execute 'drop trigger if exists update_messages_updated_at on public.messages';
  end if;
  if to_regclass('public.projects') is not null then
    execute 'drop trigger if exists update_projects_updated_at on public.projects';
  end if;
  if to_regclass('public.threads') is not null then
    execute 'drop trigger if exists update_threads_updated_at on public.threads';
  end if;
  if to_regclass('public.user_mcp_credential_profiles') is not null then
    execute 'drop trigger if exists trigger_auto_enable_dashboard_mcp on public.user_mcp_credential_profiles';
    execute 'drop trigger if exists trigger_auto_enable_dashboard_mcp_on_update on public.user_mcp_credential_profiles';
    execute 'drop trigger if exists trigger_ensure_single_default_profile on public.user_mcp_credential_profiles';
    execute 'drop trigger if exists trigger_update_credential_profile_timestamp on public.user_mcp_credential_profiles';
  end if;
  if to_regclass('public.user_dashboard_mcp_preferences') is not null then
    execute 'drop trigger if exists trigger_update_dashboard_mcp_preference_timestamp on public.user_dashboard_mcp_preferences';
  end if;
end
$legacy_triggers$;

-- Resolve signatures through pg_catalog instead of spelling removed composite
-- or vector types in DROP statements. This keeps clean local databases valid
-- while still dropping only the 41 production-audited V1 identities.
do $legacy_functions$
declare
  function_record record;
  original_search_path text := current_setting('search_path');
begin
  -- `oidvectortypes` omits schema qualifiers for visible types. Pin an empty
  -- path while resolving the audited signatures so matching is independent of
  -- the migration client's ambient search_path.
  perform set_config('search_path', '', true);
  for function_record in
    with legacy_function(name, arguments) as (
      values
        ('auto_enable_dashboard_mcp_on_credential_add', ''),
        ('calculate_kb_entry_tokens', ''),
        ('check_and_reset_quotas', ''),
        ('consume_tokens_atomic', 'text, integer, text, text, text, integer, integer, numeric'),
        ('consume_tokens_atomic', 'text, integer, uuid, uuid, text, integer, integer, numeric, text'),
        ('count_deployed_projects_for_account', 'text'),
        ('create_account', 'text, text'),
        ('create_clerk_user_account', 'text, text, text'),
        ('ensure_single_default_profile', ''),
        ('get_account_billing_status', 'text'),
        ('get_account_by_slug', 'text'),
        ('get_account_id', 'text'),
        ('get_account_id_for_clerk_user', 'text'),
        ('get_account_members', 'text, integer, integer'),
        ('get_accounts', ''),
        ('get_current_clerk_user_id', ''),
        ('get_llm_formatted_messages', 'uuid'),
        ('get_missing_credentials_for_template', 'uuid, text'),
        ('get_or_create_user', 'text, text'),
        ('get_personal_account', ''),
        ('get_user_billing', 'text'),
        ('get_user_enabled_dashboard_mcps', 'text'),
        ('has_freestyle_deployment', 'public.projects'),
        ('install_template_as_instance', 'uuid, text, character varying'),
        ('match_components', 'public.vector, double precision, integer'),
        ('match_mobile_components', 'public.vector, double precision, integer'),
        ('remove_account_member', 'text, text'),
        ('reset_expired_quotas', ''),
        ('reset_monthly_token_quotas', ''),
        ('service_role_upsert_customer_subscription', 'text, jsonb, jsonb'),
        ('sync_clerk_email_to_billing', 'text'),
        ('sync_clerk_email_to_billing_with_params', 'text, text'),
        ('sync_clerk_user_data', ''),
        ('update_account', 'text, text, text, jsonb, boolean'),
        ('update_credential_profile_timestamp', ''),
        ('update_dashboard_mcp_preference_timestamp', ''),
        ('update_kb_entry_timestamp', ''),
        ('update_project_deployment_metadata', 'text, text, text, text[], text, boolean'),
        ('update_updated_at_column', ''),
        ('update_updated_at_timestamp', ''),
        ('update_user_tokens', 'text, integer')
    )
    select procedure.oid::regprocedure::text as identity
      from legacy_function
      join pg_proc procedure
        on procedure.proname = legacy_function.name
       and pg_catalog.oidvectortypes(procedure.proargtypes) = legacy_function.arguments
      join pg_namespace namespace
        on namespace.oid = procedure.pronamespace
       and namespace.nspname = 'public'
      left join pg_depend extension_dependency
        on extension_dependency.classid = 'pg_proc'::regclass
       and extension_dependency.objid = procedure.oid
       and extension_dependency.deptype = 'e'
     where extension_dependency.objid is null
  loop
    execute format('drop function %s restrict', function_record.identity);
  end loop;
  perform set_config('search_path', original_search_path, true);
end
$legacy_functions$;

-- Child-first order is explicit; RESTRICT turns any unknown dependency into a
-- release-stopping review instead of widening the deletion boundary.
drop table if exists public.agent_runs restrict;
drop table if exists public.messages restrict;
drop table if exists public.threads restrict;
drop table if exists public.projects restrict;
drop table if exists public.component_index restrict;
drop table if exists public.mobile_component_index restrict;
drop table if exists public.token_usage_log restrict;
drop table if exists public.user_dashboard_mcp_preferences restrict;
drop table if exists public.user_mcp_credential_profiles restrict;
drop table if exists public.user_openrouter_keys restrict;
drop table if exists public.user_provider_keys restrict;
drop table if exists public.user_subscriptions restrict;
drop table if exists public.users restrict;
