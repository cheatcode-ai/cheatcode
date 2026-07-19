do $dependency$
begin
  if not exists (
    select 1
      from public._raw_migrations
     where filename = 'infra/supabase/migrations/post/0057_enforce_permanent_v2_integrity.sql'
  ) then
    raise exception 'worker role finalization requires post/0057';
  end if;
  if not exists (
    select 1
      from public._raw_migrations
     where filename = 'infra/supabase/migrations/post/0058_expand_worker_database_roles.sql'
  ) then
    raise exception 'worker role finalization requires pre-deploy post/0058';
  end if;
  if pg_catalog.to_regprocedure(
    'public._configure_v2_worker_role_access(boolean,boolean)'
  ) is null then
    raise exception 'worker role finalization requires the pre/0007 role helper';
  end if;
end
$dependency$;

-- Managed Supabase migration administrators cannot ALTER superuser-only role
-- attributes, including their negative forms. Fail closed if manual role
-- provisioning violated the restricted defaults.
do $restricted_attributes$
begin
  if exists (
    select 1
      from pg_roles
     where rolname in ('app_worker', 'app_gateway', 'app_agent', 'app_webhooks')
       and (rolsuper or rolreplication or rolbypassrls)
  ) then
    raise exception 'worker runtime roles must not be superuser, replication, or bypassrls roles';
  end if;
end
$restricted_attributes$;

-- The drain and closed reconciliation are complete, pre/0058 prepared the
-- dedicated identities, and the release remains closed while this finalizer
-- runs. Reset the reviewed matrix and drop the transition identity before the
-- OPEN Workers connect through their dedicated Hyperdrives.
select public._configure_v2_worker_role_access(true, false);

drop function public._configure_v2_worker_role_access(boolean, boolean);
drop function if exists public._configure_v2_worker_role_access(boolean);

-- PUBLIC schema usage would otherwise leak into Supabase Data API roles despite
-- their direct ACLs being empty.
revoke all on schema public from public;
grant usage on schema public to app_gateway, app_agent, app_webhooks;

alter role app_gateway
  with login noinherit nocreatedb nocreaterole;
alter role app_agent
  with login noinherit nocreatedb nocreaterole;
alter role app_webhooks
  with login noinherit nocreatedb nocreaterole;
alter role app_worker
  with nologin password null noinherit nocreatedb nocreaterole;

alter role app_gateway set search_path = public, pg_catalog;
alter role app_agent set search_path = public, pg_catalog;
alter role app_webhooks set search_path = public, pg_catalog;
alter role app_worker reset search_path;

-- Recheck active-role membership at the irreversible boundary in case an
-- operator granted a role during the staged release window. Keep the migration
-- administrator's ADMIN OPTION on app_worker until DROP ROLE; PostgreSQL removes
-- memberships involving the dropped role atomically.
do $memberships$
declare
  membership record;
begin
  for membership in
    select granted.rolname as granted_role, member.rolname as member_role
      from pg_auth_members relation
      join pg_roles granted on granted.oid = relation.roleid
      join pg_roles member on member.oid = relation.member
     where granted.rolname in ('app_gateway', 'app_agent', 'app_webhooks')
        or member.rolname in ('app_gateway', 'app_agent', 'app_webhooks')
  loop
    execute format('revoke %I from %I', membership.granted_role, membership.member_role);
  end loop;
end
$memberships$;

-- Future migration-owned objects remain closed until a reviewed migration
-- grants one service the exact operation it needs.
alter default privileges for role postgres
  revoke all privileges on tables from app_worker, app_gateway, app_agent, app_webhooks;
alter default privileges for role postgres
  revoke all privileges on sequences from app_worker, app_gateway, app_agent, app_webhooks;
alter default privileges for role postgres
  revoke all privileges on functions from app_worker, app_gateway, app_agent, app_webhooks;
alter default privileges for role postgres in schema public
  revoke all privileges on tables from app_worker, app_gateway, app_agent, app_webhooks;
alter default privileges for role postgres in schema public
  revoke all privileges on sequences from app_worker, app_gateway, app_agent, app_webhooks;
alter default privileges for role postgres in schema public
  revoke all privileges on functions from app_worker, app_gateway, app_agent, app_webhooks;

-- Never use DROP OWNED here: an unexpected legacy dependency is a release
-- defect, not permission to cascade production objects. pg_shdepend is the
-- cluster-wide source of ownership, ACL, initial-ACL, and policy references to
-- roles. Assert it is empty after the explicit revokes, then let DROP ROLE
-- repeat PostgreSQL's own dependency check while removing role memberships.
do $legacy_role_dependencies$
declare
  dependency_count bigint;
  dependency_summary text;
  legacy_role_oid oid;
begin
  select oid into strict legacy_role_oid
    from pg_roles
   where rolname = 'app_worker';

  select
    count(*),
    pg_catalog.string_agg(
      pg_catalog.format(
        'database=%s catalog=%s object=%s subobject=%s type=%s',
        coalesce(database_record.datname::text, '<shared>'),
        dependency.classid::regclass::text,
        dependency.objid,
        dependency.objsubid,
        dependency.deptype
      ),
      '; ' order by dependency.dbid, dependency.classid,
        dependency.objid, dependency.objsubid, dependency.deptype
    )
    into dependency_count, dependency_summary
    from pg_catalog.pg_shdepend dependency
    left join pg_catalog.pg_database database_record
      on database_record.oid = dependency.dbid
   where dependency.refclassid = 'pg_catalog.pg_authid'::regclass
     and dependency.refobjid = legacy_role_oid;

  if dependency_count <> 0 then
    raise exception
      'app_worker still has % unexpected cluster dependencies: %',
      dependency_count,
      dependency_summary;
  end if;
end
$legacy_role_dependencies$;

drop role app_worker;
