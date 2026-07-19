do $preflight$
declare
  distinct_count integer;
  expected_description text;
  expected_name text;
  expected_role text;
  named_count integer;
  valid_count integer;
begin
  foreach expected_role in array array['app_agent', 'app_gateway', 'app_webhooks']
  loop
    expected_name := 'cheatcode-database-context-' ||
      pg_catalog.replace(expected_role, '_', '-') || '-v1';
    expected_description := 'Cheatcode signed tenant context HMAC for ' || expected_role;
    select count(*) into named_count
      from vault.secrets secret
     where secret.name = expected_name;
    select count(*) into valid_count
      from vault.decrypted_secrets secret
     where secret.name = expected_name
       and secret.description = expected_description
       and pg_catalog.octet_length(secret.decrypted_secret) >= 32;
    if named_count <> 1 or valid_count <> 1 then
      raise exception
        'signed tenant boundary requires exactly one valid % Vault secret for %',
        expected_name,
        expected_role;
    end if;
  end loop;
  select count(distinct secret.decrypted_secret) into distinct_count
    from vault.decrypted_secrets secret
   where secret.name = any(array[
     'cheatcode-database-context-app-agent-v1',
     'cheatcode-database-context-app-gateway-v1',
     'cheatcode-database-context-app-webhooks-v1'
   ]);
  if distinct_count <> 3 then
    raise exception 'signed tenant boundary requires three distinct Vault secrets';
  end if;
end
$preflight$;

create or replace function public.gateway_resolve_clerk_user(p_clerk_id text)
returns uuid
language sql stable security definer set search_path = ''
as $function$
  select app_user.id
    from public.v2_users app_user
   where app_user.clerk_id = p_clerk_id and app_user.deleted_at is null
   limit 1
$function$;

create or replace function public.webhooks_list_daily_activation_events(
  p_day date,
  p_cursor_event text,
  p_cursor_user_id uuid,
  p_limit integer
)
returns table (
  event_order integer,
  event_name text,
  user_id uuid,
  cohort_week text,
  cohort_month text
)
language sql stable security definer set search_path = ''
as $function$
  with bounded as (
    select greatest(1, least(coalesce(p_limit, 1), 200)) as page_size,
           case
             when p_cursor_event is null then null
             when p_cursor_event = 'retention_d7' then 1
             when p_cursor_event = 'retention_d28' then 2
             when p_cursor_event = 'first_week_mau' then 3
             else -1
           end as cursor_order
  ), activation_events as (
    select 1 as event_order, 'retention_d7'::text as event_name,
           candidate.id as user_id,
           to_char(date_trunc('week', candidate.created_at), 'YYYY-MM-DD') as cohort_week,
           to_char(date_trunc('month', candidate.created_at), 'YYYY-MM-DD') as cohort_month
      from public.v2_users candidate
     where candidate.deleted_at is null
       and candidate.created_at >= p_day - interval '7 days'
       and candidate.created_at < p_day - interval '6 days'
       and exists (
         select 1 from public.v2_agent_runs run
          where run.user_id = candidate.id
            and run.started_at >= p_day
            and run.started_at < p_day + interval '1 day'
       )
    union all
    select 2, 'retention_d28'::text, candidate.id,
           to_char(date_trunc('week', candidate.created_at), 'YYYY-MM-DD'),
           to_char(date_trunc('month', candidate.created_at), 'YYYY-MM-DD')
      from public.v2_users candidate
     where candidate.deleted_at is null
       and candidate.created_at >= p_day - interval '28 days'
       and candidate.created_at < p_day - interval '27 days'
       and exists (
         select 1 from public.v2_agent_runs run
          where run.user_id = candidate.id
            and run.started_at >= p_day
            and run.started_at < p_day + interval '1 day'
       )
    union all
    select 3, 'first_week_mau'::text, candidate.id,
           to_char(date_trunc('week', candidate.created_at), 'YYYY-MM-DD'), null::text
      from public.v2_users candidate
     where candidate.deleted_at is null
       and candidate.created_at >= p_day - interval '7 days'
       and candidate.created_at < p_day - interval '6 days'
       and (
         select count(*) from public.v2_agent_runs run
          where run.user_id = candidate.id
            and run.started_at >= candidate.created_at
            and run.started_at < candidate.created_at + interval '7 days'
       ) >= 3
  )
  select event.event_order, event.event_name, event.user_id,
         event.cohort_week, event.cohort_month
    from activation_events event, bounded
   where (bounded.cursor_order is null and p_cursor_user_id is null)
      or (
        bounded.cursor_order > 0
        and p_cursor_user_id is not null
        and (event.event_order, event.user_id) > (bounded.cursor_order, p_cursor_user_id)
      )
   order by event.event_order, event.user_id
   limit (select page_size + 1 from bounded)
