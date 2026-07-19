ALTER TABLE "v2_user_deletion_jobs" ALTER COLUMN "generation" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "v2_users" ADD COLUMN "clerk_updated_at_ms" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "v2_users" ADD CONSTRAINT "v2_users_clerk_updated_at_ms_check" CHECK ("v2_users"."clerk_updated_at_ms" between 0 and 9007199254740991);
