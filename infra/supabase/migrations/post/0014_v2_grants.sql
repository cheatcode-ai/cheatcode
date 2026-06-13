alter table v2_audit_log enable row level security;

drop policy if exists v2_audit_log_select_own on v2_audit_log;
drop policy if exists v2_audit_log_insert_system on v2_audit_log;

create policy v2_audit_log_select_own on v2_audit_log
  for select using (user_id::text = current_setting('app.user_id', true));
create policy v2_audit_log_insert_system on v2_audit_log
  for insert with check (true);

revoke select, insert, update, delete on all tables in schema public from app_worker;

grant select, insert, update, delete on table
  v2_users,
  v2_projects,
  v2_threads,
  v2_messages,
  v2_agent_runs,
  v2_provider_keys,
  v2_user_integrations,
  v2_generated_outputs,
  v2_usage_events,
  v2_usage_daily_totals,
  v2_entitlements,
  v2_billing_events,
  v2_audit_log
to app_worker;