$function$;

create or replace function public.webhooks_list_expired_outputs(
  p_before timestamp with time zone,
  p_cursor_expires_at timestamp with time zone,
  p_cursor_id uuid,
  p_limit integer
)
returns table (expires_at timestamp with time zone, id uuid, r2_key text)
language sql stable security definer set search_path = ''
as $function$
  select output.expires_at, output.id, output.r2_key
    from public.v2_generated_outputs output
   where output.expires_at <= p_before
     and (
       (p_cursor_expires_at is null and p_cursor_id is null)
       or (
         p_cursor_expires_at is not null
         and p_cursor_id is not null
         and (output.expires_at, output.id) > (p_cursor_expires_at, p_cursor_id)
       )
     )
   order by output.expires_at, output.id
   limit greatest(1, least(coalesce(p_limit, 1), 500))
$function$;

create or replace function public.webhooks_delete_expired_outputs(
  p_before timestamp with time zone,
  p_outputs jsonb
)
returns integer
language plpgsql security definer set search_path = ''
as $function$
declare
  deleted_count integer;
begin
  if pg_catalog.jsonb_typeof(p_outputs) <> 'array'
     or pg_catalog.jsonb_array_length(p_outputs) > 500
     or pg_catalog.octet_length(p_outputs::text) > 1048576 then
    raise exception 'invalid expired-output deletion batch';
  end if;
  with requested as (
    select record.id, record.expires_at, record.r2_key
      from pg_catalog.jsonb_to_recordset(p_outputs)
        as record(id uuid, expires_at timestamp with time zone, r2_key text)
  ), deleted as (
    delete from public.v2_generated_outputs output
    using requested
     where output.id = requested.id
       and output.expires_at = requested.expires_at
       and output.r2_key = requested.r2_key
       and output.expires_at <= p_before
    returning output.id
  )
  select count(*)::integer into deleted_count from deleted;
  return deleted_count;
end
$function$;

create or replace function public.sync_clerk_user(
  p_clerk_id text,
  p_email text,
  p_display_name text,
  p_avatar_url text
)
returns table (
  sync_state text,
  user_id uuid,
  email text,
  display_name text,
  avatar_url text,
  polar_customer_id text,
  email_changed boolean,
  profile_changed boolean
)
language plpgsql security definer set search_path = ''
as $function$
declare
  identity_hash text;
  existing record;
  persisted record;
begin
  if p_clerk_id is null or btrim(p_clerk_id) = '' or octet_length(p_clerk_id) > 512 then
    raise exception 'invalid Clerk identity';
  end if;
  if p_email is null or btrim(p_email) = '' or octet_length(p_email) > 512 then
    raise exception 'invalid Clerk email';
  end if;
  if octet_length(coalesce(p_display_name, '')) > 1024
     or octet_length(coalesce(p_avatar_url, '')) > 4096 then
    raise exception 'invalid Clerk profile payload';
  end if;

  identity_hash := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(p_clerk_id, 'UTF8'), 'sha256'),
    'hex'
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('cheatcode:clerk-identity:' || identity_hash, 0)
  );
  if exists (
    select 1 from public.v2_deleted_clerk_identities retired
     where retired.clerk_identity_hash = identity_hash
  ) then
    return query select 'completed', null::uuid, null::text, null::text,
      null::text, null::text, false, false;
    return;
  end if;

  select app_user.avatar_url, app_user.display_name, app_user.email,
         app_user.polar_customer_id
    into existing
    from public.v2_users app_user
   where app_user.clerk_id = p_clerk_id;

  insert into public.v2_users (
    clerk_id, email, display_name, avatar_url, deleted_at, deletion_fence
  ) values (
    p_clerk_id,
    p_email,
    nullif(btrim(p_display_name), ''),
    nullif(btrim(p_avatar_url), ''),
    null,
    null
  )
  on conflict (clerk_id) do update
    set email = excluded.email,
        display_name = excluded.display_name,
        avatar_url = excluded.avatar_url,
        deleted_at = null,
        deletion_fence = null
  where public.v2_users.deletion_fence is null
  returning id, public.v2_users.email, public.v2_users.display_name,
            public.v2_users.avatar_url, public.v2_users.polar_customer_id
       into persisted;
  if not found then
    return query select 'in_progress', null::uuid, null::text, null::text,
      null::text, null::text, false, false;
    return;
  end if;

  insert into public.v2_entitlements (user_id, tier)
  values (persisted.id, 'free')
  on conflict on constraint v2_entitlements_pkey do nothing;
  return query select
    'active',
    persisted.id,
    persisted.email,
    persisted.display_name,
    persisted.avatar_url,
    persisted.polar_customer_id,
    existing.email is not null and existing.email is distinct from persisted.email,
    existing.email is not null and (
      existing.email is distinct from persisted.email
      or existing.display_name is distinct from persisted.display_name
      or existing.avatar_url is distinct from persisted.avatar_url
    );
