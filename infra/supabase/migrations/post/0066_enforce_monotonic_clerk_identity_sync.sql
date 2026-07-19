alter table public.v2_users alter column clerk_updated_at_ms drop default;

do $preflight$
begin
  if exists (
    select 1
      from public.v2_users app_user
     where app_user.deleted_at is not null
       and app_user.deletion_fence is not null
       and app_user.deletion_fence !~ '^[0-9]+$'
  ) then
    raise exception 'invalid Clerk deletion fence blocks precision normalization';
  end if;
end
$preflight$;

update public.v2_users app_user
   set deletion_fence = (
     pg_catalog.trunc(extract(epoch from app_user.deleted_at) * 1000)::bigint
   )::text
 where app_user.deleted_at is not null
   and app_user.deletion_fence is not null;

create or replace function public.webhooks_discover_user_deletion_jobs(
  p_before timestamp with time zone,
  p_limit integer
)
returns integer
language plpgsql security definer set search_path = ''
as $function$
declare
  discovered integer;
  page_size integer := greatest(1, least(coalesce(p_limit, 1), 25));
begin
  if p_before is null then
    raise exception 'invalid user-deletion discovery cutoff';
  end if;
  if not pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtextextended('cheatcode:database-maintenance:v1', 0)
  ) then
    return 0;
  end if;
  with candidates as (
    select app_user.id, app_user.deleted_at
      from public.v2_users app_user
     where app_user.deleted_at <= p_before
       and (
         app_user.deletion_fence is null
         or app_user.deletion_fence = (
           pg_catalog.trunc(extract(epoch from app_user.deleted_at) * 1000)::bigint
         )::text
       )
       and not exists (
         select 1
           from public.v2_user_deletion_jobs existing
          where existing.user_id = app_user.id
            and existing.generation = app_user.deleted_at
       )
     order by app_user.deleted_at, app_user.id
     limit page_size
  ), inserted as (
    insert into public.v2_user_deletion_jobs (user_id, generation)
    select candidate.id, candidate.deleted_at
      from candidates candidate
    on conflict (user_id, generation) do nothing
    returning id
  )
  select count(*)::integer into discovered from inserted;
  return discovered;
end
$function$;

create or replace function public.webhooks_claim_ready_user_deletion_jobs(
  p_lease_token uuid,
  p_limit integer,
  p_max_failures integer,
  p_now timestamp with time zone
)
returns table (disposition text, job_id uuid, user_id uuid, continuation integer)
language plpgsql security definer set search_path = ''
as $function$
declare
  candidate record;
  expected_fence text;
  page_size integer := greatest(1, least(coalesce(p_limit, 1), 25));
begin
  if p_lease_token is null or p_now is null or p_max_failures is null
    or p_max_failures < 1 then
    raise exception 'invalid user-deletion claim input';
  end if;
  if not pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtextextended('cheatcode:database-maintenance:v1', 0)
  ) then
    return;
  end if;
  for candidate in
    select job.id, job.user_id, job.generation, job.continuation,
           job.failure_count, job.status
      from public.v2_user_deletion_jobs job
     where (job.status = 'queued' and job.next_attempt_at <= p_now)
        or (job.status = 'leased' and job.lease_expires_at <= p_now)
     order by job.next_attempt_at, job.id
     limit page_size
     for update skip locked
  loop
    expected_fence := (
      pg_catalog.trunc(extract(epoch from candidate.generation) * 1000)::bigint
    )::text;
    update public.v2_users app_user
       set deletion_fence = expected_fence
     where app_user.id = candidate.user_id
       and app_user.deleted_at = candidate.generation
       and (
         app_user.deletion_fence is null
         or app_user.deletion_fence = expected_fence
       );
    if not found then
      delete from public.v2_user_deletion_jobs job where job.id = candidate.id;
      return query select 'stale'::text, candidate.id, candidate.user_id,
        candidate.continuation;
    elsif candidate.status = 'leased'
      and candidate.failure_count + 1 >= p_max_failures then
      return query
      update public.v2_user_deletion_jobs job
         set continuation = job.continuation + 1,
             failure_count = job.failure_count + 1,
             last_error_code = 'user_deletion_lease_expired',
             lease_expires_at = null,
             lease_token = null,
             status = 'quarantined'
       where job.id = candidate.id
      returning 'quarantined'::text, job.id, job.user_id, job.continuation;
    else
      return query
      update public.v2_user_deletion_jobs job
         set continuation = case when candidate.status = 'leased'
               then job.continuation + 1 else job.continuation end,
             failure_count = case when candidate.status = 'leased'
               then job.failure_count + 1 else job.failure_count end,
             last_error_code = case when candidate.status = 'leased'
               then 'user_deletion_lease_expired' else job.last_error_code end,
             lease_expires_at = p_now + interval '2 hours',
             lease_token = p_lease_token,
             next_attempt_at = case when candidate.status = 'leased'
               then p_now else job.next_attempt_at end,
             status = 'leased'
       where job.id = candidate.id
      returning 'leased'::text, job.id, job.user_id, job.continuation;
    end if;
  end loop;
