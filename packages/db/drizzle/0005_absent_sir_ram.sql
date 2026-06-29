CREATE TABLE "v2_automation_run_requests" (
	"id" uuid PRIMARY KEY DEFAULT public.uuidv7() NOT NULL,
	"automation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"source" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"scheduled_for" timestamp with time zone,
	"status" text DEFAULT 'pending' NOT NULL,
	"claimed_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"normalized" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "v2_automation_runs" (
	"id" uuid PRIMARY KEY DEFAULT public.uuidv7() NOT NULL,
	"automation_id" uuid NOT NULL,
	"request_id" uuid,
	"user_id" uuid NOT NULL,
	"thread_id" uuid,
	"status" text DEFAULT 'running' NOT NULL,
	"summary" text,
	"error" text,
	"deliveries" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "v2_automations" (
	"id" uuid PRIMARY KEY DEFAULT public.uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"project_id" uuid,
	"name" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"kind" text NOT NULL,
	"schedule" text,
	"trigger_toolkit" text,
	"trigger_slug" text,
	"trigger_id" text,
	"prompt" text NOT NULL,
	"model" text,
	"delivery_channels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"next_run_at" timestamp with time zone,
	"last_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "v2_automation_run_requests" ADD CONSTRAINT "v2_automation_run_requests_automation_id_v2_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."v2_automations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "v2_automation_run_requests" ADD CONSTRAINT "v2_automation_run_requests_user_id_v2_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."v2_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "v2_automation_runs" ADD CONSTRAINT "v2_automation_runs_automation_id_v2_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."v2_automations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "v2_automation_runs" ADD CONSTRAINT "v2_automation_runs_user_id_v2_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."v2_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "v2_automations" ADD CONSTRAINT "v2_automations_user_id_v2_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."v2_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "v2_automations" ADD CONSTRAINT "v2_automations_project_id_v2_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."v2_projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "v2_automation_run_requests_dedupe_idx" ON "v2_automation_run_requests" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "v2_automation_run_requests_status_idx" ON "v2_automation_run_requests" USING btree ("status","claimed_at");--> statement-breakpoint
CREATE INDEX "v2_automation_run_requests_automation_idx" ON "v2_automation_run_requests" USING btree ("automation_id");--> statement-breakpoint
CREATE INDEX "v2_automation_runs_automation_idx" ON "v2_automation_runs" USING btree ("automation_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "v2_automation_runs_active_idx" ON "v2_automation_runs" USING btree ("automation_id") WHERE status in ('running');--> statement-breakpoint
CREATE INDEX "v2_automations_user_idx" ON "v2_automations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "v2_automations_due_idx" ON "v2_automations" USING btree ("status","next_run_at");--> statement-breakpoint
CREATE INDEX "v2_automations_trigger_idx" ON "v2_automations" USING btree ("trigger_id");