end
$function$;

create or replace function public.webhooks_mark_clerk_user_deleted(
  p_clerk_id text,
  p_deleted_at timestamp with time zone
)
returns uuid
language plpgsql security definer set search_path = ''
as $function$
declare
  identity_hash text;
  deleted_user_id uuid;
begin
  if p_clerk_id is null or btrim(p_clerk_id) = '' or p_deleted_at is null then
    raise exception 'invalid Clerk deletion payload';
  end if;
  identity_hash := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(p_clerk_id, 'UTF8'), 'sha256'),
    'hex'
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('cheatcode:clerk-identity:' || identity_hash, 0)
  );
  update public.v2_users app_user
     set deleted_at = p_deleted_at, deletion_fence = null
   where app_user.clerk_id = p_clerk_id and app_user.deletion_fence is null
  returning app_user.id into deleted_user_id;
  return deleted_user_id;
end
$function$;

create or replace function public.webhooks_resolve_polar_customer(p_polar_customer_id text)
returns table (user_id uuid, email text, polar_customer_id text)
language sql stable security definer set search_path = ''
as $function$
  select app_user.id, app_user.email, app_user.polar_customer_id
    from public.v2_users app_user
   where app_user.polar_customer_id = p_polar_customer_id
     and app_user.deleted_at is null
   limit 1
$function$;

create or replace function public.webhooks_expire_composio_connection(p_connection_id text)
returns boolean
language plpgsql security definer set search_path = ''
as $function$
declare
  target record;
begin
  select connection.user_id, connection.integration
    into target
    from public.v2_user_integrations connection
   where connection.composio_connection_id = p_connection_id
   for update;
  if not found then
    return false;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target.user_id::text || ':' || target.integration, 0)
  );
  update public.v2_user_integrations connection
     set status = 'expired', is_default = false
   where connection.composio_connection_id = p_connection_id
     and (connection.status is distinct from 'expired' or connection.is_default);
  update public.v2_user_integrations connection
     set is_default = false
   where connection.user_id = target.user_id
     and connection.integration = target.integration
     and connection.is_default
     and lower(connection.status) not in ('active', 'authorized', 'connected', 'enabled');
  update public.v2_user_integrations connection
     set is_default = true
   where connection.composio_connection_id = (
     select candidate.composio_connection_id
       from public.v2_user_integrations candidate
      where candidate.user_id = target.user_id
        and candidate.integration = target.integration
        and lower(candidate.status) in ('active', 'authorized', 'connected', 'enabled')
      order by candidate.updated_at desc, candidate.composio_connection_id
      limit 1
   ) and not exists (
     select 1 from public.v2_user_integrations existing
      where existing.user_id = target.user_id
        and existing.integration = target.integration
        and existing.is_default
   );
  return true;
end
$function$;

