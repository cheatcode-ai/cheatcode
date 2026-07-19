-- LlamaParse has no V2 runtime consumer. Remove its inert BYOK rows (the
-- guarded delete trigger also removes each owned Vault secret), then contract
-- both the table and security-definer write boundary to live providers only.
lock table public.v2_provider_keys in share row exclusive mode;

create temporary table llamaparse_affected_users (
  user_id uuid primary key
) on commit drop;

insert into llamaparse_affected_users (user_id)
select user_id
  from public.v2_provider_keys
 where provider = 'llamaparse';

delete from public.v2_provider_keys
 where provider = 'llamaparse';

-- Removing a ranked key can promote the next provider into the user's tier
-- allowance. Reapply the exact runtime ranking while preserving disables that
-- came from provider revalidation rather than the tier-slot policy.
with ranked as (
  select
    key.user_id,
    key.provider,
    row_number() over (
      partition by key.user_id
      order by key.created_at asc, key.provider asc
    ) as provider_rank,
    case coalesce(entitlement.tier, 'free')
      when 'free' then 3
      when 'pro' then 10
      else null
    end as provider_limit
  from public.v2_provider_keys key
  join llamaparse_affected_users affected on affected.user_id = key.user_id
  left join public.v2_entitlements entitlement on entitlement.user_id = key.user_id
)
update public.v2_provider_keys key
   set disabled_at = case
         when ranked.provider_limit is null
           and key.disabled_reason = 'tier_slot_limit' then null
         when ranked.provider_rank <= ranked.provider_limit
           and key.disabled_reason = 'tier_slot_limit' then null
         when ranked.provider_rank > ranked.provider_limit
           and key.disabled_at is null then now()
         else key.disabled_at
       end,
       disabled_reason = case
         when ranked.provider_limit is null
           and key.disabled_reason = 'tier_slot_limit' then null
         when ranked.provider_rank <= ranked.provider_limit
           and key.disabled_reason = 'tier_slot_limit' then null
         when ranked.provider_rank > ranked.provider_limit
           and key.disabled_at is null then 'tier_slot_limit'
         else key.disabled_reason
       end
  from ranked
 where key.user_id = ranked.user_id
   and key.provider = ranked.provider
   and (
     (ranked.provider_limit is null and key.disabled_reason = 'tier_slot_limit')
     or (
       ranked.provider_limit is not null
       and ranked.provider_rank <= ranked.provider_limit
       and key.disabled_reason = 'tier_slot_limit'
     )
     or (
       ranked.provider_limit is not null
       and ranked.provider_rank > ranked.provider_limit
       and key.disabled_at is null
     )
   );

alter table public.v2_provider_keys
  drop constraint v2_provider_keys_provider_check;

alter table public.v2_provider_keys
  add constraint v2_provider_keys_provider_check
  check (
    provider in (
      'anthropic',
      'openai',
      'google',
      'openrouter',
      'deepseek',
      'exa',
      'firecrawl'
    )
  );

create or replace function public.set_provider_key(p_provider text, p_key text) returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := public.current_app_user();
  secret_id uuid;
  key_fingerprint text;
begin
  if p_provider is null or p_provider not in (
    'anthropic',
    'openai',
    'google',
    'openrouter',
    'deepseek',
    'exa',
    'firecrawl'
  ) then
    raise exception 'unsupported provider';
  end if;
  if p_key is null or btrim(p_key) = '' or octet_length(p_key) > 65536 then
    raise exception 'provider key must contain between 1 and 65536 bytes';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'cheatcode:provider-keys:' || actor_id::text,
      0
    )
  );

  key_fingerprint := substring(
    encode(extensions.digest(convert_to(p_key, 'UTF8'), 'sha256'), 'hex')
    for 12
  );

  delete from public.v2_provider_keys
   where user_id = actor_id and provider = p_provider;

  secret_id := vault.create_secret(
    p_key,
    actor_id::text || ':' || p_provider || ':' || public.uuidv7()::text,
    'Cheatcode V2 BYOK provider key'
  );

  insert into public.v2_provider_keys (
    user_id,
    provider,
    vault_secret_id,
    fingerprint
  ) values (
    actor_id,
    p_provider,
    secret_id,
    key_fingerprint
  );
end
$function$;
