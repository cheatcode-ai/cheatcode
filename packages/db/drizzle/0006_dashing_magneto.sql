CREATE TABLE "v2_replay_shares" (
	"id" uuid PRIMARY KEY DEFAULT public.uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"thread_id" uuid NOT NULL,
	"visibility" text DEFAULT 'unlisted' NOT NULL,
	"title" text NOT NULL,
	"author_name" text NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "v2_replay_shares" ADD CONSTRAINT "v2_replay_shares_user_id_v2_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."v2_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "v2_replay_shares" ADD CONSTRAINT "v2_replay_shares_thread_id_v2_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."v2_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "v2_replay_shares_user_idx" ON "v2_replay_shares" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "v2_replay_shares_thread_active_idx" ON "v2_replay_shares" USING btree ("thread_id") WHERE revoked_at is null;
