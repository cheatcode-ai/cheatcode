-- Run only after the hard-delete BYOK release is live. Historical tombstones
-- are database-only state; install the managed-Vault-compatible hard-delete
-- trigger before removing those rows so their encrypted payloads cannot remain.
create or replace function public.v2_delete_provider_vault_secret() returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  secret_name text;
  secret_description text;
begin
  delete from vault.secrets
   where id = old.vault_secret_id
  returning name, description into secret_name, secret_description;

  if not found then
    raise exception 'refusing to delete a provider key with a missing Vault secret';
  end if;
  if secret_name not like old.user_id::text || ':' || old.provider || ':%'
     or secret_description is distinct from 'Cheatcode V2 BYOK provider key' then
    raise exception 'refusing to delete a provider key with mismatched Vault ownership metadata';
  end if;
  return old;
end
$function$;

delete from public.v2_provider_keys where deleted_at is not null;

do $vault_contract$
declare
  invalid_count bigint;
begin
  select count(*)
    into invalid_count
    from public.v2_provider_keys key
    left join vault.secrets secret on secret.id = key.vault_secret_id
   where secret.id is null
      or secret.name not like key.user_id::text || ':' || key.provider || ':%'
      or secret.description is distinct from 'Cheatcode V2 BYOK provider key';
  if invalid_count > 0 then
    raise exception
      'BYOK contraction refused: % provider keys lack an exact owned Vault secret',
      invalid_count;
  end if;

  select count(*)
    into invalid_count
    from vault.secrets secret
   where secret.description = 'Cheatcode V2 BYOK provider key'
     and not exists (
       select 1
         from public.v2_provider_keys key
        where key.vault_secret_id = secret.id
     );
  if invalid_count > 0 then
    raise exception
      'BYOK contraction refused: % unreferenced Cheatcode Vault secrets require review',
      invalid_count;
  end if;
end
$vault_contract$;

drop function public.set_provider_key(text, text);

create function public.set_provider_key(p_provider text, p_key text) returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := public.current_app_user();
  secret_id uuid;
  key_fingerprint text;
begin
  if p_provider is null or p_provider not in (
    'anthropic',
    'openai',
    'google',
    'openrouter',
    'deepseek',
    'exa',
    'firecrawl',
    'llamaparse'
  ) then
    raise exception 'unsupported provider';
  end if;
  if p_key is null or btrim(p_key) = '' or octet_length(p_key) > 65536 then
    raise exception 'provider key must contain between 1 and 65536 bytes';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'cheatcode:provider-keys:' || actor_id::text,
      0
    )
  );

  key_fingerprint := substring(
    encode(extensions.digest(convert_to(p_key, 'UTF8'), 'sha256'), 'hex')
    for 12
  );

  delete from public.v2_provider_keys
   where user_id = actor_id and provider = p_provider;

  secret_id := vault.create_secret(
    p_key,
    actor_id::text || ':' || p_provider || ':' || public.uuidv7()::text,
    'Cheatcode V2 BYOK provider key'
  );

  insert into public.v2_provider_keys (
    user_id,
    provider,
    vault_secret_id,
    fingerprint
  ) values (
    actor_id,
    p_provider,
    secret_id,
    key_fingerprint
  );
end
$function$;

create or replace function public.get_provider_key(p_provider text) returns text
language sql
stable
security definer
set search_path = ''
as $function$
  select secret.decrypted_secret
    from public.v2_provider_keys key
    join vault.decrypted_secrets secret on secret.id = key.vault_secret_id
   where key.user_id = public.current_app_user()
     and key.provider = p_provider
     and key.disabled_at is null
$function$;

create or replace function public.delete_provider_key(p_provider text) returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := public.current_app_user();
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'cheatcode:provider-keys:' || actor_id::text,
      0
    )
  );
  delete from public.v2_provider_keys
   where user_id = actor_id and provider = p_provider;
end
$function$;

create or replace function public.delete_all_provider_keys() returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := public.current_app_user();
  deleted_count integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'cheatcode:provider-keys:' || actor_id::text,
      0
    )
  );
  delete from public.v2_provider_keys where user_id = actor_id;
  get diagnostics deleted_count = row_count;
  return deleted_count;
end
$function$;

