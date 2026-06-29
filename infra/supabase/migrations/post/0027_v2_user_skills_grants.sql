-- User-created skills grants. Same posture as the other per-user tables: no
-- row-level security (RLS stays limited to v2_provider_keys + v2_audit_log), with
-- per-user isolation enforced in application code via withUserContext + userId
-- filters. Skill bodies are user-authored markdown — no provider secrets at rest.
--
-- DSR / account deletion: the user_id foreign key cascades on delete, so removing
-- a v2_users row tears down its custom skills automatically.

grant select, insert, update, delete on table
  v2_user_skills
to app_worker;
