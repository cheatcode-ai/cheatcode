-- These extensions have no surviving application or platform dependency after
-- the V2 cleanup. RESTRICT is intentional: unexpected managed dependencies
-- must stop the release for review. `vector` remains because Supabase's managed
-- storage.vector_indexes relation depends on its public.vector type. `pg_cron`
-- remains as the database-owned audit-partition scheduler.
create extension if not exists pg_cron;

drop extension if exists moddatetime restrict;
drop extension if exists pg_trgm restrict;
drop extension if exists "uuid-ossp" restrict;
drop extension if exists wrappers restrict;

do $vector_schema$
begin
  if exists (
    select 1
      from pg_extension extension
      join pg_namespace namespace on namespace.oid = extension.extnamespace
     where extension.extname = 'vector'
       and namespace.nspname <> 'extensions'
  ) then
    execute 'alter extension vector set schema extensions';
  end if;
end
$vector_schema$;
