create or replace function current_app_user() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v uuid;
begin
  v := nullif(current_setting('app.user_id', true), '')::uuid;
  if v is null then
    raise exception 'app.user_id not set - refusing BYOK operation';
  end if;
  return v;
end $$;

create or replace function set_provider_key(p_provider text, p_key text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := public.current_app_user();
  v_secret_id uuid;
  v_fingerprint text;
  v_row_id uuid;
begin
  v_fingerprint := substring(
    encode(extensions.digest(convert_to(p_key, 'UTF8'), 'sha256'), 'hex')
    for 12
  );
  update public.v2_provider_keys
    set deleted_at = now()
    where user_id = v_user and provider = p_provider and deleted_at is null;
  insert into vault.secrets (secret, name)
    values (p_key, v_user::text || ':' || p_provider || ':' || extract(epoch from now())::text)
    returning id into v_secret_id;
  insert into public.v2_provider_keys (user_id, provider, vault_secret_id, fingerprint)
    values (v_user, p_provider, v_secret_id, v_fingerprint)
    returning id into v_row_id;
  return v_row_id;
end $$;

create or replace function get_provider_key(p_provider text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := public.current_app_user();
  v_key text;
  v_row_id uuid;
begin
  select pk.id, ds.decrypted_secret into v_row_id, v_key
  from public.v2_provider_keys pk
  join vault.decrypted_secrets ds on ds.id = pk.vault_secret_id
  where pk.user_id = v_user
    and pk.provider = p_provider
    and pk.deleted_at is null
    and pk.disabled_at is null
  order by pk.created_at desc
  limit 1;
  if v_row_id is not null then
    update public.v2_provider_keys set last_used_at = now() where id = v_row_id;
  end if;
  return v_key;
end $$;

create or replace function delete_provider_key(p_provider text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := public.current_app_user();
  v_secret_id uuid;
begin
  select vault_secret_id into v_secret_id
  from public.v2_provider_keys
  where user_id = v_user and provider = p_provider and deleted_at is null;
  if v_secret_id is not null then
    update public.v2_provider_keys set deleted_at = now()
      where user_id = v_user and provider = p_provider;
    delete from vault.secrets where id = v_secret_id;
  end if;
end $$;

revoke all on function
  public.current_app_user(),
  public.set_provider_key(text, text),
  public.get_provider_key(text),
  public.delete_provider_key(text)
from public, app_worker;

grant execute on function
  public.set_provider_key(text, text),
  public.get_provider_key(text),
  public.delete_provider_key(text)
to app_worker;
