do $dependency$
begin
  if not exists (
    select 1 from public._raw_migrations
     where filename = 'infra/supabase/migrations/post/0059_finalize_worker_database_roles.sql'
  ) then
    raise exception 'signed tenant enforcement requires post/0059';
  end if;
  if not exists (
    select 1 from public._raw_migrations
     where filename = 'infra/supabase/migrations/post/0060_expand_signed_tenant_boundary.sql'
  ) then
    raise exception 'signed tenant enforcement requires pre-deploy post/0060';
  end if;
end
$dependency$;

-- The caller supplies a short-lived, role-bound HMAC. GUCs are transaction-local,
-- so Hyperdrive cannot carry an accepted tenant identity into a later request.
create or replace function public.current_app_user()
returns uuid
language plpgsql stable security definer set search_path = ''
as $function$
declare
  actor_id uuid;
  actor_text text := pg_catalog.current_setting('app.user_id', true);
  audience text := session_user;
  context_secret text;
  expected_description text;
  expected_hmac bytea;
  expected_name text;
  issued_at bigint;
  issued_text text := pg_catalog.current_setting('app.context_issued_at', true);
  nonce_text text := pg_catalog.current_setting('app.context_nonce', true);
  now_ms bigint;
  payload text;
  signature_difference integer;
  signature_text text := pg_catalog.current_setting('app.context_signature', true);
  supplied_hmac bytea;
begin
  if audience not in ('app_agent', 'app_gateway', 'app_webhooks') then
    raise exception using
      errcode = '42501',
      message = 'signed tenant context is unavailable to this database role';
  end if;
  if actor_text is null
     or actor_text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or issued_text is null
     or issued_text !~ '^[0-9]{13}$'
     or nonce_text is null
     or nonce_text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or signature_text is null
     or signature_text !~ '^[0-9a-f]{64}$' then
    raise exception using
      errcode = '42501',
      message = 'signed tenant context is malformed';
  end if;

  actor_id := actor_text::uuid;
  issued_at := issued_text::bigint;
  now_ms := (
    extract(epoch from pg_catalog.transaction_timestamp()) * 1000
  )::bigint;
  if issued_at < now_ms - 15000 or issued_at > now_ms + 2000 then
    raise exception using
      errcode = '42501',
      message = 'signed tenant context is outside its freshness window';
  end if;

  expected_name := 'cheatcode-database-context-' ||
    pg_catalog.replace(audience, '_', '-') || '-v1';
  expected_description := 'Cheatcode signed tenant context HMAC for ' || audience;
  select secret.decrypted_secret into strict context_secret
    from vault.decrypted_secrets secret
   where secret.name = expected_name
     and secret.description = expected_description;
  if pg_catalog.octet_length(context_secret) < 32 then
    raise exception 'signed tenant context secret is invalid';
  end if;

  payload := 'cheatcode-database-context-v1' || pg_catalog.chr(10) ||
    audience || pg_catalog.chr(10) || actor_text || pg_catalog.chr(10) ||
    issued_text || pg_catalog.chr(10) || nonce_text;
  expected_hmac := extensions.hmac(
    pg_catalog.convert_to(payload, 'UTF8'),
    pg_catalog.convert_to(context_secret, 'UTF8'),
    'sha256'
  );
  supplied_hmac := pg_catalog.decode(signature_text, 'hex');
  select pg_catalog.bit_or(
    pg_catalog.get_byte(expected_hmac, offset_value) #
    pg_catalog.get_byte(supplied_hmac, offset_value)
  ) into signature_difference
    from pg_catalog.generate_series(0, 31) as offsets(offset_value);
  if signature_difference is distinct from 0 then
    raise exception using
      errcode = '42501',
      message = 'signed tenant context signature is invalid';
  end if;
  return actor_id;
exception
  when no_data_found or too_many_rows then
    raise exception using
      errcode = '42501',
      message = 'signed tenant context secret contract is invalid';
end
$function$;

alter function public.current_app_user() owner to postgres;