end
$function$;

drop function public.sync_clerk_user(text, text, text, text);

create function public.sync_clerk_user(
  p_clerk_id text,
  p_email text,
  p_display_name text,
  p_avatar_url text,
  p_clerk_updated_at_ms bigint
)
returns table (
  sync_state text,
  user_id uuid,
  email text,
  display_name text,
  avatar_url text,
  polar_customer_id text,
  clerk_updated_at_ms bigint,
  email_changed boolean,
  profile_changed boolean
)
language plpgsql security definer set search_path = ''
as $function$
declare
  has_existing boolean;
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
  if p_clerk_updated_at_ms is null
     or p_clerk_updated_at_ms < 0
     or p_clerk_updated_at_ms > 9007199254740991 then
    raise exception 'invalid Clerk source version';
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
      null::text, null::text, null::bigint, false, false;
    return;
  end if;

  select app_user.id, app_user.avatar_url, app_user.clerk_updated_at_ms,
         app_user.deleted_at, app_user.display_name, app_user.email,
         app_user.polar_customer_id
    into existing
    from public.v2_users app_user
   where app_user.clerk_id = p_clerk_id;
  has_existing := found;
  if has_existing and existing.deleted_at is not null then
    return query select 'in_progress', null::uuid, null::text, null::text,
      null::text, null::text, null::bigint, false, false;
    return;
  end if;
  if has_existing and existing.clerk_updated_at_ms > p_clerk_updated_at_ms then
    return query select 'stale', existing.id, existing.email, existing.display_name,
      existing.avatar_url, existing.polar_customer_id, existing.clerk_updated_at_ms,
      false, false;
    return;
  end if;
  if has_existing and existing.clerk_updated_at_ms = p_clerk_updated_at_ms then
    return query select 'unchanged', existing.id, existing.email, existing.display_name,
      existing.avatar_url, existing.polar_customer_id, existing.clerk_updated_at_ms,
      false, false;
    return;
  end if;

  if has_existing then
    update public.v2_users app_user
       set email = btrim(p_email),
           display_name = nullif(btrim(p_display_name), ''),
           avatar_url = nullif(btrim(p_avatar_url), ''),
           clerk_updated_at_ms = p_clerk_updated_at_ms
     where app_user.id = existing.id
       and app_user.deleted_at is null
       and app_user.deletion_fence is null
       and app_user.clerk_updated_at_ms < p_clerk_updated_at_ms
    returning app_user.id, app_user.email, app_user.display_name,
              app_user.avatar_url, app_user.polar_customer_id,
              app_user.clerk_updated_at_ms
         into persisted;
  else
    insert into public.v2_users (
      clerk_id, clerk_updated_at_ms, email, display_name, avatar_url
    ) values (
      p_clerk_id,
      p_clerk_updated_at_ms,
      btrim(p_email),
      nullif(btrim(p_display_name), ''),
      nullif(btrim(p_avatar_url), '')
    )
    returning id, public.v2_users.email, public.v2_users.display_name,
              public.v2_users.avatar_url, public.v2_users.polar_customer_id,
              public.v2_users.clerk_updated_at_ms
         into persisted;
  end if;
  if not found then
    return query select 'in_progress', null::uuid, null::text, null::text,
      null::text, null::text, null::bigint, false, false;
    return;
  end if;

  insert into public.v2_entitlements (user_id, tier)
  values (persisted.id, 'free')
  on conflict on constraint v2_entitlements_pkey do nothing;
  return query select
    case when has_existing then 'updated' else 'created' end,
    persisted.id,
    persisted.email,
    persisted.display_name,
    persisted.avatar_url,
    persisted.polar_customer_id,
    persisted.clerk_updated_at_ms,
    has_existing and existing.email is distinct from persisted.email,
    has_existing and (
      existing.email is distinct from persisted.email
      or existing.display_name is distinct from persisted.display_name
      or existing.avatar_url is distinct from persisted.avatar_url
    );
end
$function$;

alter function public.sync_clerk_user(text, text, text, text, bigint) owner to postgres;

revoke all on function public.sync_clerk_user(text, text, text, text, bigint)
from public, app_gateway, app_agent, app_webhooks;

grant execute on function public.sync_clerk_user(text, text, text, text, bigint)
to app_gateway, app_webhooks;