create or replace function public.claim_provider_key_revalidation_targets(p_limit integer)
returns table (user_id uuid, provider text, fingerprint text, lease_token uuid)
language sql
security definer
set search_path = ''
as $function$
  with targets as (
    select key.user_id, key.provider
      from public.v2_provider_keys key
     where key.disabled_at is null
       and (
         key.last_revalidated_at is null
         or key.last_revalidated_at < pg_catalog.now() - interval '23 hours'
       )
       and (
         key.revalidation_claimed_at is null
         or key.revalidation_claimed_at < pg_catalog.now() - interval '15 minutes'
       )
     order by
       key.last_revalidated_at asc nulls first,
       key.revalidation_claimed_at asc nulls first,
       key.created_at,
       key.user_id,
       key.provider
     for update skip locked
     limit least(greatest(coalesce(p_limit, 10), 1), 10)
  ), claimed as (
    update public.v2_provider_keys key
       set revalidation_claimed_at = pg_catalog.now(),
           revalidation_lease_token = public.uuidv7()
      from targets
     where key.user_id = targets.user_id
       and key.provider = targets.provider
    returning key.user_id, key.provider, key.fingerprint, key.revalidation_lease_token
  )
  select claimed.user_id, claimed.provider, claimed.fingerprint, claimed.revalidation_lease_token
    from claimed
$function$;

drop function public.list_provider_key_revalidation_targets(integer);

create or replace function public.v2_audit_provider_key_change() returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  audit_action text;
begin
  if tg_op = 'UPDATE'
     and (to_jsonb(new) - array[
       'last_revalidated_at',
       'revalidation_claimed_at',
       'revalidation_lease_token'
     ]) is not distinct from (to_jsonb(old) - array[
       'last_revalidated_at',
       'revalidation_claimed_at',
       'revalidation_lease_token'
     ]) then
    return new;
  end if;

  audit_action := case
    when tg_op = 'INSERT' then 'provider_key.create'
    when tg_op = 'DELETE' then 'provider_key.delete'
    when old.disabled_at is null and new.disabled_at is not null then 'provider_key.disable'
    when old.disabled_at is not null and new.disabled_at is null then 'provider_key.enable'
    else 'provider_key.update'
  end;

  insert into public.v2_audit_log (
    user_id,
    action,
    resource_type,
    resource_id,
    metadata
  ) values (
    coalesce(new.user_id, old.user_id),
    audit_action,
    'provider_key',
    coalesce(new.provider, old.provider),
    jsonb_build_object('fingerprint', coalesce(new.fingerprint, old.fingerprint))
  );
  return coalesce(new, old);
end
$function$;

alter table public.v2_provider_keys
  drop constraint v2_provider_keys_pkey;

drop index if exists public.v2_provider_keys_user_provider_idx;

alter table public.v2_provider_keys
  drop column id,
  drop column last_used_at,
  drop column deleted_at,
  add constraint v2_provider_keys_pkey primary key (user_id, provider);

drop policy if exists v2_provider_keys_select_own on public.v2_provider_keys;
drop policy if exists v2_provider_keys_insert_own on public.v2_provider_keys;
drop policy if exists v2_provider_keys_update_own on public.v2_provider_keys;
drop policy if exists v2_provider_keys_delete_own on public.v2_provider_keys;

create policy v2_provider_keys_select_own
  on public.v2_provider_keys
  for select
  to app_worker
  using (user_id::text = (select current_setting('app.user_id', true)));

create policy v2_provider_keys_update_own
  on public.v2_provider_keys
  for update
  to app_worker
  using (user_id::text = (select current_setting('app.user_id', true)))
  with check (user_id::text = (select current_setting('app.user_id', true)));

revoke all on table public.v2_provider_keys from app_worker;
grant select on table public.v2_provider_keys to app_worker;
grant update (
  disabled_at,
  disabled_reason,
  last_revalidated_at,
  revalidation_claimed_at,
  revalidation_lease_token
) on table public.v2_provider_keys to app_worker;

revoke all on function
  public.set_provider_key(text, text),
  public.get_provider_key(text),
  public.delete_provider_key(text),
  public.delete_all_provider_keys(),
  public.claim_provider_key_revalidation_targets(integer)
from app_worker;

grant execute on function
  public.set_provider_key(text, text),
  public.get_provider_key(text),
  public.delete_provider_key(text),
  public.delete_all_provider_keys(),
  public.claim_provider_key_revalidation_targets(integer)
to app_worker;

-- Custom skills have no external payload. Their only historical tombstone is
-- safe to remove before enforcing the canonical full unique key.
delete from public.v2_user_skills where deleted_at is not null;

drop index if exists public.v2_user_skills_user_name_idx;
drop index if exists public.v2_user_skills_user_idx;

alter table public.v2_user_skills drop column deleted_at;

create unique index v2_user_skills_user_name_idx
  on public.v2_user_skills (user_id, name);

-- Audit events are an operational sink. Application reads and the generic
-- append escape hatch are intentionally removed; only narrow trigger/RPC writes
-- remain.
drop policy if exists v2_audit_log_select_own on public.v2_audit_log;
drop policy if exists v2_audit_log_insert_system on public.v2_audit_log;
revoke all on table public.v2_audit_log from app_worker;
drop function public.append_v2_audit_event(text, text, text, jsonb);

alter table public.v2_audit_log
  drop column ip_address,
  drop column user_agent;