-- Audit maintenance must apply the same closed posture to every future child;
-- partition ACL/RLS state is not inherited as an independent direct-access contract.
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
    partition_end := (partition_start + pg_catalog.make_interval(months => 1))::date;
    partition_name := 'v2_audit_log_' || pg_catalog.to_char(partition_start, 'YYYY_MM');
    expected_bound := pg_catalog.format(
      'FOR VALUES FROM (%L) TO (%L)',
      partition_start::text || ' 00:00:00+00',
      partition_end::text || ' 00:00:00+00'
    );
    child_oid := pg_catalog.to_regclass(pg_catalog.format('public.%I', partition_name));

    if child_oid is null then
      execute pg_catalog.format(
        'create table public.%I partition of public.v2_audit_log for values from (%L) to (%L)',
        partition_name,
        partition_start::text || ' 00:00:00+00',
        partition_end::text || ' 00:00:00+00'
      );
      child_oid := pg_catalog.to_regclass(pg_catalog.format('public.%I', partition_name));
      created_count := created_count + 1;
    elsif not exists (
      select 1 from pg_catalog.pg_inherits inheritance
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

    execute pg_catalog.format(
      'alter table public.%I enable row level security', partition_name
    );
    execute pg_catalog.format(
      'alter table public.%I force row level security', partition_name
    );
    execute pg_catalog.format(
      'revoke all privileges on table public.%I from app_gateway, app_agent, app_webhooks',
      partition_name
    );
    execute pg_catalog.format(
      'drop policy if exists v2_audit_partition_postgres_all on public.%I', partition_name
    );
    execute pg_catalog.format(
      'create policy v2_audit_partition_postgres_all on public.%I for all to postgres using (true) with check (true)',
      partition_name
    );
  end loop;
  return created_count;
end
$function$;

alter function public.ensure_v2_audit_partitions() owner to postgres;

-- Replace every historical policy at once. No permissive policy from the staged
-- role migration is allowed to survive this final boundary.
do $policies$
declare
  policy_record record;
  table_name text;
begin
  foreach table_name in array array[
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
  ] loop
    execute pg_catalog.format(
      'alter table public.%I enable row level security', table_name
    );
    execute pg_catalog.format(
      'alter table public.%I force row level security', table_name
    );
    for policy_record in
      select policy.policyname
        from pg_catalog.pg_policies policy
       where policy.schemaname = 'public' and policy.tablename = table_name
    loop
      execute pg_catalog.format(
        'drop policy %I on public.%I', policy_record.policyname, table_name
      );
    end loop;
    execute pg_catalog.format(
      'create policy %I on public.%I for all to postgres using (true) with check (true)',
      table_name || '_postgres_all',
      table_name
    );
  end loop;
end
$policies$;

create policy v2_users_select_own on public.v2_users
  for select to app_gateway, app_agent, app_webhooks
  using (id = (select public.current_app_user()));
create policy v2_users_update_own on public.v2_users
  for update to app_gateway, app_agent, app_webhooks
  using (id = (select public.current_app_user()))
  with check (id = (select public.current_app_user()));

create policy v2_entitlements_select_own on public.v2_entitlements
  for select to app_gateway, app_agent, app_webhooks
  using (user_id = (select public.current_app_user()));
create policy v2_entitlements_insert_own on public.v2_entitlements
  for insert to app_gateway, app_webhooks
  with check (user_id = (select public.current_app_user()));
create policy v2_entitlements_update_own on public.v2_entitlements
  for update to app_gateway, app_webhooks
  using (user_id = (select public.current_app_user()))
  with check (user_id = (select public.current_app_user()));

create policy v2_user_profiles_select_own on public.v2_user_profiles
  for select to app_gateway, app_agent
  using (user_id = (select public.current_app_user()));
create policy v2_user_profiles_insert_own on public.v2_user_profiles
  for insert to app_gateway
  with check (user_id = (select public.current_app_user()));
create policy v2_user_profiles_update_own on public.v2_user_profiles
  for update to app_gateway
  using (user_id = (select public.current_app_user()))
  with check (user_id = (select public.current_app_user()));

create policy v2_projects_select_own on public.v2_projects
  for select to app_gateway, app_agent, app_webhooks
  using (user_id = (select public.current_app_user()));
create policy v2_projects_insert_own on public.v2_projects
  for insert to app_gateway, app_agent
  with check (user_id = (select public.current_app_user()));
create policy v2_projects_update_own on public.v2_projects
  for update to app_gateway, app_webhooks
  using (user_id = (select public.current_app_user()))
  with check (user_id = (select public.current_app_user()));
create policy v2_projects_delete_own on public.v2_projects
  for delete to app_webhooks
  using (user_id = (select public.current_app_user()));

create policy v2_threads_select_own on public.v2_threads
  for select to app_gateway, app_agent, app_webhooks
  using (user_id = (select public.current_app_user()));
create policy v2_threads_insert_own on public.v2_threads
  for insert to app_gateway
  with check (user_id = (select public.current_app_user()));
create policy v2_threads_update_own on public.v2_threads
  for update to app_gateway, app_agent, app_webhooks
  using (user_id = (select public.current_app_user()))
  with check (user_id = (select public.current_app_user()));
create policy v2_threads_delete_own on public.v2_threads
  for delete to app_webhooks
  using (user_id = (select public.current_app_user()));

create policy v2_messages_select_own on public.v2_messages
  for select to app_gateway, app_agent
  using (user_id = (select public.current_app_user()));
create policy v2_messages_insert_own on public.v2_messages
  for insert to app_agent
  with check (user_id = (select public.current_app_user()));

create policy v2_agent_runs_select_own on public.v2_agent_runs
  for select to app_gateway, app_agent, app_webhooks
  using (user_id = (select public.current_app_user()));
create policy v2_agent_runs_insert_own on public.v2_agent_runs
  for insert to app_agent
  with check (user_id = (select public.current_app_user()));
create policy v2_agent_runs_update_own on public.v2_agent_runs
  for update to app_agent
  using (user_id = (select public.current_app_user()))
  with check (user_id = (select public.current_app_user()));

create policy v2_generated_outputs_select_own on public.v2_generated_outputs
  for select to app_agent, app_webhooks
  using (user_id = (select public.current_app_user()));
create policy v2_generated_outputs_insert_own on public.v2_generated_outputs
  for insert to app_agent
  with check (user_id = (select public.current_app_user()));
create policy v2_generated_outputs_delete_own on public.v2_generated_outputs
  for delete to app_webhooks
  using (user_id = (select public.current_app_user()));

create policy v2_user_skills_select_own on public.v2_user_skills
  for select to app_gateway, app_agent
  using (user_id = (select public.current_app_user()));
create policy v2_user_skills_insert_own on public.v2_user_skills
  for insert to app_gateway, app_agent
  with check (user_id = (select public.current_app_user()));
create policy v2_user_skills_update_own on public.v2_user_skills
  for update to app_gateway, app_agent
  using (user_id = (select public.current_app_user()))
  with check (user_id = (select public.current_app_user()));
create policy v2_user_skills_delete_own on public.v2_user_skills
  for delete to app_gateway
  using (user_id = (select public.current_app_user()));

create policy v2_user_integrations_select_own on public.v2_user_integrations
  for select to app_gateway, app_agent, app_webhooks
  using (user_id = (select public.current_app_user()));
create policy v2_user_integrations_insert_own on public.v2_user_integrations
  for insert to app_gateway
  with check (user_id = (select public.current_app_user()));
create policy v2_user_integrations_update_own on public.v2_user_integrations
  for update to app_gateway
  using (user_id = (select public.current_app_user()))
  with check (user_id = (select public.current_app_user()));
create policy v2_user_integrations_delete_own on public.v2_user_integrations
  for delete to app_gateway
  using (user_id = (select public.current_app_user()));

create policy v2_resource_deletion_jobs_select_own on public.v2_resource_deletion_jobs
  for select to app_webhooks
  using (user_id = (select public.current_app_user()));
create policy v2_resource_deletion_jobs_insert_own on public.v2_resource_deletion_jobs
  for insert to app_webhooks
  with check (user_id = (select public.current_app_user()));
create policy v2_resource_deletion_jobs_update_own on public.v2_resource_deletion_jobs
  for update to app_webhooks
  using (user_id = (select public.current_app_user()))
  with check (user_id = (select public.current_app_user()));
create policy v2_resource_deletion_jobs_delete_own on public.v2_resource_deletion_jobs
  for delete to app_webhooks
  using (user_id = (select public.current_app_user()));

create policy v2_provider_keys_select_own on public.v2_provider_keys
  for select to app_gateway, app_webhooks
  using (user_id = (select public.current_app_user()));
create policy v2_provider_keys_update_own on public.v2_provider_keys
  for update to app_gateway, app_webhooks
  using (user_id = (select public.current_app_user()))
  with check (user_id = (select public.current_app_user()));

-- Reset every service ACL before rebuilding the reviewed steady-state matrix.
do $acl_reset$
begin
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
end
$acl_reset$;

revoke execute on all functions in schema public
  from public, anon, authenticated, service_role;
do $database_grant$
begin
  execute pg_catalog.format(
    'grant connect on database %I to app_gateway, app_agent, app_webhooks',
    pg_catalog.current_database()
  );
end
$database_grant$;
grant usage on schema public to app_gateway, app_agent, app_webhooks;

grant select on table
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
  public.v2_user_skills
to app_gateway;
grant update (display_name) on table public.v2_users to app_gateway;
grant update (
  cancel_at_period_end, current_period_end, current_period_start,
  polar_subscription_id, subscription_status, updated_at
) on table public.v2_entitlements to app_gateway;
grant update (deleted_at, master_instructions, name, settings, updated_at)
  on table public.v2_projects to app_gateway;
grant update (deleted_at, title, updated_at) on table public.v2_threads to app_gateway;
grant update (disabled_at, disabled_reason) on table public.v2_provider_keys to app_gateway;
grant update (is_default, status) on table public.v2_user_integrations to app_gateway;
grant update (
  agent_display_name, disabled_models, global_memory,
  onboarding_completed_at, onboarding_state
) on table public.v2_user_profiles to app_gateway;
grant update (body, category, description, tags, updated_at)
  on table public.v2_user_skills to app_gateway;
grant delete on table public.v2_user_integrations, public.v2_user_skills to app_gateway;

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
grant update (finished_at, model_id, status) on table public.v2_agent_runs to app_agent;
grant update (body, category, description, tags, updated_at)
  on table public.v2_user_skills to app_agent;

grant select on table public.v2_entitlements, public.v2_resource_deletion_jobs
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
grant insert on table public.v2_entitlements, public.v2_resource_deletion_jobs to app_webhooks;
grant update (deleted_at, deletion_fence, polar_customer_id)
  on table public.v2_users to app_webhooks;
grant update (
  cancel_at_period_end, current_period_end, current_period_start,
  polar_subscription_id, subscription_status, tier, updated_at
) on table public.v2_entitlements to app_webhooks;
grant update (archive_after, deleted_at, over_quota, updated_at, workspace_slug)
  on table public.v2_projects to app_webhooks;
grant update (active_run_id, deleted_at, updated_at)
  on table public.v2_threads to app_webhooks;
grant update (
  disabled_at, disabled_reason, last_revalidated_at,
  revalidation_claimed_at, revalidation_lease_token
) on table public.v2_provider_keys to app_webhooks;
grant update (
  continuation, cursor, failure_count, last_error_code, lease_expires_at,
  lease_token, next_attempt_at, phase, status
) on table public.v2_resource_deletion_jobs to app_webhooks;
grant delete on table
  public.v2_generated_outputs,
  public.v2_projects,
  public.v2_resource_deletion_jobs,
  public.v2_threads
to app_webhooks;

grant execute on function
  public.current_app_user(),
  public.delete_provider_key(text),
  public.gateway_resolve_clerk_user(text),
  public.set_provider_key(text, text),
  public.sync_clerk_user(text, text, text, text),
  public.uuidv7()
to app_gateway;
grant execute on function
  public.current_app_user(),
  public.get_provider_key(text),
  public.uuidv7()
to app_agent;
grant execute on function
  public.claim_provider_key_revalidation_targets(integer),
  public.current_app_user(),
  public.delete_all_provider_keys(),
  public.get_provider_key(text),
  public.scrub_current_user_audit(),
  public.sync_clerk_user(text, text, text, text),
  public.uuidv7(),
  public.webhooks_claim_ready_resource_deletion_jobs(uuid, integer, integer, timestamp with time zone),
  public.webhooks_delete_expired_outputs(timestamp with time zone, jsonb),
  public.webhooks_discover_resource_deletion_jobs(integer),
  public.webhooks_expire_composio_connection(text),
  public.webhooks_finalize_current_user_deletion(text, text),
  public.webhooks_list_daily_activation_events(date, text, uuid, integer),
  public.webhooks_list_due_user_deletions(timestamp with time zone, integer),
  public.webhooks_list_expired_outputs(timestamp with time zone, timestamp with time zone, uuid, integer),
  public.webhooks_mark_clerk_user_deleted(text, timestamp with time zone),
  public.webhooks_resolve_polar_customer(text)
to app_webhooks;

alter function public.gateway_resolve_clerk_user(text) owner to postgres;
alter function public.sync_clerk_user(text, text, text, text) owner to postgres;
alter function public.webhooks_mark_clerk_user_deleted(text, timestamp with time zone) owner to postgres;
alter function public.webhooks_resolve_polar_customer(text) owner to postgres;
alter function public.webhooks_expire_composio_connection(text) owner to postgres;
alter function public.webhooks_list_due_user_deletions(timestamp with time zone, integer) owner to postgres;
alter function public.webhooks_list_daily_activation_events(date, text, uuid, integer) owner to postgres;
alter function public.webhooks_list_expired_outputs(timestamp with time zone, timestamp with time zone, uuid, integer) owner to postgres;
alter function public.webhooks_delete_expired_outputs(timestamp with time zone, jsonb) owner to postgres;
alter function public.webhooks_discover_resource_deletion_jobs(integer) owner to postgres;
alter function public.webhooks_claim_ready_resource_deletion_jobs(uuid, integer, integer, timestamp with time zone) owner to postgres;
alter function public.webhooks_finalize_current_user_deletion(text, text) owner to postgres;

select public.ensure_v2_audit_partitions();
