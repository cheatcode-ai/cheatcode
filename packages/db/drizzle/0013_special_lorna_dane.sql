DROP INDEX "v2_projects_user_workspace_slug_uidx";--> statement-breakpoint
ALTER TABLE "v2_projects" ALTER COLUMN "workspace_slug" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "v2_projects_user_workspace_slug_uidx" ON "v2_projects" USING btree ("user_id","workspace_slug");