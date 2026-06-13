CREATE TABLE "v2_user_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"agent_display_name" text,
	"global_memory" text,
	"appbuilder_default_model" text,
	"general_default_model" text,
	"appbuilder_default_budget_usd" numeric(10, 2),
	"general_default_budget_usd" numeric(10, 2),
	"disabled_models" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"onboarding_completed_at" timestamp with time zone,
	"onboarding_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "v2_user_profiles" ADD CONSTRAINT "v2_user_profiles_user_id_v2_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."v2_users"("id") ON DELETE cascade ON UPDATE no action;