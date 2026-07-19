alter table public.v2_user_deletion_refund_intents owner to postgres;

revoke all on table public.v2_user_deletion_refund_intents
from public, anon, authenticated, service_role, app_gateway, app_agent, app_webhooks;

alter table public.v2_user_deletion_refund_intents enable row level security;
alter table public.v2_user_deletion_refund_intents force row level security;

create policy v2_user_deletion_refund_intents_postgres_all
on public.v2_user_deletion_refund_intents
as permissive for all to postgres using (true) with check (true);

create policy v2_user_deletion_refund_intents_select_own
on public.v2_user_deletion_refund_intents
as permissive for select to app_webhooks
using (user_id = (select public.current_app_user()));

grant select on table public.v2_user_deletion_refund_intents to app_webhooks;

create or replace function public.webhooks_reserve_user_deletion_refund_intent(
  p_job_id uuid,
  p_generation timestamp with time zone,
  p_continuation integer,
  p_lease_token uuid,
  p_cursor text,
  p_order_id text,
  p_amount integer,
  p_currency text
)
returns table (
  job_id uuid,
  user_id uuid,
  generation timestamp with time zone,
  order_id text,
  amount integer,
  currency text,
  idempotency_key text,
  provider_refund_id text,
  provider_status text,
  created_at timestamp with time zone,
  reconciled_at timestamp with time zone
)
language plpgsql security definer set search_path = ''
as $function$
declare
  actor_id uuid := public.current_app_user();
begin
  if actor_id is null or p_job_id is null or p_generation is null
     or p_continuation is null or p_continuation < 0
     or p_lease_token is null or p_order_id is null or btrim(p_order_id) = ''
     or p_amount is null or p_amount < 1
     or p_currency is null or p_currency !~ '^[a-z]{3}$' then
    raise exception 'invalid user-deletion refund reservation';
  end if;

  perform 1
    from public.v2_user_deletion_jobs deletion_job
   where deletion_job.id = p_job_id
     and deletion_job.user_id = actor_id
     and deletion_job.generation = p_generation
     and deletion_job.continuation = p_continuation
     and deletion_job.status = 'leased'
     and deletion_job.lease_token = p_lease_token
     and deletion_job.phase = 'billing'
     and deletion_job.cursor is not distinct from p_cursor
   for update;
  if not found then
    return;
  end if;

  insert into public.v2_user_deletion_refund_intents (
    job_id,
    user_id,
    generation,
    order_id,
    amount,
    currency,
    idempotency_key
  ) values (
    p_job_id,
    actor_id,
    p_generation,
    p_order_id,
    p_amount,
    p_currency,
    'cheatcode:user-deletion-refund:' || p_job_id::text
  )
  on conflict on constraint v2_user_deletion_refund_intents_pkey do nothing;

  return query
  select intent.job_id,
         intent.user_id,
         intent.generation,
         intent.order_id,
         intent.amount,
         intent.currency,
         intent.idempotency_key,
         intent.provider_refund_id,
         intent.provider_status,
         intent.created_at,
         intent.reconciled_at
    from public.v2_user_deletion_refund_intents intent
   where intent.job_id = p_job_id
     and intent.user_id = actor_id
     and intent.generation = p_generation;
end
$function$;

create or replace function public.webhooks_record_user_deletion_refund_evidence(
  p_job_id uuid,
  p_generation timestamp with time zone,
  p_continuation integer,
  p_lease_token uuid,
  p_cursor text,
  p_order_id text,
  p_amount integer,
  p_currency text,
  p_idempotency_key text,
  p_provider_refund_id text,
  p_provider_status text
)
returns table (
  job_id uuid,
  user_id uuid,
  generation timestamp with time zone,
  order_id text,
  amount integer,
  currency text,
  idempotency_key text,
  provider_refund_id text,
  provider_status text,
  created_at timestamp with time zone,
  reconciled_at timestamp with time zone
)
language plpgsql security definer set search_path = ''
as $function$
declare
  actor_id uuid := public.current_app_user();
  current_intent public.v2_user_deletion_refund_intents%rowtype;
