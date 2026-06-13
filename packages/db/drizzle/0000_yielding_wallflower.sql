CREATE TABLE "v2_agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT public.uuidv7() NOT NULL,
	"thread_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text NOT NULL,
	"model_id" text,
	"tokens_in" integer DEFAULT 0 NOT NULL,
	"tokens_out" integer DEFAULT 0 NOT NULL,
	"tokens_cached" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "v2_billing_events" (
	"id" uuid PRIMARY KEY DEFAULT public.uuidv7() NOT NULL,
	"user_id" uuid,
	"event_type" text NOT NULL,
	"polar_event_id" text,
	"payload" jsonb,
	"processed_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "v2_billing_events_polar_event_id_unique" UNIQUE("polar_event_id")
);
--> statement-breakpoint
CREATE TABLE "v2_entitlements" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"tier" text DEFAULT 'free' NOT NULL,
	"polar_customer_id" text,
	"polar_subscription_id" text,
	"subscription_status" text DEFAULT 'none' NOT NULL,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"current_period_start" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"max_projects" integer DEFAULT 3 NOT NULL,
	"max_concurrent_sandboxes" integer DEFAULT 1 NOT NULL,
	"max_seats" integer DEFAULT 1 NOT NULL,
	"quota_sandbox_hours" numeric DEFAULT '5' NOT NULL,
	"quota_composio_calls" integer DEFAULT 1000 NOT NULL,
	"quota_deployments" integer DEFAULT 5 NOT NULL,
	"flag_private_projects" boolean DEFAULT false NOT NULL,
	"flag_sso" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"webhook_event_id" text,
	"source" text,
	CONSTRAINT "v2_entitlements_tier_check" CHECK ("v2_entitlements"."tier" in ('free','pro','team','enterprise'))
);
--> statement-breakpoint
CREATE TABLE "v2_generated_outputs" (
	"id" uuid PRIMARY KEY DEFAULT public.uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"project_id" uuid,
	"agent_run_id" uuid,
	"kind" text NOT NULL,
	"filename" text NOT NULL,
	"r2_bucket" text DEFAULT 'cheatcode-outputs' NOT NULL,
	"r2_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "v2_messages" (
	"id" uuid PRIMARY KEY DEFAULT public.uuidv7() NOT NULL,
	"thread_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"parts" jsonb NOT NULL,
	"agent_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "v2_projects" (
	"id" uuid PRIMARY KEY DEFAULT public.uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"mode" text NOT NULL,
	"master_instructions" text,
	"sandbox_id" text,
	"container_backup" jsonb,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"over_quota" boolean DEFAULT false NOT NULL,
	"archived_pending_action" boolean DEFAULT false NOT NULL,
	"archive_after" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "v2_provider_keys" (
	"id" uuid PRIMARY KEY DEFAULT public.uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"vault_secret_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"last_used_at" timestamp with time zone,
	"disabled_at" timestamp with time zone,
	"disabled_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "v2_threads" (
	"id" uuid PRIMARY KEY DEFAULT public.uuidv7() NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text,
	"active_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "v2_usage_daily_totals" (
	"user_id" uuid NOT NULL,
	"day" date NOT NULL,
	"total_input_tokens" bigint DEFAULT 0 NOT NULL,
	"total_output_tokens" bigint DEFAULT 0 NOT NULL,
	"total_cached_tokens" bigint DEFAULT 0 NOT NULL,
	"total_cost_usd" numeric(12, 4) DEFAULT '0' NOT NULL,
	"agent_run_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "v2_usage_daily_totals_user_id_day_pk" PRIMARY KEY("user_id","day")
);
--> statement-breakpoint
CREATE TABLE "v2_usage_events" (
	"id" uuid PRIMARY KEY DEFAULT public.uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"agent_run_id" uuid,
	"event_type" text NOT NULL,
	"provider" text,
	"model" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cached_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "v2_user_integrations" (
	"user_id" uuid NOT NULL,
	"integration" text NOT NULL,
	"composio_connection_id" text NOT NULL,
	"status" text NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "v2_user_integrations_user_id_integration_pk" PRIMARY KEY("user_id","integration")
);
--> statement-breakpoint
CREATE TABLE "v2_users" (
	"id" uuid PRIMARY KEY DEFAULT public.uuidv7() NOT NULL,
	"clerk_id" text NOT NULL,
	"email" text NOT NULL,
	"display_name" text,
	"avatar_url" text,
	"polar_customer_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "v2_users_clerk_id_unique" UNIQUE("clerk_id"),
	CONSTRAINT "v2_users_polar_customer_id_unique" UNIQUE("polar_customer_id")
);
--> statement-breakpoint
ALTER TABLE "v2_agent_runs" ADD CONSTRAINT "v2_agent_runs_thread_id_v2_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."v2_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "v2_agent_runs" ADD CONSTRAINT "v2_agent_runs_user_id_v2_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."v2_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "v2_billing_events" ADD CONSTRAINT "v2_billing_events_user_id_v2_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."v2_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "v2_entitlements" ADD CONSTRAINT "v2_entitlements_user_id_v2_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."v2_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "v2_generated_outputs" ADD CONSTRAINT "v2_generated_outputs_user_id_v2_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."v2_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "v2_generated_outputs" ADD CONSTRAINT "v2_generated_outputs_project_id_v2_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."v2_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "v2_generated_outputs" ADD CONSTRAINT "v2_generated_outputs_agent_run_id_v2_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."v2_agent_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "v2_messages" ADD CONSTRAINT "v2_messages_thread_id_v2_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."v2_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "v2_messages" ADD CONSTRAINT "v2_messages_user_id_v2_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."v2_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "v2_projects" ADD CONSTRAINT "v2_projects_user_id_v2_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."v2_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "v2_provider_keys" ADD CONSTRAINT "v2_provider_keys_user_id_v2_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."v2_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "v2_threads" ADD CONSTRAINT "v2_threads_project_id_v2_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."v2_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "v2_threads" ADD CONSTRAINT "v2_threads_user_id_v2_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."v2_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "v2_usage_daily_totals" ADD CONSTRAINT "v2_usage_daily_totals_user_id_v2_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."v2_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "v2_usage_events" ADD CONSTRAINT "v2_usage_events_user_id_v2_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."v2_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "v2_user_integrations" ADD CONSTRAINT "v2_user_integrations_user_id_v2_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."v2_users"("id") ON DELETE cascade ON UPDATE no action;
