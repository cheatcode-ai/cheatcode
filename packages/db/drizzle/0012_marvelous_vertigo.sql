-- Backfill legacy null slugs FIRST so (a) the partial unique index can build and (b) pre-migration
-- projects stop collapsing onto the shared /workspace/app sentinel. 'p-' + the row's own uuid (hex,
-- dashless) is globally unique, so no per-user collision and no clash with name-derived slugs.
UPDATE "v2_projects" SET "workspace_slug" = 'p-' || replace("id"::text, '-', '') WHERE "workspace_slug" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "v2_projects_user_workspace_slug_uidx" ON "v2_projects" USING btree ("user_id","workspace_slug") WHERE workspace_slug is not null;
