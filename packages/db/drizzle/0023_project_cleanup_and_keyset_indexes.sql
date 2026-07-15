ALTER TABLE "v2_projects" ADD COLUMN "workspace_cleanup_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "v2_projects" ADD COLUMN "workspace_cleanup_completed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "v2_messages_thread_page_idx" ON "v2_messages" USING btree ("user_id","thread_id","created_at","id");--> statement-breakpoint
CREATE INDEX "v2_projects_user_page_idx" ON "v2_projects" USING btree ("user_id","updated_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE deleted_at is null;--> statement-breakpoint
CREATE INDEX "v2_threads_project_page_idx" ON "v2_threads" USING btree ("user_id","project_id","updated_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE deleted_at is null;--> statement-breakpoint
CREATE INDEX "v2_threads_user_page_idx" ON "v2_threads" USING btree ("user_id","updated_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE deleted_at is null;
