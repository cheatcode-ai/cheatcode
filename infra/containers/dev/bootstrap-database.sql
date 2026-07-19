\set ON_ERROR_STOP on

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'supabase_admin') then
    create role supabase_admin nologin superuser createdb createrole replication bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
end
$$;

alter role supabase_admin with nologin superuser createdb createrole replication bypassrls;
alter role service_role with nologin noinherit nosuperuser nocreatedb nocreaterole noreplication bypassrls;
alter role anon with nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
alter role authenticated with nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;

create schema if not exists extensions;
create schema if not exists vault;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_stat_statements with schema extensions;
create extension if not exists vector with schema extensions;
create extension if not exists supabase_vault with schema vault;

select pg_catalog.set_config(
  'cheatcode.bootstrap_context_secret_agent',
  :'database_context_signing_secret_agent',
  false
) as bootstrap_context_secret_agent
\gset
select pg_catalog.set_config(
  'cheatcode.bootstrap_context_secret_gateway',
  :'database_context_signing_secret_gateway',
  false
) as bootstrap_context_secret_gateway
\gset
select pg_catalog.set_config(
  'cheatcode.bootstrap_context_secret_webhooks',
  :'database_context_signing_secret_webhooks',
  false
) as bootstrap_context_secret_webhooks
\gset

do $$
declare
  context_secret text;
  expected_description text;
  expected_name text;
  expected_role text;
  existing_id uuid;
  matching_secrets integer;
begin
  foreach expected_role in array array['app_agent', 'app_gateway', 'app_webhooks']
  loop
    context_secret := pg_catalog.current_setting(
      'cheatcode.bootstrap_context_secret_' || pg_catalog.replace(expected_role, 'app_', '')
    );
    expected_name := 'cheatcode-database-context-' ||
      pg_catalog.replace(expected_role, '_', '-') || '-v1';
    expected_description := 'Cheatcode signed tenant context HMAC for ' || expected_role;
    if pg_catalog.octet_length(context_secret) < 32 then
      raise exception '% signing secret must contain at least 32 bytes', expected_role;
    end if;

    select count(*) into matching_secrets
      from vault.secrets
     where name = expected_name;
    existing_id := null;
    select id into existing_id
      from vault.secrets
     where name = expected_name
     limit 1;

    if matching_secrets > 1 then
      raise exception 'duplicate % Vault secrets', expected_name;
    elsif existing_id is null then
      perform vault.create_secret(context_secret, expected_name, expected_description);
    else
      perform vault.update_secret(
        existing_id,
        context_secret,
        expected_name,
        expected_description
      );
    end if;
  end loop;
end
$$;

reset cheatcode.bootstrap_context_secret_agent;
reset cheatcode.bootstrap_context_secret_gateway;
reset cheatcode.bootstrap_context_secret_webhooks;

select format(
  'create role app_gateway login password %L noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls',
  :'app_gateway_password'
)
where not exists (select 1 from pg_roles where rolname = 'app_gateway')
\gexec

select format(
  'alter role app_gateway with login password %L noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls',
  :'app_gateway_password'
)
\gexec

select format(
  'create role app_agent login password %L noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls',
  :'app_agent_password'
)
where not exists (select 1 from pg_roles where rolname = 'app_agent')
\gexec

select format(
  'alter role app_agent with login password %L noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls',
  :'app_agent_password'
)
\gexec

select format(
  'create role app_webhooks login password %L noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls',
  :'app_webhooks_password'
)
where not exists (select 1 from pg_roles where rolname = 'app_webhooks')
\gexec

select format(
  'alter role app_webhooks with login password %L noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls',
  :'app_webhooks_password'
)
\gexec

do $$
declare
  role_finalization_applied boolean := false;
begin
  if pg_catalog.to_regclass('public._raw_migrations') is not null then
    execute
      'select exists (
         select 1
           from public._raw_migrations
          where filename =
            ''infra/supabase/migrations/post/0059_finalize_worker_database_roles.sql''
       )'
      into role_finalization_applied;
  end if;

  if not role_finalization_applied
     and not exists (select 1 from pg_roles where rolname = 'app_worker') then
    create role app_worker nologin noinherit nocreatedb nocreaterole;
  end if;

  if exists (select 1 from pg_roles where rolname = 'app_worker') then
    alter role app_worker
      with nologin password null noinherit nosuperuser nocreatedb nocreaterole
      noreplication nobypassrls;
  end if;
end
$$;
