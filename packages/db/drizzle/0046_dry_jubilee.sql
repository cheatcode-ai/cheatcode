ALTER TABLE "v2_threads" ADD COLUMN "latest_model_id" text;--> statement-breakpoint
ALTER TABLE "v2_threads" ADD CONSTRAINT "v2_threads_latest_model_id_check" CHECK ("v2_threads"."latest_model_id" is null or (
        char_length("v2_threads"."latest_model_id") <= 200
        and "v2_threads"."latest_model_id"
          ~ '^(anthropic|deepseek|google|openai|openrouter)/[^[:space:]]+$'
      ));
