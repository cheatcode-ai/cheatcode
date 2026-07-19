-- Expand only: raw post-deploy migration 0054 removes the superseded index
-- after every Worker uses lease-backed claims.
ALTER TABLE "v2_provider_keys" ADD COLUMN "revalidation_claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "v2_provider_keys" ADD COLUMN "revalidation_lease_token" uuid;--> statement-breakpoint
CREATE INDEX "v2_provider_keys_revalidation_lease_idx" ON "v2_provider_keys" USING btree ("last_revalidated_at" NULLS FIRST,"revalidation_claimed_at" NULLS FIRST,"created_at","user_id","provider") WHERE "v2_provider_keys"."disabled_at" is null;--> statement-breakpoint
ALTER TABLE "v2_provider_keys" ADD CONSTRAINT "v2_provider_keys_revalidation_lease_pair_check" CHECK (("v2_provider_keys"."revalidation_claimed_at" is null and "v2_provider_keys"."revalidation_lease_token" is null) or ("v2_provider_keys"."revalidation_claimed_at" is not null and "v2_provider_keys"."revalidation_lease_token" is not null));
