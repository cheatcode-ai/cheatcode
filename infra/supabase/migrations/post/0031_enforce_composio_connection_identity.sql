-- Composio exposes connected accounts through an ID-only retrieval endpoint and
-- expiry webhooks identify the account by that same ID. Refuse ambiguous existing
-- rows before making that provider identity globally unique in Cheatcode.
do $$
begin
  if exists (
    select 1
      from public.v2_user_integrations
     where integration !~ '^[a-z0-9_]{1,64}$'
  ) then
    raise exception 'invalid Composio toolkit slugs must be resolved before migration'
      using errcode = '23514';
  end if;
  if exists (
    select 1
      from public.v2_user_integrations
     where composio_connection_id <> btrim(composio_connection_id)
        or length(composio_connection_id) not between 1 and 256
  ) then
    raise exception 'invalid Composio connection IDs must be resolved before migration'
      using errcode = '23514';
  end if;
  if exists (
    select 1
      from public.v2_user_integrations
     group by composio_connection_id
    having count(*) > 1
  ) then
    raise exception 'duplicate Composio connection IDs must be resolved before migration'
      using errcode = '23505';
  end if;
end
$$;

create unique index v2_user_integrations_composio_connection_id_unique_idx
  on public.v2_user_integrations (composio_connection_id);