begin
  if actor_id is null or p_job_id is null or p_generation is null
     or p_continuation is null or p_continuation < 0
     or p_lease_token is null or p_order_id is null or btrim(p_order_id) = ''
     or p_amount is null or p_amount < 1
     or p_currency is null or p_currency !~ '^[a-z]{3}$'
     or p_idempotency_key is null or p_idempotency_key = ''
     or p_provider_refund_id is null or btrim(p_provider_refund_id) = ''
     or p_provider_status is null
     or p_provider_status not in ('pending', 'succeeded', 'failed', 'canceled') then
    raise exception 'invalid user-deletion refund evidence';
  end if;

  perform 1
    from public.v2_user_deletion_jobs deletion_job
   where deletion_job.id = p_job_id
     and deletion_job.user_id = actor_id
     and deletion_job.generation = p_generation
     and deletion_job.continuation = p_continuation
     and deletion_job.status = 'leased'
     and deletion_job.lease_token = p_lease_token
     and deletion_job.phase = 'billing'
     and deletion_job.cursor is not distinct from p_cursor
   for update;
  if not found then
    return;
  end if;

  select intent.* into current_intent
    from public.v2_user_deletion_refund_intents intent
   where intent.job_id = p_job_id
     and intent.user_id = actor_id
     and intent.generation = p_generation
   for update;
  if not found then
    raise exception 'user-deletion refund intent is missing';
  end if;

  if current_intent.order_id <> p_order_id
     or current_intent.amount <> p_amount
     or current_intent.currency <> p_currency
     or current_intent.idempotency_key <> p_idempotency_key then
    raise exception 'user-deletion refund immutable identity changed';
  end if;
  if current_intent.provider_refund_id is not null
     and current_intent.provider_refund_id <> p_provider_refund_id then
    raise exception 'user-deletion provider refund identity changed';
  end if;
  if current_intent.provider_status is not null
     and current_intent.provider_status <> 'pending'
     and current_intent.provider_status <> p_provider_status then
    raise exception 'user-deletion provider refund status regressed';
  end if;

  update public.v2_user_deletion_refund_intents intent
     set provider_refund_id = p_provider_refund_id,
         provider_status = p_provider_status,
         reconciled_at = now()
   where intent.job_id = p_job_id;

  return query
  select intent.job_id,
         intent.user_id,
         intent.generation,
         intent.order_id,
         intent.amount,
         intent.currency,
         intent.idempotency_key,
         intent.provider_refund_id,
         intent.provider_status,
         intent.created_at,
         intent.reconciled_at
    from public.v2_user_deletion_refund_intents intent
   where intent.job_id = p_job_id;
end
$function$;

alter function public.webhooks_reserve_user_deletion_refund_intent(
  uuid,
  timestamp with time zone,
  integer,
  uuid,
  text,
  text,
  integer,
  text
) owner to postgres;
alter function public.webhooks_record_user_deletion_refund_evidence(
  uuid,
  timestamp with time zone,
  integer,
  uuid,
  text,
  text,
  integer,
  text,
  text,
  text,
  text
) owner to postgres;

revoke all on function
  public.webhooks_reserve_user_deletion_refund_intent(
    uuid,
    timestamp with time zone,
    integer,
    uuid,
    text,
    text,
    integer,
    text
  ),
  public.webhooks_record_user_deletion_refund_evidence(
    uuid,
    timestamp with time zone,
    integer,
    uuid,
    text,
    text,
    integer,
    text,
    text,
    text,
    text
  )
from public, anon, authenticated, service_role, app_gateway, app_agent, app_webhooks;

grant execute on function
  public.webhooks_reserve_user_deletion_refund_intent(
    uuid,
    timestamp with time zone,
    integer,
    uuid,
    text,
    text,
    integer,
    text
  ),
  public.webhooks_record_user_deletion_refund_evidence(
    uuid,
    timestamp with time zone,
    integer,
    uuid,
    text,
    text,
    integer,
    text,
    text,
    text,
    text
  )
to app_webhooks;

create or replace function public.v2_guard_user_deletion_refund_resolution()
returns trigger
language plpgsql set search_path = ''
as $function$
begin
  if (
    tg_op = 'DELETE'
    or (old.phase = 'billing' and new.phase <> 'billing')
  ) and exists (
    select 1
      from public.v2_user_deletion_refund_intents refund_intent
     where refund_intent.job_id = old.id
       and refund_intent.provider_status is distinct from 'succeeded'
  ) then
    raise exception 'user-deletion job has an unresolved refund intent';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$function$;

alter function public.v2_guard_user_deletion_refund_resolution() owner to postgres;
revoke all on function public.v2_guard_user_deletion_refund_resolution()
from public, anon, authenticated, service_role, app_gateway, app_agent, app_webhooks;

create trigger trg_v2_user_deletion_refund_resolution
before update of phase or delete on public.v2_user_deletion_jobs
for each row execute function public.v2_guard_user_deletion_refund_resolution();
