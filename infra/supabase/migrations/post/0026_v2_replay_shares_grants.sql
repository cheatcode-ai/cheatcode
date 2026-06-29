-- Replay shares grants. Same posture as v2_projects / v2_threads / v2_messages:
-- no row-level security (RLS stays limited to v2_provider_keys + v2_audit_log),
-- with per-user isolation enforced in application code via withUserContext +
-- userId filters on the write paths.
--
-- The PUBLIC read path (GET /v1/replays/:id) intentionally reads v2_replay_shares
-- and the shared thread's v2_messages WITHOUT a user filter — that is the whole
-- point of a share token. Access is gated in code by the row's revoked_at +
-- visibility, and the share id is an unguessable uuidv7. Only minimized snapshot
-- fields (title, author name) live on the row; no raw provider payloads.
--
-- DSR / account deletion: the user_id foreign key cascades on delete, so removing
-- a v2_users row tears down its replay shares automatically. The thread_id foreign
-- key likewise cascades, so deleting a source run removes its share.

grant select, insert, update, delete on table
  v2_replay_shares
to app_worker;