create or replace function public.webhooks_list_due_user_deletions(
  p_before timestamp with time zone,
  p_limit_per_state integer
)
returns table (user_id uuid, requested_at timestamp with time zone, is_claimed boolean)
language sql stable security definer set search_path = ''
as $function$
  with bounded as (
    select greatest(1, least(coalesce(p_limit_per_state, 1), 50)) as page_size
  ), claimed as (
    select app_user.id as user_id, app_user.deleted_at as requested_at, true as is_claimed
      from public.v2_users app_user
     where app_user.deleted_at <= p_before
       and app_user.deletion_fence =
         ((extract(epoch from app_user.deleted_at) * 1000)::bigint)::text
     order by app_user.deleted_at, app_user.id
     limit (select page_size from bounded)
  ), pending as (
    select app_user.id as user_id, app_user.deleted_at as requested_at, false as is_claimed
      from public.v2_users app_user
     where app_user.deleted_at <= p_before and app_user.deletion_fence is null
     order by app_user.deleted_at, app_user.id
     limit (select page_size from bounded)
  )
  select * from claimed
  union all
  select * from pending
$function$;

create or replace function public.webhooks_discover_resource_deletion_jobs(p_limit integer)
returns table (projects integer, threads integer)
language plpgsql security definer set search_path = ''
as $function$
declare
  project_count integer;
  page_size integer := greatest(1, least(coalesce(p_limit, 1), 25));
  thread_count integer;
begin
  with candidates as (
    select project.user_id, project.id, project.deleted_at
      from public.v2_projects project
      join public.v2_users app_user on app_user.id = project.user_id
     where project.deleted_at is not null and app_user.deleted_at is null
     order by project.deleted_at, project.id
     limit page_size
  ), inserted as (
    insert into public.v2_resource_deletion_jobs (user_id, kind, resource_id, generation)
    select candidate.user_id, 'project-deletion', candidate.id, candidate.deleted_at
      from candidates candidate
    on conflict (kind, resource_id, generation) do nothing
    returning id
  ) select count(*)::integer into project_count from inserted;

  with candidates as (
    select thread.user_id, thread.id, thread.deleted_at
      from public.v2_threads thread
      join public.v2_users app_user on app_user.id = thread.user_id
      left join public.v2_projects project
        on project.id = thread.project_id and project.user_id = thread.user_id
     where thread.deleted_at is not null
       and app_user.deleted_at is null
       and (thread.project_id is null or project.deleted_at is null)
     order by thread.deleted_at, thread.id
     limit page_size
  ), inserted as (
    insert into public.v2_resource_deletion_jobs (user_id, kind, resource_id, generation)
    select candidate.user_id, 'thread-deletion', candidate.id, candidate.deleted_at
      from candidates candidate
    on conflict (kind, resource_id, generation) do nothing
    returning id
  ) select count(*)::integer into thread_count from inserted;
  return query select project_count, thread_count;
end
$function$;

create or replace function public.webhooks_claim_ready_resource_deletion_jobs(
  p_lease_token uuid,
  p_limit integer,
  p_max_failures integer,
  p_now timestamp with time zone
)
returns table (disposition text, job_id uuid, user_id uuid, continuation integer)
language plpgsql security definer set search_path = ''
as $function$
declare
  candidate_ids uuid[];
  quarantine_ids uuid[];
begin
  if p_lease_token is null or p_now is null or p_max_failures < 1 then
    raise exception 'invalid resource-deletion claim input';
  end if;
  if not pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtextextended('cheatcode:database-maintenance:v1', 0)
  ) then
    return;
  end if;
  select coalesce(array_agg(candidate.id), array[]::uuid[])
    into candidate_ids
    from (
      select job.id
        from public.v2_resource_deletion_jobs job
       where (job.status = 'queued' and job.next_attempt_at <= p_now)
          or (job.status = 'leased' and job.lease_expires_at <= p_now)
       order by job.next_attempt_at, job.id
       limit greatest(1, least(coalesce(p_limit, 1), 25))
       for update skip locked
    ) candidate;
  select coalesce(array_agg(job.id), array[]::uuid[])
    into quarantine_ids
    from public.v2_resource_deletion_jobs job
   where job.id = any(candidate_ids)
     and job.status = 'leased'
     and job.failure_count + 1 >= p_max_failures;

  return query
  update public.v2_resource_deletion_jobs job
     set continuation = job.continuation + 1,
         failure_count = job.failure_count + 1,
         last_error_code = 'resource_deletion_lease_expired',
         lease_expires_at = null,
         lease_token = null,
         status = 'quarantined'
   where job.id = any(quarantine_ids)
  returning 'quarantined'::text, job.id, job.user_id, job.continuation;
  return query
  update public.v2_resource_deletion_jobs job
     set continuation = case when job.status = 'leased'
           then job.continuation + 1 else job.continuation end,
         failure_count = case when job.status = 'leased'
           then job.failure_count + 1 else job.failure_count end,
         last_error_code = case when job.status = 'leased'
           then 'resource_deletion_lease_expired' else job.last_error_code end,
         lease_expires_at = p_now + interval '2 hours',
         lease_token = p_lease_token,
         next_attempt_at = case when job.status = 'leased'
           then p_now else job.next_attempt_at end,
         status = 'leased'
   where job.id = any(candidate_ids)
     and not (job.id = any(quarantine_ids))
  returning 'leased'::text, job.id, job.user_id, job.continuation;
