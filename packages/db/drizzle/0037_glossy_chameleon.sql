-- Historical raw migrations already create this index on existing targets.
-- IF NOT EXISTS makes the Drizzle schema authoritative without rebuilding it.
CREATE INDEX IF NOT EXISTS "v2_agent_runs_user_started_idx" ON "v2_agent_runs" USING btree ("user_id","started_at" DESC NULLS FIRST);
