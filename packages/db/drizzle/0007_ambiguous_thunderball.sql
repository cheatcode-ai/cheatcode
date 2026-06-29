CREATE TABLE "v2_user_skills" (
	"id" uuid PRIMARY KEY DEFAULT public.uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"category" text NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "v2_user_skills" ADD CONSTRAINT "v2_user_skills_user_id_v2_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."v2_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "v2_user_skills_user_idx" ON "v2_user_skills" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "v2_user_skills_user_name_idx" ON "v2_user_skills" USING btree ("user_id","name") WHERE deleted_at is null;