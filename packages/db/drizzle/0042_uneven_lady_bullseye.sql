CREATE TABLE "v2_retention_jobs" (
	"day" date PRIMARY KEY NOT NULL,
	"scheduled_at" timestamp (3) with time zone NOT NULL,
	"phase" text DEFAULT 'activation' NOT NULL,
	"activation_cursor_event" text,
	"activation_cursor_user_id" uuid,
	"output_cursor_expires_at" timestamp (3) with time zone,
	"output_cursor_id" uuid,
	"continuation" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"release_version_id" uuid,
	"lease_token" uuid,
	"lease_expires_at" timestamp (3) with time zone,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"last_error_code" text,
	"completed_at" timestamp (3) with time zone,
	CONSTRAINT "v2_retention_jobs_day_check" CHECK ("v2_retention_jobs"."day" = (("v2_retention_jobs"."scheduled_at" at time zone 'UTC')::date - 1)),
	CONSTRAINT "v2_retention_jobs_phase_check" CHECK ("v2_retention_jobs"."phase" in ('activation', 'cleanup')),
	CONSTRAINT "v2_retention_jobs_status_check" CHECK ("v2_retention_jobs"."status" in ('queued', 'leased', 'complete')),
	CONSTRAINT "v2_retention_jobs_counter_check" CHECK ("v2_retention_jobs"."continuation" >= 0 and "v2_retention_jobs"."failure_count" >= 0),
	CONSTRAINT "v2_retention_jobs_error_code_check" CHECK ("v2_retention_jobs"."last_error_code" is null or octet_length("v2_retention_jobs"."last_error_code") <= 128),
	CONSTRAINT "v2_retention_jobs_activation_cursor_check" CHECK ((
        ("v2_retention_jobs"."activation_cursor_event" is null and "v2_retention_jobs"."activation_cursor_user_id" is null)
        or
        (
          "v2_retention_jobs"."phase" = 'activation'
          and "v2_retention_jobs"."activation_cursor_event" in ('retention_d7', 'retention_d28', 'first_week_mau')
          and "v2_retention_jobs"."activation_cursor_user_id" is not null
        )
      )),
	CONSTRAINT "v2_retention_jobs_output_cursor_check" CHECK ((
        ("v2_retention_jobs"."output_cursor_expires_at" is null and "v2_retention_jobs"."output_cursor_id" is null)
        or
        (
          "v2_retention_jobs"."phase" = 'cleanup'
          and "v2_retention_jobs"."output_cursor_expires_at" is not null
          and "v2_retention_jobs"."output_cursor_id" is not null
        )
      )),
	CONSTRAINT "v2_retention_jobs_phase_cursor_check" CHECK ((
        ("v2_retention_jobs"."phase" = 'activation' and "v2_retention_jobs"."output_cursor_expires_at" is null and "v2_retention_jobs"."output_cursor_id" is null)
        or
        ("v2_retention_jobs"."phase" = 'cleanup' and "v2_retention_jobs"."activation_cursor_event" is null and "v2_retention_jobs"."activation_cursor_user_id" is null)
      )),
	CONSTRAINT "v2_retention_jobs_lease_check" CHECK ((
        (
          "v2_retention_jobs"."status" = 'leased'
          and "v2_retention_jobs"."release_version_id" is not null
          and "v2_retention_jobs"."lease_token" is not null
          and "v2_retention_jobs"."lease_expires_at" is not null
          and "v2_retention_jobs"."completed_at" is null
        )
        or
        (
          "v2_retention_jobs"."status" = 'queued'
          and "v2_retention_jobs"."release_version_id" is null
          and "v2_retention_jobs"."lease_token" is null
          and "v2_retention_jobs"."lease_expires_at" is null
          and "v2_retention_jobs"."completed_at" is null
        )
        or
        (
          "v2_retention_jobs"."status" = 'complete'
          and "v2_retention_jobs"."release_version_id" is null
          and "v2_retention_jobs"."lease_token" is null
          and "v2_retention_jobs"."lease_expires_at" is null
          and "v2_retention_jobs"."completed_at" is not null
        )
      )),
	CONSTRAINT "v2_retention_jobs_terminal_phase_check" CHECK ("v2_retention_jobs"."status" <> 'complete' or "v2_retention_jobs"."phase" = 'cleanup')
);
--> statement-breakpoint
CREATE INDEX "v2_retention_jobs_ready_idx" ON "v2_retention_jobs" USING btree ("next_attempt_at","day") WHERE "v2_retention_jobs"."status" = 'queued';--> statement-breakpoint
CREATE INDEX "v2_retention_jobs_lease_idx" ON "v2_retention_jobs" USING btree ("lease_expires_at","day") WHERE "v2_retention_jobs"."status" = 'leased';--> statement-breakpoint
CREATE INDEX "v2_retention_jobs_completed_idx" ON "v2_retention_jobs" USING btree ("completed_at","day") WHERE "v2_retention_jobs"."status" = 'complete';