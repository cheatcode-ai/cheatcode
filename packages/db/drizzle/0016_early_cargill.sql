-- The automation product surface is intentionally removed with no runtime compatibility
-- layer. Preserve existing customer data under retired names so this release cannot turn
-- an application cleanup into an implicit production data-destruction event. A later,
-- separately approved retention migration may export and drop these retired tables.
ALTER TABLE IF EXISTS "v2_automation_run_requests"
  RENAME TO "v2_retired_automation_run_requests_20260715";--> statement-breakpoint
ALTER TABLE IF EXISTS "v2_automation_runs"
  RENAME TO "v2_retired_automation_runs_20260715";--> statement-breakpoint
ALTER TABLE IF EXISTS "v2_automations"
  RENAME TO "v2_retired_automations_20260715";--> statement-breakpoint

REVOKE ALL ON TABLE
  "v2_retired_automation_run_requests_20260715",
  "v2_retired_automation_runs_20260715",
  "v2_retired_automations_20260715"
FROM app_worker;
