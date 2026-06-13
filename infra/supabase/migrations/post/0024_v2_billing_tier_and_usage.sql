-- billing-credits cluster post-migration.
--
-- The v2_entitlements tier CHECK swap (free|pro|premium|ultra|max) and the
-- team->premium / enterprise->max data mapping live in the cluster's own
-- generated Drizzle migration drizzle/0003_v2_billing_tier_premium_ultra_max.sql
-- (hand-edited to interleave the UPDATEs before the new constraint). They are
-- forced into the Drizzle phase because drizzle-kit tracks the check constraint
-- in its snapshot; duplicating them here would double-apply.
--
-- This raw post migration carries only the index the Activity punchcard
-- (GET /v1/usage/daily runs[]) needs: a user-scoped started_at range scan.
-- The existing v2_agent_runs (thread_id, started_at desc) index is thread-scoped
-- and does not cover a per-user range query. app_worker already holds select on
-- v2_agent_runs, so no new grants and no RLS changes are required.

create index if not exists v2_agent_runs_user_started_idx
  on v2_agent_runs (user_id, started_at desc);
