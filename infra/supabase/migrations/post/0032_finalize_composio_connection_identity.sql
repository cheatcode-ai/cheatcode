-- New Workers preserve ownership/toolkit identity on conflict and maintain an
-- active default. Repair historical state before enforcing those final rules.
update public.v2_user_integrations
   set is_default = false,
       updated_at = now()
 where is_default = true
   and lower(status) not in ('active', 'authorized', 'connected', 'enabled');

with missing_defaults as (
  select distinct on (candidate.user_id, candidate.integration)
         candidate.composio_connection_id
    from public.v2_user_integrations candidate
   where lower(candidate.status) in ('active', 'authorized', 'connected', 'enabled')
     and not exists (
       select 1
         from public.v2_user_integrations existing
        where existing.user_id = candidate.user_id
          and existing.integration = candidate.integration
          and existing.is_default = true
     )
   order by candidate.user_id,
            candidate.integration,
            candidate.updated_at desc,
            candidate.composio_connection_id
)
update public.v2_user_integrations target
   set is_default = true,
       updated_at = now()
  from missing_defaults
 where target.composio_connection_id = missing_defaults.composio_connection_id;

alter table public.v2_user_integrations
  drop constraint v2_user_integrations_user_id_composio_connection_id_pk;

alter table public.v2_user_integrations
  add constraint v2_user_integrations_composio_connection_id_pk
  primary key using index v2_user_integrations_composio_connection_id_unique_idx;

alter table public.v2_user_integrations
  add constraint v2_user_integrations_default_active_check
  check (
    not is_default
    or lower(status) in ('active', 'authorized', 'connected', 'enabled')
  ) not valid;

alter table public.v2_user_integrations
  validate constraint v2_user_integrations_default_active_check;

alter table public.v2_user_integrations
  add constraint v2_user_integrations_connection_id_check
  check (
    composio_connection_id = btrim(composio_connection_id)
    and length(composio_connection_id) between 1 and 256
  ) not valid;

alter table public.v2_user_integrations
  validate constraint v2_user_integrations_connection_id_check;

alter table public.v2_user_integrations
  add constraint v2_user_integrations_integration_check
  check (integration ~ '^[a-z0-9_]{1,64}$') not valid;

alter table public.v2_user_integrations
  validate constraint v2_user_integrations_integration_check;
