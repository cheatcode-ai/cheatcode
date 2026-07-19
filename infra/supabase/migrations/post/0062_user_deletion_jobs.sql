revoke all on table public.v2_user_deletion_jobs
from public, anon, authenticated, service_role, app_gateway, app_agent, app_webhooks;

alter table public.v2_user_deletion_jobs enable row level security;
alter table public.v2_user_deletion_jobs force row level security;

create policy v2_user_deletion_jobs_postgres_all on public.v2_user_deletion_jobs
  as permissive for all to postgres using (true) with check (true);
create policy v2_user_deletion_jobs_select_own on public.v2_user_deletion_jobs
  as permissive for select to app_webhooks using (user_id = (select public.current_app_user()));
create policy v2_user_deletion_jobs_insert_own on public.v2_user_deletion_jobs
  as permissive for insert to app_webhooks with check (user_id = (select public.current_app_user()));
create policy v2_user_deletion_jobs_update_own on public.v2_user_deletion_jobs
  as permissive for update to app_webhooks
  using (user_id = (select public.current_app_user()))
  with check (user_id = (select public.current_app_user()));
create policy v2_user_deletion_jobs_delete_own on public.v2_user_deletion_jobs
  as permissive for delete to app_webhooks using (user_id = (select public.current_app_user()));

grant select, insert, delete on table public.v2_user_deletion_jobs to app_webhooks;
grant update (
  continuation,
  cursor,
  failure_count,
  last_error_code,
  lease_expires_at,
  lease_token,
  next_attempt_at,
  phase,
  status
) on table public.v2_user_deletion_jobs to app_webhooks;

create or replace function public.webhooks_discover_user_deletion_jobs(
  p_before timestamp with time zone,
  p_limit integer
)
returns integer
language plpgsql security definer set search_path = ''
as $function$
declare
  discovered integer;
  page_size integer := greatest(1, least(coalesce(p_limit, 1), 25));
begin
  if p_before is null then
    raise exception 'invalid user-deletion discovery cutoff';
  end if;
  if not pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtextextended('cheatcode:database-maintenance:v1', 0)
  ) then
    return 0;
  end if;
  with candidates as (
    select app_user.id, app_user.deleted_at
      from public.v2_users app_user
     where app_user.deleted_at <= p_before
       and (
         app_user.deletion_fence is null
         or app_user.deletion_fence =
           ((extract(epoch from app_user.deleted_at) * 1000)::bigint)::text
       )
       and not exists (
         select 1
           from public.v2_user_deletion_jobs existing
          where existing.user_id = app_user.id
            and existing.generation = app_user.deleted_at
       )
     order by app_user.deleted_at, app_user.id
     limit page_size
  ), inserted as (
    insert into public.v2_user_deletion_jobs (user_id, generation)
    select candidate.id, candidate.deleted_at
      from candidates candidate
    on conflict (user_id, generation) do nothing
    returning id
  )
  select count(*)::integer into discovered from inserted;
  return discovered;
end
$function$;

create or replace function public.webhooks_claim_ready_user_deletion_jobs(
  p_lease_token uuid,
  p_limit integer,
  p_max_failures integer,
  p_now timestamp with time zone
)
returns table (disposition text, job_id uuid, user_id uuid, continuation integer)
language plpgsql security definer set search_path = ''
as $function$
declare
  candidate record;
  expected_fence text;
  page_size integer := greatest(1, least(coalesce(p_limit, 1), 25));
begin
  if p_lease_token is null or p_now is null or p_max_failures is null
    or p_max_failures < 1 then
    raise exception 'invalid user-deletion claim input';
  end if;
  if not pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtextextended('cheatcode:database-maintenance:v1', 0)
  ) then
    return;
  end if;
  for candidate in
    select job.id, job.user_id, job.generation, job.continuation,
           job.failure_count, job.status
      from public.v2_user_deletion_jobs job
     where (job.status = 'queued' and job.next_attempt_at <= p_now)
        or (job.status = 'leased' and job.lease_expires_at <= p_now)
     order by job.next_attempt_at, job.id
     limit page_size
     for update skip locked
  loop
    expected_fence :=
      ((extract(epoch from candidate.generation) * 1000)::bigint)::text;
    update public.v2_users app_user
       set deletion_fence = expected_fence
     where app_user.id = candidate.user_id
       and app_user.deleted_at = candidate.generation
       and (
         app_user.deletion_fence is null
         or app_user.deletion_fence = expected_fence
       );
    if not found then
      delete from public.v2_user_deletion_jobs job where job.id = candidate.id;
      return query select 'stale'::text, candidate.id, candidate.user_id,
        candidate.continuation;
    elsif candidate.status = 'leased'
      and candidate.failure_count + 1 >= p_max_failures then
      return query
      update public.v2_user_deletion_jobs job
         set continuation = job.continuation + 1,
             failure_count = job.failure_count + 1,
             last_error_code = 'user_deletion_lease_expired',
             lease_expires_at = null,
             lease_token = null,
             status = 'quarantined'
       where job.id = candidate.id
      returning 'quarantined'::text, job.id, job.user_id, job.continuation;
    else
      return query
      update public.v2_user_deletion_jobs job
         set continuation = case when candidate.status = 'leased'
               then job.continuation + 1 else job.continuation end,
             failure_count = case when candidate.status = 'leased'
               then job.failure_count + 1 else job.failure_count end,
             last_error_code = case when candidate.status = 'leased'
               then 'user_deletion_lease_expired' else job.last_error_code end,
             lease_expires_at = p_now + interval '2 hours',
             lease_token = p_lease_token,
             next_attempt_at = case when candidate.status = 'leased'
               then p_now else job.next_attempt_at end,
             status = 'leased'
       where job.id = candidate.id
      returning 'leased'::text, job.id, job.user_id, job.continuation;
    end if;
  end loop;
end
$function$;

alter function public.webhooks_discover_user_deletion_jobs(timestamp with time zone, integer)
owner to postgres;
alter function public.webhooks_claim_ready_user_deletion_jobs(
  uuid,
  integer,
  integer,
  timestamp with time zone
) owner to postgres;

revoke all on function
  public.webhooks_discover_user_deletion_jobs(timestamp with time zone, integer),
  public.webhooks_claim_ready_user_deletion_jobs(uuid, integer, integer, timestamp with time zone)
from public, app_gateway, app_agent, app_webhooks;

grant execute on function
  public.webhooks_discover_user_deletion_jobs(timestamp with time zone, integer),
  public.webhooks_claim_ready_user_deletion_jobs(uuid, integer, integer, timestamp with time zone)
to app_webhooks;