end
$function$;

create or replace function public.webhooks_finalize_current_user_deletion(
  p_deletion_fence text,
  p_clerk_identity_hash text
)
returns boolean
language plpgsql security definer set search_path = ''
as $function$
declare
  actor_id uuid := public.current_app_user();
  deleted_id uuid;
begin
  if p_deletion_fence is null or p_deletion_fence = ''
     or p_clerk_identity_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid user-deletion finalization identity';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('cheatcode:clerk-identity:' || p_clerk_identity_hash, 0)
  );
  if exists (
    select 1 from public.v2_deleted_clerk_identities retired
     where retired.clerk_identity_hash = p_clerk_identity_hash
  ) then
    return false;
  end if;
  if not exists (
    select 1 from public.v2_users app_user
     where app_user.id = actor_id and app_user.deletion_fence = p_deletion_fence
  ) then
    raise exception 'user deletion fence is no longer valid';
  end if;
  insert into public.v2_deleted_clerk_identities (clerk_identity_hash)
  values (p_clerk_identity_hash);
  delete from public.v2_users app_user
   where app_user.id = actor_id and app_user.deletion_fence = p_deletion_fence
  returning app_user.id into deleted_id;
  if deleted_id is null then
    raise exception 'claimed user deletion did not remove exactly one user';
  end if;
  return true;
end
$function$;

revoke all on function
  public.gateway_resolve_clerk_user(text),
  public.sync_clerk_user(text, text, text, text),
  public.webhooks_mark_clerk_user_deleted(text, timestamp with time zone),
  public.webhooks_resolve_polar_customer(text),
  public.webhooks_expire_composio_connection(text),
  public.webhooks_list_due_user_deletions(timestamp with time zone, integer),
  public.webhooks_list_daily_activation_events(date, text, uuid, integer),
  public.webhooks_list_expired_outputs(timestamp with time zone, timestamp with time zone, uuid, integer),
  public.webhooks_delete_expired_outputs(timestamp with time zone, jsonb),
  public.webhooks_discover_resource_deletion_jobs(integer),
  public.webhooks_claim_ready_resource_deletion_jobs(uuid, integer, integer, timestamp with time zone),
  public.webhooks_finalize_current_user_deletion(text, text)
from public, app_gateway, app_agent, app_webhooks;

grant execute on function public.gateway_resolve_clerk_user(text)
to app_gateway;
grant execute on function public.sync_clerk_user(text, text, text, text)
to app_gateway, app_webhooks;
grant execute on function
  public.webhooks_mark_clerk_user_deleted(text, timestamp with time zone),
  public.webhooks_resolve_polar_customer(text),
  public.webhooks_expire_composio_connection(text),
  public.webhooks_list_due_user_deletions(timestamp with time zone, integer),
  public.webhooks_list_daily_activation_events(date, text, uuid, integer),
  public.webhooks_list_expired_outputs(timestamp with time zone, timestamp with time zone, uuid, integer),
  public.webhooks_delete_expired_outputs(timestamp with time zone, jsonb),
  public.webhooks_discover_resource_deletion_jobs(integer),
  public.webhooks_claim_ready_resource_deletion_jobs(uuid, integer, integer, timestamp with time zone),
  public.webhooks_finalize_current_user_deletion(text, text)
to app_webhooks;
