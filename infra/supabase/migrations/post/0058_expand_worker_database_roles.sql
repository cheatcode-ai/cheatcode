do $dependency$
begin
  if not exists (
    select 1
      from public._raw_migrations
     where filename = 'infra/supabase/migrations/post/0051_resource_deletion_jobs.sql'
  ) then
    raise exception 'worker role expansion requires pre-deploy migration post/0051';
  end if;
  if not exists (
    select 1
      from public._raw_migrations
     where filename = 'infra/supabase/migrations/pre/0007_worker_database_roles.sql'
  ) then
    raise exception 'worker role expansion requires foundation pre/0007';
  end if;
  if pg_catalog.to_regprocedure(
    'public._configure_v2_worker_role_access(boolean,boolean)'
  ) is null then
    raise exception 'worker role expansion requires the pre/0007 role helper';
  end if;
end
$dependency$;

-- Keep app_worker fully operational while adding the three dedicated service
-- identities. The closed release and reconciliation can switch Hyperdrives
-- before post-deploy removes the compatibility identity.
select public._configure_v2_worker_role_access(false, true);

alter role app_gateway set search_path = public, pg_catalog;
alter role app_agent set search_path = public, pg_catalog;
alter role app_webhooks set search_path = public, pg_catalog;

-- The final target verifier runs after post-deploy contractions. Assert the
-- minimum-positive staged contract here so a typo cannot switch the closed
-- release to an unusable Hyperdrive identity.
do $postconditions$
declare
  access_spec text;
  column_group text;
  column_name text;
  function_spec text;
  object_name text;
  privilege_name text;
  role_name text;
  select_column_group text;
