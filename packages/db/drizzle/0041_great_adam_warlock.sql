CREATE TABLE "v2_user_deletion_jobs" (
	"id" uuid PRIMARY KEY DEFAULT public.uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"generation" timestamp (3) with time zone NOT NULL,
	"phase" text DEFAULT 'runs' NOT NULL,
	"cursor" text,
	"continuation" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"lease_token" uuid,
	"lease_expires_at" timestamp (3) with time zone,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"last_error_code" text,
	CONSTRAINT "v2_user_deletion_jobs_phase_check" CHECK ("v2_user_deletion_jobs"."phase" in ('runs', 'sandbox', 'billing', 'quota', 'integrations', 'objects', 'archive', 'finalize')),
	CONSTRAINT "v2_user_deletion_jobs_status_check" CHECK ("v2_user_deletion_jobs"."status" in ('queued', 'leased', 'quarantined')),
	CONSTRAINT "v2_user_deletion_jobs_counter_check" CHECK ("v2_user_deletion_jobs"."continuation" >= 0 and "v2_user_deletion_jobs"."failure_count" >= 0),
	CONSTRAINT "v2_user_deletion_jobs_lease_check" CHECK ((
        ("v2_user_deletion_jobs"."status" = 'leased' and "v2_user_deletion_jobs"."lease_token" is not null and "v2_user_deletion_jobs"."lease_expires_at" is not null)
        or
        ("v2_user_deletion_jobs"."status" <> 'leased' and "v2_user_deletion_jobs"."lease_token" is null and "v2_user_deletion_jobs"."lease_expires_at" is null)
      ))
);
--> statement-breakpoint
ALTER TABLE "v2_user_deletion_jobs" ADD CONSTRAINT "v2_user_deletion_jobs_user_id_v2_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."v2_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "v2_user_deletion_jobs_generation_uidx" ON "v2_user_deletion_jobs" USING btree ("user_id","generation");--> statement-breakpoint
CREATE INDEX "v2_user_deletion_jobs_ready_idx" ON "v2_user_deletion_jobs" USING btree ("next_attempt_at","id") WHERE "v2_user_deletion_jobs"."status" = 'queued';--> statement-breakpoint
CREATE INDEX "v2_user_deletion_jobs_lease_idx" ON "v2_user_deletion_jobs" USING btree ("lease_expires_at","id") WHERE "v2_user_deletion_jobs"."status" = 'leased';