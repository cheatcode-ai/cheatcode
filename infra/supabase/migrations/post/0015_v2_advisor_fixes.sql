create index if not exists v2_agent_runs_user_started_idx on v2_agent_runs (user_id, started_at desc);
create index if not exists v2_billing_events_user_processed_idx on v2_billing_events (user_id, processed_at desc) where user_id is not null;
create index if not exists v2_generated_outputs_agent_run_idx on v2_generated_outputs (agent_run_id) where agent_run_id is not null;
create index if not exists v2_generated_outputs_project_created_idx on v2_generated_outputs (project_id, created_at desc) where project_id is not null;
create index if not exists v2_messages_user_created_idx on v2_messages (user_id, created_at desc);
create index if not exists v2_threads_project_created_idx on v2_threads (project_id, created_at desc) where deleted_at is null;
create index if not exists v2_audit_log_action_created_idx on v2_audit_log (action, created_at desc);
create index if not exists v2_audit_log_created_brin_idx on v2_audit_log using brin (created_at);

create or replace function v2_audit_provider_key_change() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into public.v2_audit_log (user_id, action, resource_type, resource_id, metadata)
  values (
    coalesce(NEW.user_id, OLD.user_id),
    case TG_OP
      when 'INSERT' then 'provider_key.create'
      when 'UPDATE' then 'provider_key.update'
      when 'DELETE' then 'provider_key.delete'
    end,
    'provider_key',
    coalesce(NEW.provider, OLD.provider),
    jsonb_build_object('fingerprint', coalesce(NEW.fingerprint, OLD.fingerprint))
  );
  return coalesce(NEW, OLD);
end
$$;

alter table v2_provider_keys enable row level security;
alter table v2_audit_log enable row level security;

drop policy if exists v2_provider_keys_select_own on v2_provider_keys;
drop policy if exists v2_provider_keys_insert_own on v2_provider_keys;
drop policy if exists v2_provider_keys_update_own on v2_provider_keys;
drop policy if exists v2_provider_keys_delete_own on v2_provider_keys;
drop policy if exists v2_audit_log_select_own on v2_audit_log;
drop policy if exists v2_audit_log_insert_system on v2_audit_log;

create policy v2_provider_keys_select_own on v2_provider_keys
  for select using (user_id::text = (select current_setting('app.user_id', true)));
create policy v2_provider_keys_insert_own on v2_provider_keys
  for insert with check (user_id::text = (select current_setting('app.user_id', true)));
create policy v2_provider_keys_update_own on v2_provider_keys
  for update using (user_id::text = (select current_setting('app.user_id', true)));
create policy v2_provider_keys_delete_own on v2_provider_keys
  for delete using (user_id::text = (select current_setting('app.user_id', true)));
create policy v2_audit_log_select_own on v2_audit_log
  for select using (user_id::text = (select current_setting('app.user_id', true)));
create policy v2_audit_log_insert_system on v2_audit_log
  for insert with check (true);
