do $roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_gateway') then
    create role app_gateway
      login noinherit nocreatedb nocreaterole;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'app_agent') then
    create role app_agent
      login noinherit nocreatedb nocreaterole;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'app_webhooks') then
    create role app_webhooks
      login noinherit nocreatedb nocreaterole;
  end if;
end
$roles$;

alter role app_gateway
  with login noinherit nocreatedb nocreaterole;
alter role app_agent
  with login noinherit nocreatedb nocreaterole;
alter role app_webhooks
  with login noinherit nocreatedb nocreaterole;

-- Supabase's migration administrator is deliberately not a superuser. PostgreSQL
-- rejects ALTER ROLE for these attributes even when setting their negative
-- forms, so validate the CREATE ROLE defaults/manual provisioning instead.
do $restricted_attributes$
begin
  if exists (
    select 1
      from pg_roles
     where rolname in ('app_gateway', 'app_agent', 'app_webhooks')
       and (rolsuper or rolreplication or rolbypassrls)
  ) then
    raise exception 'worker runtime roles must not be superuser, replication, or bypassrls roles';
  end if;
end
$restricted_attributes$;

-- A runtime role must never gain a second identity through role membership.
do $memberships$
declare
  membership record;
begin
  for membership in
    select granted.rolname as granted_role, member.rolname as member_role
      from pg_auth_members relation
      join pg_roles granted on granted.oid = relation.roleid
      join pg_roles member on member.oid = relation.member
     where granted.rolname in ('app_gateway', 'app_agent', 'app_webhooks')
        or member.rolname in ('app_gateway', 'app_agent', 'app_webhooks')
  loop
    execute format('revoke %I from %I', membership.granted_role, membership.member_role);
  end loop;
end
$memberships$;

-- The foundation runs before Drizzle on a clean database, so the pre-deploy
-- expansion invokes this helper only after the complete V2 schema exists. The
-- post-deploy finalizer uses reset mode and then removes the helper.
create or replace function public._configure_v2_worker_role_access(
  p_reset_access boolean,
  p_include_legacy boolean
)
returns void
language plpgsql
set search_path = ''
as $function$
declare
  expected_relation text;
  provider_policy_roles text;
  tombstone_select_roles text;
