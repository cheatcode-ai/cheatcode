create or replace function set_provider_key(p_provider text, p_key text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := public.current_app_user();
  v_secret_id uuid;
  v_fingerprint text;
  v_row_id uuid;
  v_old_secret_ids uuid[];
begin
  select coalesce(array_agg(vault_secret_id), '{}'::uuid[])
    into v_old_secret_ids
  from public.v2_provider_keys
  where user_id = v_user and provider = p_provider and deleted_at is null;

  v_fingerprint := substring(
    encode(extensions.digest(convert_to(p_key, 'UTF8'), 'sha256'), 'hex')
    for 12
  );

  update public.v2_provider_keys
    set deleted_at = now()
    where user_id = v_user and provider = p_provider and deleted_at is null;

  v_secret_id := vault.create_secret(
    p_key,
    v_user::text || ':' || p_provider || ':' || extract(epoch from now())::text,
    'Cheatcode V2 BYOK provider key'
  );

  insert into public.v2_provider_keys (user_id, provider, vault_secret_id, fingerprint)
    values (v_user, p_provider, v_secret_id, v_fingerprint)
    returning id into v_row_id;

  delete from vault.secrets where id = any(v_old_secret_ids);
  return v_row_id;
end $$;

create or replace function delete_provider_key(p_provider text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := public.current_app_user();
  v_secret_ids uuid[];
begin
  select coalesce(array_agg(vault_secret_id), '{}'::uuid[])
    into v_secret_ids
  from public.v2_provider_keys
  where user_id = v_user and provider = p_provider;

  update public.v2_provider_keys
    set deleted_at = coalesce(deleted_at, now())
    where user_id = v_user and provider = p_provider;

  delete from vault.secrets where id = any(v_secret_ids);
end $$;

create or replace function delete_all_provider_keys()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := public.current_app_user();
  v_secret_ids uuid[];
  v_deleted_count integer;
begin
  select coalesce(array_agg(vault_secret_id), '{}'::uuid[]), count(*)::integer
    into v_secret_ids, v_deleted_count
  from public.v2_provider_keys
  where user_id = v_user;

  update public.v2_provider_keys
    set deleted_at = coalesce(deleted_at, now())
    where user_id = v_user;

  delete from vault.secrets where id = any(v_secret_ids);
  return v_deleted_count;
end $$;

revoke all on function
  public.set_provider_key(text, text),
  public.delete_provider_key(text),
  public.delete_all_provider_keys()
from public, app_worker;

grant execute on function
  public.set_provider_key(text, text),
  public.delete_provider_key(text),
  public.delete_all_provider_keys()
to app_worker;
