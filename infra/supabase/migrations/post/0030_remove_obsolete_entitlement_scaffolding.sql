-- Contract only after every Worker reads the reduced entitlement projection.
-- DROP remains non-CASCADE so unexpected dependencies stop for review.
alter table if exists public.v2_entitlements
  drop column if exists max_concurrent_sandboxes,
  drop column if exists max_seats,
  drop column if exists quota_deployments,
  drop column if exists flag_private_projects,
  drop column if exists flag_sso;
