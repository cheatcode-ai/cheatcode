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

  select app_user.avatar_url, app_user.deleted_at, app_user.display_name,
         app_user.email, app_user.polar_customer_id
    into existing
    from public.v2_users app_user
   where app_user.clerk_id = p_clerk_id;
  if found and existing.deleted_at is not null then
    return query select 'in_progress', null::uuid, null::text, null::text,
      null::text, null::text, false, false;
    return;
  end if;

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
        avatar_url = excluded.avatar_url
  where public.v2_users.deleted_at is null
    and public.v2_users.deletion_fence is null
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
     set deleted_at = coalesce(app_user.deleted_at, p_deleted_at),
         deletion_fence = null
   where app_user.clerk_id = p_clerk_id and app_user.deletion_fence is null
  returning app_user.id into deleted_user_id;
  return deleted_user_id;
end
$function$;
