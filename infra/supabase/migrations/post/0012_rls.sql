alter table v2_provider_keys enable row level security;
alter table v2_audit_log enable row level security;

create policy v2_provider_keys_select_own on v2_provider_keys
  for select using (user_id::text = current_setting('app.user_id', true));
create policy v2_provider_keys_insert_own on v2_provider_keys
  for insert with check (user_id::text = current_setting('app.user_id', true));
create policy v2_provider_keys_update_own on v2_provider_keys
  for update using (user_id::text = current_setting('app.user_id', true));
create policy v2_provider_keys_delete_own on v2_provider_keys
  for delete using (user_id::text = current_setting('app.user_id', true));

create policy v2_audit_log_select_own on v2_audit_log
  for select using (user_id::text = current_setting('app.user_id', true));
create policy v2_audit_log_insert_system on v2_audit_log
  for insert with check (true);
