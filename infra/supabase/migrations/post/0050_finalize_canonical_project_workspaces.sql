-- The release-owned workspace reconciliation Workflow must complete while the
-- gateway is closed before this contraction runs. The migration never renames
-- a live folder or rewrites a project path; it verifies the generic invariant
-- across every remaining row and makes that invariant permanent.
do $preflight$
declare
  noncanonical_count bigint;
begin
  select count(*)
    into noncanonical_count
    from public.v2_projects project
   where not (
       octet_length(project.workspace_slug) between 38 and 64
       and right(project.workspace_slug, 37) = '-' || project.id::text
       and left(project.workspace_slug, length(project.workspace_slug) - 37)
         ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
     );

  if noncanonical_count > 0 then
    raise exception
      'canonical workspace reconciliation is incomplete for % projects',
      noncanonical_count;
  end if;
end
$preflight$;

alter table public.v2_projects
  add constraint v2_projects_workspace_slug_canonical_check
  check (
    octet_length(workspace_slug) between 38 and 64
    and right(workspace_slug, 37) = '-' || id::text
    and left(workspace_slug, length(workspace_slug) - 37)
      ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  )
  not valid;

alter table public.v2_projects
  validate constraint v2_projects_workspace_slug_canonical_check;
