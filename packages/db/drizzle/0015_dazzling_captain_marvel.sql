ALTER TABLE "v2_user_integrations" DROP CONSTRAINT "v2_user_integrations_user_id_integration_pk";--> statement-breakpoint
ALTER TABLE "v2_user_integrations" ADD CONSTRAINT "v2_user_integrations_user_id_composio_connection_id_pk" PRIMARY KEY("user_id","composio_connection_id");--> statement-breakpoint
ALTER TABLE "v2_user_integrations" ADD COLUMN "is_default" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "v2_user_integrations" SET "is_default" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "v2_user_integrations_one_default_idx" ON "v2_user_integrations" USING btree ("user_id","integration") WHERE "v2_user_integrations"."is_default" = true;--> statement-breakpoint
CREATE INDEX "v2_user_integrations_user_toolkit_idx" ON "v2_user_integrations" USING btree ("user_id","integration");
