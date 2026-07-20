-- Keep the old Worker RPC signatures live during the release window while
-- making Vault ownership, revalidation claims, and direct-table access strict.

do $preflight$
declare
  invalid_count bigint;
begin
  select count(*)
    into invalid_count
    from public.v2_provider_keys key
    left join vault.secrets secret on secret.id = key.vault_secret_id
   where key.deleted_at is null
     and (
       secret.id is null
       or secret.name not like key.user_id::text || ':' || key.provider || ':%'
     );
  if invalid_count > 0 then
    raise exception
      'BYOK preflight failed: % live provider keys lack their own Vault secret',
      invalid_count;
  end if;

  select count(*)
    into invalid_count
    from public.v2_provider_keys key
    join vault.secrets secret on secret.id = key.vault_secret_id
   where secret.name not like key.user_id::text || ':' || key.provider || ':%';
  if invalid_count > 0 then
    raise exception
      'BYOK preflight failed: % provider keys reference a Vault secret with mismatched ownership metadata',
      invalid_count;
  end if;

  select count(*)
    into invalid_count
    from (
      select vault_secret_id
        from public.v2_provider_keys
       group by vault_secret_id
      having count(*) > 1
    ) duplicate_references;
  if invalid_count > 0 then
    raise exception
      'BYOK preflight failed: % Vault secrets are referenced by multiple provider-key rows',
      invalid_count;
  end if;
end
$preflight$;

-- The user/provider-prefixed name is the ownership proof. Normalize only those
-- verified references so the deletion trigger can require one exact marker.
-- Supabase Vault intentionally withholds direct UPDATE access from its
-- migration role. Use the extension's SECURITY DEFINER API so this remains
-- compatible with managed Vault while preserving the ownership preflight.
do $normalize_vault_descriptions$
declare
  provider_secret_id uuid;
begin
  for provider_secret_id in
    select secret.id
      from public.v2_provider_keys key
      join vault.secrets secret on secret.id = key.vault_secret_id
     where secret.name like key.user_id::text || ':' || key.provider || ':%'
       and secret.description is distinct from 'Cheatcode V2 BYOK provider key'
  loop
    perform vault.update_secret(
      provider_secret_id,
      new_description => 'Cheatcode V2 BYOK provider key'
    );
  end loop;
end
$normalize_vault_descriptions$;

create unique index v2_provider_keys_vault_secret_uidx
  on public.v2_provider_keys (vault_secret_id);

create index if not exists v2_provider_keys_revalidation_idx
  on public.v2_provider_keys (
    last_revalidated_at nulls first,
    created_at,
    user_id,
    provider
  )
  where disabled_at is null;

do $constraint$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.v2_provider_keys'::regclass
       and conname = 'v2_provider_keys_disabled_pair_check'
  ) then
    alter table public.v2_provider_keys
      add constraint v2_provider_keys_disabled_pair_check
      check (
        (disabled_at is null and disabled_reason is null)
        or (disabled_at is not null and disabled_reason is not null)
      )
      not valid;
  end if;
end
$constraint$;

alter table public.v2_provider_keys
  validate constraint v2_provider_keys_disabled_pair_check;

create or replace function public.v2_delete_provider_vault_secret() returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  secret_name text;
  secret_description text;
begin
  select secret.name, secret.description
    into secret_name, secret_description
    from vault.secrets secret
   where secret.id = old.vault_secret_id
   for update;

  if not found then
    -- Historical soft-deletes already removed their Vault payload. A missing
    -- payload for a live row is corruption and must never be hidden.
    if old.deleted_at is null then
      raise exception 'refusing to delete a live provider key with a missing Vault secret';
    end if;
    return old;
  end if;

  if secret_name not like old.user_id::text || ':' || old.provider || ':%'
     or secret_description is distinct from 'Cheatcode V2 BYOK provider key' then
    raise exception 'refusing to delete a provider key with mismatched Vault ownership metadata';
  end if;

  delete from vault.secrets where id = old.vault_secret_id;
  if not found then
    raise exception 'provider Vault secret disappeared while it was locked for deletion';
  end if;
  return old;
end
$function$;

create trigger trg_v2_provider_keys_delete_vault
before delete on public.v2_provider_keys
for each row execute function public.v2_delete_provider_vault_secret();

create or replace function public.set_provider_key(p_provider text, p_key text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := public.current_app_user();
  secret_id uuid;
  key_fingerprint text;
  row_id uuid;
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
  )
  returning id into row_id;

  return row_id;
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
     and key.deleted_at is null
     and key.disabled_at is null
   order by key.created_at desc
   limit 1
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

create or replace function public.list_provider_key_revalidation_targets(p_limit integer)
returns table (user_id uuid, provider text, fingerprint text)
language sql
security definer
set search_path = ''
as $function$
  with targets as (
    select key.id
      from public.v2_provider_keys key
     where key.deleted_at is null
       and key.disabled_at is null
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
     where key.id = targets.id
    returning key.user_id, key.provider, key.fingerprint
  )
  select claimed.user_id, claimed.provider, claimed.fingerprint
    from claimed
$function$;

create or replace function public.claim_provider_key_revalidation_targets(p_limit integer)
returns table (user_id uuid, provider text, fingerprint text, lease_token uuid)
language sql
security definer
set search_path = ''
as $function$
  with targets as (
    select key.id
      from public.v2_provider_keys key
     where key.deleted_at is null
       and key.disabled_at is null
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
     where key.id = targets.id
    returning key.user_id, key.provider, key.fingerprint, key.revalidation_lease_token
  )
  select claimed.user_id, claimed.provider, claimed.fingerprint, claimed.revalidation_lease_token
    from claimed
