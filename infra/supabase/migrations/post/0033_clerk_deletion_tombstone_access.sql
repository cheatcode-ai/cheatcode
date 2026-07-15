alter table public.v2_deleted_clerk_identities enable row level security;

create policy v2_deleted_clerk_identities_select
  on public.v2_deleted_clerk_identities
  for select
  to app_worker
  using (true);

create policy v2_deleted_clerk_identities_insert
  on public.v2_deleted_clerk_identities
  for insert
  to app_worker
  with check (clerk_identity_hash ~ '^[0-9a-f]{64}$');

revoke all on table public.v2_deleted_clerk_identities from app_worker;
grant select, insert on table public.v2_deleted_clerk_identities to app_worker;
