alter table if exists public.v2_projects
  add column if not exists over_quota boolean not null default false,
  add column if not exists archived_pending_action boolean not null default false,
  add column if not exists archive_after timestamptz;

alter table if exists public.v2_provider_keys
  add column if not exists disabled_at timestamptz,
  add column if not exists disabled_reason text;

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

revoke all on function public.get_provider_key(text) from public, app_worker;
grant execute on function public.get_provider_key(text) to app_worker;
