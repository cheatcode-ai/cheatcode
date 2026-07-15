CREATE TABLE "v2_deleted_clerk_identities" (
	"clerk_identity_hash" text PRIMARY KEY NOT NULL,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "v2_deleted_clerk_identities_hash_check" CHECK ("v2_deleted_clerk_identities"."clerk_identity_hash" ~ '^[0-9a-f]{64}$')
);
