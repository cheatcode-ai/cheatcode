ALTER TABLE "v2_agent_runs" ADD COLUMN "idempotency_key_hash" text;--> statement-breakpoint
ALTER TABLE "v2_agent_runs" ADD COLUMN "request_body_hash" text;--> statement-breakpoint
CREATE UNIQUE INDEX "v2_agent_runs_user_idempotency_key_unique" ON "v2_agent_runs" USING btree ("user_id","idempotency_key_hash");--> statement-breakpoint
ALTER TABLE "v2_agent_runs" ADD CONSTRAINT "v2_agent_runs_idempotency_key_hash_check" CHECK ("v2_agent_runs"."idempotency_key_hash" is null or "v2_agent_runs"."idempotency_key_hash" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "v2_agent_runs" ADD CONSTRAINT "v2_agent_runs_request_body_hash_check" CHECK ("v2_agent_runs"."request_body_hash" is null or "v2_agent_runs"."request_body_hash" ~ '^[0-9a-f]{64}$');