begin
  if pg_catalog.to_regclass('public.v2_users') is null then
    return;
  end if;

  foreach expected_relation in array array[
    'v2_agent_runs',
    'v2_audit_log',
    'v2_deleted_clerk_identities',
    'v2_entitlements',
    'v2_generated_outputs',
    'v2_messages',
    'v2_projects',
    'v2_provider_keys',
    'v2_resource_deletion_jobs',
    'v2_threads',
    'v2_user_integrations',
    'v2_user_profiles',
    'v2_user_skills',
    'v2_users'
  ]
  loop
    if pg_catalog.to_regclass(pg_catalog.format('public.%I', expected_relation)) is null then
      raise exception 'worker role cutover requires public.%', expected_relation;
    end if;
  end loop;

  if p_reset_access then
    execute pg_catalog.format(
      'revoke all privileges on database %I from app_gateway, app_agent, app_webhooks',
      pg_catalog.current_database()
    );
    revoke all on schema public, extensions, vault
      from app_gateway, app_agent, app_webhooks;
    revoke all privileges on all tables in schema public
      from app_gateway, app_agent, app_webhooks;
    revoke all privileges on all sequences in schema public
      from app_gateway, app_agent, app_webhooks;
    revoke all privileges on all functions in schema public
      from app_gateway, app_agent, app_webhooks;
  end if;

  execute pg_catalog.format(
    'grant connect on database %I to app_gateway, app_agent, app_webhooks',
    pg_catalog.current_database()
  );
  grant usage on schema public to app_gateway, app_agent, app_webhooks;

  if not p_include_legacy then
    execute pg_catalog.format(
      'revoke all privileges on database %I from app_worker',
      pg_catalog.current_database()
    );
    revoke all on schema public, extensions, vault from app_worker;
    revoke all privileges on all tables in schema public from app_worker;
    revoke all privileges on all sequences in schema public from app_worker;
    revoke all privileges on all functions in schema public from app_worker;
  end if;

  -- Gateway: public API reads and user-initiated mutations. Project deletion is
  -- soft-only here; the external-resource workflow owns the hard delete.
  grant select on table
    public.v2_deleted_clerk_identities,
    public.v2_entitlements,
    public.v2_messages,
    public.v2_projects,
    public.v2_threads,
    public.v2_user_integrations,
    public.v2_user_profiles,
    public.v2_user_skills
  to app_gateway;
  grant select (avatar_url, clerk_id, deleted_at, deletion_fence, display_name, email, id, polar_customer_id)
    on table public.v2_users to app_gateway;
  grant select (finished_at, id, started_at, status, user_id)
    on table public.v2_agent_runs to app_gateway;
  grant select (created_at, disabled_at, disabled_reason, provider, user_id)
    on table public.v2_provider_keys to app_gateway;
  grant insert on table
    public.v2_entitlements,
    public.v2_projects,
    public.v2_threads,
    public.v2_user_integrations,
    public.v2_user_profiles,
    public.v2_user_skills,
    public.v2_users
  to app_gateway;
  grant update (avatar_url, deleted_at, deletion_fence, display_name, email, polar_customer_id)
    on table public.v2_users to app_gateway;
  grant update (
    cancel_at_period_end,
    current_period_end,
    current_period_start,
    polar_subscription_id,
    subscription_status,
    updated_at
  ) on table public.v2_entitlements to app_gateway;
  grant update (deleted_at, master_instructions, name, settings, updated_at)
    on table public.v2_projects to app_gateway;
  grant update (deleted_at, title, updated_at)
    on table public.v2_threads to app_gateway;
  grant update (disabled_at, disabled_reason)
    on table public.v2_provider_keys to app_gateway;
  grant update (is_default, status)
    on table public.v2_user_integrations to app_gateway;
  grant update (
    agent_display_name,
    disabled_models,
    global_memory,
    onboarding_completed_at,
    onboarding_state
  ) on table public.v2_user_profiles to app_gateway;
  grant update (body, category, description, tags, updated_at)
    on table public.v2_user_skills to app_gateway;
  -- Integration rows are the one gateway-owned external finalization: the
  -- route deletes them only after Composio confirms the disconnect. Skills
  -- have no external payload.
  grant delete on table public.v2_user_integrations, public.v2_user_skills
    to app_gateway;

  -- Agent: run execution and artifact persistence. It cannot delete any
  -- externally owned resource or mutate billing/integration ownership.
  grant select on table
    public.v2_messages,
    public.v2_projects,
    public.v2_threads,
    public.v2_user_skills
  to app_agent;
  grant select (deleted_at, deletion_fence, first_artifact_at, id)
    on table public.v2_users to app_agent;
  grant select (current_period_end, current_period_start, subscription_status, tier, updated_at, user_id)
    on table public.v2_entitlements to app_agent;
  grant select (id, idempotency_key_hash, model_id, request_body_hash, status, thread_id, user_id)
    on table public.v2_agent_runs to app_agent;
  grant select (expires_at, filename, id, mime_type, r2_key, user_id)
    on table public.v2_generated_outputs to app_agent;
  grant select (agent_display_name, disabled_models, global_memory, user_id)
    on table public.v2_user_profiles to app_agent;
  grant select (composio_connection_id, integration, is_default, status, updated_at, user_id)
    on table public.v2_user_integrations to app_agent;
  grant insert on table
    public.v2_agent_runs,
    public.v2_generated_outputs,
    public.v2_messages,
    public.v2_projects,
    public.v2_user_skills
  to app_agent;
  grant update (first_artifact_at) on table public.v2_users to app_agent;
  grant update (active_run_id, launch_intent, project_id, updated_at)
    on table public.v2_threads to app_agent;
  grant update (finished_at, model_id, status)
    on table public.v2_agent_runs to app_agent;
  grant update (body, category, description, tags, updated_at)
    on table public.v2_user_skills to app_agent;

  -- Webhooks: provider callbacks and the bounded external-resource finalizers.
  -- Direct project/thread/output deletes exist only here, after their workflow
  -- has removed the corresponding Daytona/R2/DO resources.
  grant select on table
    public.v2_deleted_clerk_identities,
    public.v2_entitlements,
    public.v2_resource_deletion_jobs
  to app_webhooks;
  grant select (avatar_url, clerk_id, created_at, deleted_at, deletion_fence, display_name, email, id, polar_customer_id)
    on table public.v2_users to app_webhooks;
  grant select (id, started_at, thread_id, user_id)
    on table public.v2_agent_runs to app_webhooks;
  grant select (agent_run_id, expires_at, id, r2_key, user_id)
    on table public.v2_generated_outputs to app_webhooks;
  grant select (archive_after, created_at, deleted_at, id, name, over_quota, updated_at, user_id, workspace_slug)
    on table public.v2_projects to app_webhooks;
  grant select (active_run_id, deleted_at, id, project_id, user_id)
    on table public.v2_threads to app_webhooks;
  grant select (created_at, disabled_at, disabled_reason, fingerprint, provider, revalidation_claimed_at, revalidation_lease_token, user_id)
    on table public.v2_provider_keys to app_webhooks;
  grant select (composio_connection_id, integration, is_default, status, updated_at, user_id)
    on table public.v2_user_integrations to app_webhooks;
  grant insert on table
    public.v2_deleted_clerk_identities,
    public.v2_entitlements,
    public.v2_resource_deletion_jobs,
    public.v2_users
  to app_webhooks;
  grant update (avatar_url, deleted_at, deletion_fence, display_name, email, polar_customer_id)
    on table public.v2_users to app_webhooks;
  grant update (
    cancel_at_period_end,
    current_period_end,
    current_period_start,
    polar_subscription_id,
    subscription_status,
    tier,
    updated_at
  ) on table public.v2_entitlements to app_webhooks;
  grant update (archive_after, deleted_at, over_quota, updated_at, workspace_slug)
    on table public.v2_projects to app_webhooks;
  grant update (active_run_id, deleted_at, updated_at)
    on table public.v2_threads to app_webhooks;
  grant update (
    disabled_at,
    disabled_reason,
    last_revalidated_at,
    revalidation_claimed_at,
    revalidation_lease_token
  ) on table public.v2_provider_keys to app_webhooks;
  grant update (is_default, status)
    on table public.v2_user_integrations to app_webhooks;
  grant update (
    continuation,
    cursor,
    failure_count,
    last_error_code,
    lease_expires_at,
    lease_token,
    next_attempt_at,
    phase,
    status
  ) on table public.v2_resource_deletion_jobs to app_webhooks;
  grant delete on table
    public.v2_generated_outputs,
    public.v2_projects,
    public.v2_resource_deletion_jobs,
    public.v2_threads,
    public.v2_users
  to app_webhooks;

  grant execute on function
    public.delete_provider_key(text),
    public.set_provider_key(text, text),
    public.uuidv7()
  to app_gateway;
  grant execute on function public.get_provider_key(text), public.uuidv7()
    to app_agent;
  grant execute on function
    public.claim_provider_key_revalidation_targets(integer),
    public.current_app_user(),
    public.delete_all_provider_keys(),
    public.get_provider_key(text),
    public.scrub_current_user_audit(),
    public.uuidv7()
  to app_webhooks;

  provider_policy_roles := case
    when p_include_legacy then 'app_worker, app_gateway, app_webhooks'
    else 'app_gateway, app_webhooks'
  end;
  tombstone_select_roles := provider_policy_roles;

  drop policy if exists v2_provider_keys_select_own on public.v2_provider_keys;
  drop policy if exists v2_provider_keys_update_own on public.v2_provider_keys;
  execute pg_catalog.format(
    'create policy v2_provider_keys_select_own on public.v2_provider_keys for select to %s using (user_id::text = (select current_setting(''app.user_id'', true)))',
    provider_policy_roles
  );
  execute pg_catalog.format(
    'create policy v2_provider_keys_update_own on public.v2_provider_keys for update to %s using (user_id::text = (select current_setting(''app.user_id'', true))) with check (user_id::text = (select current_setting(''app.user_id'', true)))',
    provider_policy_roles
  );

  drop policy if exists v2_deleted_clerk_identities_select
    on public.v2_deleted_clerk_identities;
  drop policy if exists v2_deleted_clerk_identities_insert
    on public.v2_deleted_clerk_identities;
  execute pg_catalog.format(
    'create policy v2_deleted_clerk_identities_select on public.v2_deleted_clerk_identities for select to %s using (true)',
    tombstone_select_roles
  );
  execute pg_catalog.format(
    'create policy v2_deleted_clerk_identities_insert on public.v2_deleted_clerk_identities for insert to %s with check (clerk_identity_hash ~ ''^[0-9a-f]{64}$'')',
    case when p_include_legacy then 'app_worker, app_webhooks' else 'app_webhooks' end
  );
end
$function$;

revoke all on function public._configure_v2_worker_role_access(boolean, boolean)
  from public, app_worker, app_gateway, app_agent, app_webhooks;
