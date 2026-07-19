ALTER TABLE "v2_messages" ADD COLUMN "agent_run_segment" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "v2_messages" ADD COLUMN "agent_run_segment_final" boolean DEFAULT true NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "v2_messages_agent_run_segment_assistant_uidx" ON "v2_messages" USING btree ("agent_run_id","agent_run_segment") WHERE "v2_messages"."agent_run_id" is not null and "v2_messages"."role" = 'assistant';--> statement-breakpoint
CREATE UNIQUE INDEX "v2_messages_agent_run_final_assistant_uidx" ON "v2_messages" USING btree ("agent_run_id") WHERE "v2_messages"."agent_run_id" is not null and "v2_messages"."role" = 'assistant' and "v2_messages"."agent_run_segment_final";--> statement-breakpoint
ALTER TABLE "v2_messages" ADD CONSTRAINT "v2_messages_agent_run_segment_check" CHECK ("v2_messages"."agent_run_segment" >= 0);--> statement-breakpoint
ALTER TABLE "v2_messages" ADD CONSTRAINT "v2_messages_agent_run_segment_scope_check" CHECK (("v2_messages"."agent_run_segment" = 0 and "v2_messages"."agent_run_segment_final") or ("v2_messages"."role" = 'assistant' and "v2_messages"."agent_run_id" is not null));--> statement-breakpoint
DO $$
DECLARE
  oversized_count bigint;
BEGIN
  SELECT count(*)
    INTO oversized_count
    FROM public.v2_messages
   WHERE octet_length(parts::text) > 196608;

  IF oversized_count > 0 THEN
    RAISE EXCEPTION
      'assistant transcript segmentation preflight refused: % existing message rows exceed 196608 bytes',
      oversized_count
      USING HINT = 'Run the reviewed lossless closed-gate transcript segmentation backfill, then retry this migration.';
  END IF;
END
$$;--> statement-breakpoint
ALTER TABLE "v2_messages" ADD CONSTRAINT "v2_messages_parts_size_check" CHECK (octet_length("v2_messages"."parts"::text) <= 196608);
