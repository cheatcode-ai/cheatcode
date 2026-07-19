create table public.v2_resource_deletion_jobs (
  id uuid primary key default public.uuidv7(),
  user_id uuid not null
    constraint v2_resource_deletion_jobs_user_id_v2_users_id_fk
    references public.v2_users(id) on delete cascade,
  kind text not null,
  resource_id uuid not null,
  generation timestamptz(3) not null,
  phase text not null default 'runs',
  cursor uuid,
  continuation integer not null default 0,
  status text not null default 'queued',
  lease_token uuid,
  lease_expires_at timestamptz(3),
  failure_count integer not null default 0,
  next_attempt_at timestamptz(3) not null default now(),
  last_error_code text,
  constraint v2_resource_deletion_jobs_kind_check
    check (kind in ('project-deletion', 'thread-deletion')),
  constraint v2_resource_deletion_jobs_phase_check
    check (phase in ('runs', 'run-objects', 'workspace', 'outputs', 'prefix', 'pointer', 'finalize')),
  constraint v2_resource_deletion_jobs_status_check
    check (status in ('queued', 'leased', 'quarantined')),
  constraint v2_resource_deletion_jobs_counter_check
    check (continuation >= 0 and failure_count >= 0),
  constraint v2_resource_deletion_jobs_lease_check
    check (
      (status = 'leased' and lease_token is not null and lease_expires_at is not null)
      or
      (status <> 'leased' and lease_token is null and lease_expires_at is null)
    )
);

create unique index v2_resource_deletion_jobs_generation_uidx
  on public.v2_resource_deletion_jobs (kind, resource_id, generation);

create index v2_resource_deletion_jobs_user_idx
  on public.v2_resource_deletion_jobs (user_id);

create index v2_resource_deletion_jobs_ready_idx
  on public.v2_resource_deletion_jobs (next_attempt_at, id)
  where status = 'queued';

create index v2_resource_deletion_jobs_lease_idx
  on public.v2_resource_deletion_jobs (lease_expires_at, id)
  where status = 'leased';

revoke all on table public.v2_resource_deletion_jobs
from public, anon, authenticated, service_role, app_worker;

grant select, insert, update, delete on table public.v2_resource_deletion_jobs to app_worker;
