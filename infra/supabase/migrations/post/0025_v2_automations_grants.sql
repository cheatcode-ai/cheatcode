-- Automations subsystem grants. These tables follow the same posture as
-- v2_projects / v2_threads / v2_messages: no row-level security (RLS stays
-- limited to v2_provider_keys + v2_audit_log), with per-user isolation enforced
-- in application code via withUserContext + userId filters. Trigger/delivery
-- payloads are intentionally NOT persisted raw (only minimized normalized
-- fields), so there is no sensitive-payload-at-rest justification for RLS here.
--
-- DSR / account deletion: the user_id foreign keys cascade on delete, so removing
-- a v2_users row tears down its automations, run requests, and runs automatically.

grant select, insert, update, delete on table
  v2_automations,
  v2_automation_run_requests,
  v2_automation_runs
to app_worker;
