ALTER TABLE "v2_entitlements" ADD COLUMN "max_projects_override" integer;--> statement-breakpoint
ALTER TABLE "v2_entitlements" ADD CONSTRAINT "v2_entitlements_max_projects_override_check" CHECK ("v2_entitlements"."max_projects_override" is null or "v2_entitlements"."max_projects_override" > 0);--> statement-breakpoint
GRANT SELECT (max_projects_override) ON TABLE public.v2_entitlements TO app_agent;
