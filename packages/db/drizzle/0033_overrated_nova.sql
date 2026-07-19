ALTER TABLE "v2_provider_keys" ADD COLUMN "last_revalidated_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "v2_provider_keys_revalidation_idx" ON "v2_provider_keys" USING btree ("last_revalidated_at" NULLS FIRST,"created_at","user_id","provider") WHERE "v2_provider_keys"."disabled_at" is null;

-- Raw post-deploy migrations 0043-0052 own the target-schema contractions,
-- replacement indexes, canonical checks, and resource-deletion job DDL. This
-- Drizzle migration intentionally contains only the additive provider-key DDL.
