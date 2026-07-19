CREATE TABLE "v2_artifact_upload_intents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"agent_run_id" uuid NOT NULL,
	"r2_key" text NOT NULL,
	"cleanup_not_before" timestamp (3) with time zone NOT NULL,
	"quiesced_at" timestamp (3) with time zone,
	CONSTRAINT "v2_artifact_upload_intents_r2_key_unique" UNIQUE("r2_key"),
	CONSTRAINT "v2_artifact_upload_intents_r2_identity_check" CHECK ("v2_artifact_upload_intents"."r2_key" like "v2_artifact_upload_intents"."user_id"::text || '/' || "v2_artifact_upload_intents"."project_id"::text || '/' || "v2_artifact_upload_intents"."agent_run_id"::text || '/' || "v2_artifact_upload_intents"."id"::text || '-%'
        and strpos(substr("v2_artifact_upload_intents"."r2_key", length("v2_artifact_upload_intents"."user_id"::text || '/' || "v2_artifact_upload_intents"."project_id"::text || '/' || "v2_artifact_upload_intents"."agent_run_id"::text || '/' || "v2_artifact_upload_intents"."id"::text || '-') + 1), '/') = 0
        and octet_length("v2_artifact_upload_intents"."r2_key") <= 512)
);
--> statement-breakpoint
CREATE TABLE "v2_user_deletion_refund_intents" (
	"job_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"generation" timestamp with time zone NOT NULL,
	"order_id" text NOT NULL,
	"amount" integer NOT NULL,
	"currency" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"provider_refund_id" text,
	"provider_status" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"reconciled_at" timestamp (3) with time zone,
	CONSTRAINT "v2_user_deletion_refund_intents_amount_check" CHECK ("v2_user_deletion_refund_intents"."amount" > 0),
	CONSTRAINT "v2_user_deletion_refund_intents_currency_check" CHECK ("v2_user_deletion_refund_intents"."currency" ~ '^[a-z]{3}$'),
	CONSTRAINT "v2_user_deletion_refund_intents_order_check" CHECK (length(btrim("v2_user_deletion_refund_intents"."order_id")) > 0),
	CONSTRAINT "v2_user_deletion_refund_intents_identity_check" CHECK ("v2_user_deletion_refund_intents"."idempotency_key" = 'cheatcode:user-deletion-refund:' || "v2_user_deletion_refund_intents"."job_id"::text),
	CONSTRAINT "v2_user_deletion_refund_intents_provider_check" CHECK ((
        ("v2_user_deletion_refund_intents"."provider_refund_id" is null and "v2_user_deletion_refund_intents"."provider_status" is null and "v2_user_deletion_refund_intents"."reconciled_at" is null)
        or
        ("v2_user_deletion_refund_intents"."provider_refund_id" is not null and length(btrim("v2_user_deletion_refund_intents"."provider_refund_id")) > 0 and "v2_user_deletion_refund_intents"."provider_status" is not null and "v2_user_deletion_refund_intents"."provider_status" in ('pending', 'succeeded', 'failed', 'canceled') and "v2_user_deletion_refund_intents"."reconciled_at" is not null)
      ))
);
--> statement-breakpoint
ALTER TABLE "v2_user_deletion_jobs" ADD CONSTRAINT "v2_user_deletion_jobs_id_user_generation_key" UNIQUE("id","user_id","generation");--> statement-breakpoint
ALTER TABLE "v2_user_deletion_refund_intents" ADD CONSTRAINT "v2_user_deletion_refund_intents_job_identity_fk" FOREIGN KEY ("job_id","user_id","generation") REFERENCES "public"."v2_user_deletion_jobs"("id","user_id","generation") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "v2_artifact_upload_intents_cleanup_idx" ON "v2_artifact_upload_intents" USING btree ("cleanup_not_before","quiesced_at","id") WHERE "v2_artifact_upload_intents"."quiesced_at" is not null;--> statement-breakpoint
CREATE INDEX "v2_artifact_upload_intents_user_idx" ON "v2_artifact_upload_intents" USING btree ("user_id","id");--> statement-breakpoint
CREATE INDEX "v2_artifact_upload_intents_project_idx" ON "v2_artifact_upload_intents" USING btree ("user_id","project_id","id");--> statement-breakpoint
CREATE INDEX "v2_artifact_upload_intents_run_idx" ON "v2_artifact_upload_intents" USING btree ("user_id","agent_run_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "v2_user_deletion_refund_intents_idempotency_uidx" ON "v2_user_deletion_refund_intents" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "v2_user_deletion_refund_intents_provider_uidx" ON "v2_user_deletion_refund_intents" USING btree ("provider_refund_id") WHERE "v2_user_deletion_refund_intents"."provider_refund_id" is not null;--> statement-breakpoint
CREATE INDEX "v2_user_deletion_refund_intents_unresolved_idx" ON "v2_user_deletion_refund_intents" USING btree ("user_id","job_id") WHERE "v2_user_deletion_refund_intents"."provider_status" is distinct from 'succeeded';
