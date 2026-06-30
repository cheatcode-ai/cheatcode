ALTER TABLE "v2_threads" ALTER COLUMN "project_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "v2_threads" ADD COLUMN "launch_intent" jsonb;