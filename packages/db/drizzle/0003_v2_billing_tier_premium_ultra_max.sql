ALTER TABLE "v2_entitlements" DROP CONSTRAINT IF EXISTS "v2_entitlements_tier_check";--> statement-breakpoint
UPDATE "v2_entitlements" SET "tier" = 'premium' WHERE "tier" = 'team';--> statement-breakpoint
UPDATE "v2_entitlements" SET "tier" = 'max' WHERE "tier" = 'enterprise';--> statement-breakpoint
ALTER TABLE "v2_entitlements" ADD CONSTRAINT "v2_entitlements_tier_check" CHECK ("v2_entitlements"."tier" in ('free','pro','premium','ultra','max'));
