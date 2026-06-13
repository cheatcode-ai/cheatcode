create or replace function list_provider_key_revalidation_targets(p_limit integer)
returns table (
  user_id uuid,
  provider text,
  fingerprint text
)
language sql
security definer
set search_path = ''
as $$
  select
    pk.user_id,
    pk.provider,
    pk.fingerprint
  from public.v2_provider_keys pk
  where pk.deleted_at is null
    and pk.disabled_at is null
  order by
    coalesce(pk.last_used_at, pk.created_at) asc,
    pk.created_at asc,
    pk.id asc
  limit least(greatest(coalesce(p_limit, 250), 1), 1000)
$$;

revoke all on function public.list_provider_key_revalidation_targets(integer) from public, app_worker;
grant execute on function public.list_provider_key_revalidation_targets(integer) to app_worker;
