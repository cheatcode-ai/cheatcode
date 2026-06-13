create schema if not exists extensions;

create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists supabase_vault with schema extensions;
create extension if not exists moddatetime with schema extensions;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_worker') then
    create role app_worker login password 'app_worker' nobypassrls;
  end if;
end $$;

grant usage on schema public, extensions to app_worker;

alter default privileges in schema public revoke execute on functions from public;