$function$;

create or replace function public.scrub_current_user_audit() returns bigint
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := public.current_app_user();
  scrubbed_count bigint;
begin
  update public.v2_audit_log
     set user_id = null,
         resource_id = null,
         metadata = jsonb_build_object('subject_erased', true)
   where user_id = actor_id;
  get diagnostics scrubbed_count = row_count;
  return scrubbed_count;
end
$function$;

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
    when old.deleted_at is null and new.deleted_at is not null then 'provider_key.delete'
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

create or replace function public.v2_audit_integration_change() returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'UPDATE'
     and (new.status, new.is_default) is not distinct from (old.status, old.is_default) then
    return new;
  end if;

  insert into public.v2_audit_log (
    user_id,
    action,
    resource_type,
    resource_id,
    metadata
  ) values (
    coalesce(new.user_id, old.user_id),
    'integration.' || lower(tg_op),
    'integration',
    coalesce(new.integration, old.integration),
    jsonb_build_object('status', coalesce(new.status, old.status))
  );
  return coalesce(new, old);
end
$function$;

-- Supabase's Data API is not an application boundary for Cheatcode. Revoke all
-- existing public-schema access for its standard roles; dashboard disablement is
-- a separate platform switch verified during release QA.
revoke all privileges on all tables in schema public from public;
revoke all privileges on all sequences in schema public from public;

do $data_api$
declare
  role_name text;
  procedure_record record;
begin
  for role_name in
    select rolname
      from pg_roles
     where rolname in ('anon', 'authenticated', 'service_role')
  loop
    execute format(
      'revoke all privileges on all tables in schema public from %I',
      role_name
    );
    execute format(
      'revoke all privileges on all sequences in schema public from %I',
      role_name
    );
  end loop;

  for procedure_record in
    select procedure.oid::regprocedure::text as identity
      from pg_proc procedure
      join pg_namespace namespace on namespace.oid = procedure.pronamespace
      left join pg_depend extension_dependency
        on extension_dependency.classid = 'pg_proc'::regclass
       and extension_dependency.objid = procedure.oid
       and extension_dependency.deptype = 'e'
     where namespace.nspname = 'public'
       and extension_dependency.objid is null
  loop
    execute format(
      'revoke execute on function %s from public',
      procedure_record.identity
    );
    for role_name in
      select rolname
        from pg_roles
       where rolname in ('anon', 'authenticated', 'service_role')
    loop
      execute format(
        'revoke execute on function %s from %I',
        procedure_record.identity,
        role_name
      );
    end loop;
  end loop;
end
$data_api$;

-- New postgres-owned public objects must inherit the same closed Data API
-- posture. Supabase-owned defaults are platform-managed and remain untouched.
alter default privileges for role postgres revoke all on tables from public;
alter default privileges for role postgres revoke all on sequences from public;
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke all on tables from public;
alter default privileges for role postgres in schema public revoke all on sequences from public;
alter default privileges for role postgres in schema public revoke execute on functions from public;

do $default_acl$
declare
  role_name text;
begin
  for role_name in
    select rolname
      from pg_roles
     where rolname in ('anon', 'authenticated', 'service_role')
  loop
    execute format(
      'alter default privileges for role postgres revoke all on tables from %I',
      role_name
    );
    execute format(
      'alter default privileges for role postgres revoke all on sequences from %I',
      role_name
    );
    execute format(
      'alter default privileges for role postgres revoke execute on functions from %I',
      role_name
    );
    execute format(
      'alter default privileges for role postgres in schema public revoke all on tables from %I',
      role_name
    );
    execute format(
      'alter default privileges for role postgres in schema public revoke all on sequences from %I',
      role_name
    );
    execute format(
      'alter default privileges for role postgres in schema public revoke execute on functions from %I',
      role_name
    );
  end loop;
end
$default_acl$;

revoke all on table public.v2_provider_keys from app_worker;
grant select on table public.v2_provider_keys to app_worker;
grant update (
  disabled_at,
  disabled_reason,
  last_revalidated_at,
  revalidation_claimed_at,
  revalidation_lease_token
) on table public.v2_provider_keys to app_worker;

revoke all on table public.v2_audit_log from app_worker;

revoke all on schema extensions, vault from app_worker;
revoke create on schema public from app_worker;
grant usage on schema public to app_worker;

revoke all on function
  public.current_app_user(),
  public.append_v2_audit_event(text, text, text, jsonb),
  public.v2_delete_provider_vault_secret(),
  public.v2_audit_provider_key_change(),
  public.v2_audit_entitlement_change(),
  public.v2_audit_integration_change(),
  public.v2_touch_updated_at()
from app_worker;

revoke all on function
  public.uuidv7(),
  public.set_provider_key(text, text),
  public.get_provider_key(text),
  public.delete_provider_key(text),
  public.delete_all_provider_keys(),
  public.list_provider_key_revalidation_targets(integer),
  public.claim_provider_key_revalidation_targets(integer),
  public.scrub_current_user_audit()
from app_worker;

grant execute on function
  public.uuidv7(),
  public.set_provider_key(text, text),
  public.get_provider_key(text),
  public.delete_provider_key(text),
  public.delete_all_provider_keys(),
  public.list_provider_key_revalidation_targets(integer),
  public.claim_provider_key_revalidation_targets(integer),
  public.scrub_current_user_audit()
to app_worker;
