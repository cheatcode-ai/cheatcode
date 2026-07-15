-- Daytona owns the persistent per-user workspace. No live V2 code reads or writes
-- the superseded directory-backup handle, so remove it only after matching Workers
-- have been deployed and verified.
alter table public.v2_projects
  drop column if exists container_backup;