begin
  if (
    select count(*) = 3
       and bool_and(rolcanlogin)
       and bool_and(not rolinherit)
       and bool_and(not rolsuper)
       and bool_and(not rolcreatedb)
       and bool_and(not rolcreaterole)
       and bool_and(not rolreplication)
       and bool_and(not rolbypassrls)
      from pg_roles
     where rolname in ('app_gateway', 'app_agent', 'app_webhooks')
  ) is not true then
    raise exception 'worker role expansion produced invalid role attributes';
  end if;

  if exists (
    select 1
      from pg_auth_members membership
      join pg_roles granted on granted.oid = membership.roleid
      join pg_roles member on member.oid = membership.member
     where granted.rolname in ('app_gateway', 'app_agent', 'app_webhooks')
        or member.rolname in ('app_gateway', 'app_agent', 'app_webhooks')
  ) then
    raise exception 'worker role expansion left a runtime role membership';
  end if;

  foreach role_name in array array['app_gateway', 'app_agent', 'app_webhooks']
  loop
    if not exists (
      select 1
        from pg_database database_record
       cross join lateral pg_catalog.aclexplode(
         coalesce(
           database_record.datacl,
           pg_catalog.acldefault('d', database_record.datdba)
         )
       ) entry
       where database_record.datname = pg_catalog.current_database()
         and (entry).grantee = (select oid from pg_roles where rolname = role_name)
         and (entry).privilege_type = 'CONNECT'
         and not (entry).is_grantable
    ) then
      raise exception 'worker role expansion omitted direct CONNECT for %', role_name;
    end if;
    if not exists (
      select 1
        from pg_namespace namespace
       cross join lateral pg_catalog.aclexplode(
         coalesce(namespace.nspacl, pg_catalog.acldefault('n', namespace.nspowner))
       ) entry
       where namespace.nspname = 'public'
         and (entry).grantee = (select oid from pg_roles where rolname = role_name)
         and (entry).privilege_type = 'USAGE'
         and not (entry).is_grantable
    ) then
      raise exception 'worker role expansion omitted direct public USAGE for %', role_name;
    end if;
  end loop;

  foreach access_spec in array array[
    'app_gateway|v2_deleted_clerk_identities|SELECT',
    'app_gateway|v2_entitlements|SELECT',
    'app_gateway|v2_messages|SELECT',
    'app_gateway|v2_projects|SELECT',
    'app_gateway|v2_threads|SELECT',
    'app_gateway|v2_user_integrations|SELECT',
    'app_gateway|v2_user_profiles|SELECT',
    'app_gateway|v2_user_skills|SELECT',
    'app_gateway|v2_entitlements|INSERT',
    'app_gateway|v2_projects|INSERT',
    'app_gateway|v2_threads|INSERT',
    'app_gateway|v2_user_integrations|INSERT',
    'app_gateway|v2_user_profiles|INSERT',
    'app_gateway|v2_user_skills|INSERT',
    'app_gateway|v2_users|INSERT',
    'app_gateway|v2_user_integrations|DELETE',
    'app_gateway|v2_user_skills|DELETE',
    'app_agent|v2_messages|SELECT',
    'app_agent|v2_projects|SELECT',
    'app_agent|v2_threads|SELECT',
    'app_agent|v2_user_skills|SELECT',
    'app_agent|v2_agent_runs|INSERT',
    'app_agent|v2_generated_outputs|INSERT',
    'app_agent|v2_messages|INSERT',
    'app_agent|v2_projects|INSERT',
    'app_agent|v2_user_skills|INSERT',
    'app_webhooks|v2_deleted_clerk_identities|SELECT',
    'app_webhooks|v2_entitlements|SELECT',
    'app_webhooks|v2_resource_deletion_jobs|SELECT',
    'app_webhooks|v2_deleted_clerk_identities|INSERT',
    'app_webhooks|v2_entitlements|INSERT',
    'app_webhooks|v2_resource_deletion_jobs|INSERT',
    'app_webhooks|v2_users|INSERT',
    'app_webhooks|v2_generated_outputs|DELETE',
    'app_webhooks|v2_projects|DELETE',
    'app_webhooks|v2_resource_deletion_jobs|DELETE',
    'app_webhooks|v2_threads|DELETE',
    'app_webhooks|v2_users|DELETE'
  ]
  loop
    role_name := pg_catalog.split_part(access_spec, '|', 1);
    object_name := pg_catalog.split_part(access_spec, '|', 2);
    privilege_name := pg_catalog.split_part(access_spec, '|', 3);
    if not pg_catalog.has_table_privilege(
      role_name,
      pg_catalog.format('public.%I', object_name),
      privilege_name
    ) then
      raise exception 'worker role expansion omitted % %.%', privilege_name, role_name, object_name;
    end if;
  end loop;

  foreach select_column_group in array array[
    'app_gateway|v2_users|avatar_url,clerk_id,deleted_at,deletion_fence,display_name,email,id,polar_customer_id',
    'app_gateway|v2_agent_runs|finished_at,id,started_at,status,user_id',
    'app_gateway|v2_provider_keys|created_at,disabled_at,disabled_reason,provider,user_id',
    'app_agent|v2_users|deleted_at,deletion_fence,first_artifact_at,id',
    'app_agent|v2_entitlements|current_period_end,current_period_start,subscription_status,tier,updated_at,user_id',
    'app_agent|v2_agent_runs|id,idempotency_key_hash,model_id,request_body_hash,status,thread_id,user_id',
    'app_agent|v2_generated_outputs|expires_at,filename,id,mime_type,r2_key,user_id',
    'app_agent|v2_user_profiles|agent_display_name,disabled_models,global_memory,user_id',
    'app_agent|v2_user_integrations|composio_connection_id,integration,is_default,status,updated_at,user_id',
    'app_webhooks|v2_users|avatar_url,clerk_id,created_at,deleted_at,deletion_fence,display_name,email,id,polar_customer_id',
    'app_webhooks|v2_agent_runs|id,started_at,thread_id,user_id',
    'app_webhooks|v2_generated_outputs|agent_run_id,expires_at,id,r2_key,user_id',
    'app_webhooks|v2_projects|archive_after,created_at,deleted_at,id,name,over_quota,updated_at,user_id,workspace_slug',
    'app_webhooks|v2_threads|active_run_id,deleted_at,id,project_id,user_id',
    'app_webhooks|v2_provider_keys|created_at,disabled_at,disabled_reason,fingerprint,provider,revalidation_claimed_at,revalidation_lease_token,user_id',
    'app_webhooks|v2_user_integrations|composio_connection_id,integration,is_default,status,updated_at,user_id'
  ]
  loop
    role_name := pg_catalog.split_part(select_column_group, '|', 1);
    object_name := pg_catalog.split_part(select_column_group, '|', 2);
    foreach column_name in array pg_catalog.string_to_array(
      pg_catalog.split_part(select_column_group, '|', 3),
      ','
    )
    loop
      if not pg_catalog.has_column_privilege(
        role_name,
        pg_catalog.format('public.%I', object_name),
        column_name,
        'SELECT'
      ) then
        raise exception 'worker role expansion omitted SELECT %.%.%',
          role_name,
          object_name,
          column_name;
      end if;
    end loop;
  end loop;

  foreach column_group in array array[
    'app_gateway|v2_users|avatar_url,deleted_at,deletion_fence,display_name,email,polar_customer_id',
    'app_gateway|v2_entitlements|cancel_at_period_end,current_period_end,current_period_start,polar_subscription_id,subscription_status,updated_at',
    'app_gateway|v2_projects|deleted_at,master_instructions,name,settings,updated_at',
    'app_gateway|v2_threads|deleted_at,title,updated_at',
    'app_gateway|v2_provider_keys|disabled_at,disabled_reason',
    'app_gateway|v2_user_integrations|is_default,status',
    'app_gateway|v2_user_profiles|agent_display_name,disabled_models,global_memory,onboarding_completed_at,onboarding_state',
    'app_gateway|v2_user_skills|body,category,description,tags,updated_at',
    'app_agent|v2_users|first_artifact_at',
    'app_agent|v2_threads|active_run_id,launch_intent,project_id,updated_at',
    'app_agent|v2_agent_runs|finished_at,model_id,status',
    'app_agent|v2_user_skills|body,category,description,tags,updated_at',
    'app_webhooks|v2_users|avatar_url,deleted_at,deletion_fence,display_name,email,polar_customer_id',
    'app_webhooks|v2_entitlements|cancel_at_period_end,current_period_end,current_period_start,polar_subscription_id,subscription_status,tier,updated_at',
    'app_webhooks|v2_projects|archive_after,deleted_at,over_quota,updated_at,workspace_slug',
    'app_webhooks|v2_threads|active_run_id,deleted_at,updated_at',
    'app_webhooks|v2_provider_keys|disabled_at,disabled_reason,last_revalidated_at,revalidation_claimed_at,revalidation_lease_token',
    'app_webhooks|v2_user_integrations|is_default,status',
    'app_webhooks|v2_resource_deletion_jobs|continuation,cursor,failure_count,last_error_code,lease_expires_at,lease_token,next_attempt_at,phase,status'
  ]
  loop
    role_name := pg_catalog.split_part(column_group, '|', 1);
    object_name := pg_catalog.split_part(column_group, '|', 2);
    foreach column_name in array pg_catalog.string_to_array(
      pg_catalog.split_part(column_group, '|', 3),
      ','
    )
    loop
      if not pg_catalog.has_column_privilege(
        role_name,
        pg_catalog.format('public.%I', object_name),
        column_name,
        'UPDATE'
      ) then
        raise exception 'worker role expansion omitted UPDATE %.%.%', role_name, object_name, column_name;
      end if;
    end loop;
  end loop;

  foreach function_spec in array array[
    'app_gateway|public.delete_provider_key(text)',
    'app_gateway|public.set_provider_key(text,text)',
    'app_gateway|public.uuidv7()',
    'app_agent|public.get_provider_key(text)',
    'app_agent|public.uuidv7()',
    'app_webhooks|public.claim_provider_key_revalidation_targets(integer)',
    'app_webhooks|public.current_app_user()',
    'app_webhooks|public.delete_all_provider_keys()',
    'app_webhooks|public.get_provider_key(text)',
    'app_webhooks|public.scrub_current_user_audit()',
    'app_webhooks|public.uuidv7()'
  ]
  loop
    role_name := pg_catalog.split_part(function_spec, '|', 1);
    object_name := pg_catalog.split_part(function_spec, '|', 2);
    if not pg_catalog.has_function_privilege(role_name, object_name, 'EXECUTE') then
      raise exception 'worker role expansion omitted EXECUTE % %', role_name, object_name;
    end if;
  end loop;

  if not exists (
    select 1
      from pg_policies
     where schemaname = 'public'
       and tablename = 'v2_provider_keys'
       and policyname = 'v2_provider_keys_select_own'
       and cmd = 'SELECT'
       and roles::text[] @> array['app_worker', 'app_gateway', 'app_webhooks']
       and pg_catalog.cardinality(roles) = 3
  ) or not exists (
    select 1
      from pg_policies
     where schemaname = 'public'
       and tablename = 'v2_provider_keys'
       and policyname = 'v2_provider_keys_update_own'
       and cmd = 'UPDATE'
       and roles::text[] @> array['app_worker', 'app_gateway', 'app_webhooks']
       and pg_catalog.cardinality(roles) = 3
  ) or not exists (
    select 1
      from pg_policies
     where schemaname = 'public'
       and tablename = 'v2_deleted_clerk_identities'
       and policyname = 'v2_deleted_clerk_identities_select'
       and cmd = 'SELECT'
       and roles::text[] @> array['app_worker', 'app_gateway', 'app_webhooks']
       and pg_catalog.cardinality(roles) = 3
  ) or not exists (
    select 1
      from pg_policies
     where schemaname = 'public'
       and tablename = 'v2_deleted_clerk_identities'
       and policyname = 'v2_deleted_clerk_identities_insert'
       and cmd = 'INSERT'
       and roles::text[] @> array['app_worker', 'app_webhooks']
       and pg_catalog.cardinality(roles) = 2
  ) then
    raise exception 'worker role expansion produced an invalid staged RLS role set';
  end if;

  if not pg_catalog.has_table_privilege(
    'app_worker',
    'public.v2_projects',
    'SELECT'
  ) or not pg_catalog.has_function_privilege(
    'app_worker',
    'public.uuidv7()',
    'EXECUTE'
  ) then
    raise exception 'worker role expansion removed representative legacy access';
  end if;
end
$postconditions$;
