# @cheatcode/webhooks-worker

Webhook ingress for Clerk, Polar, Composio, Daytona, and signed internal ops alerts.
Every handler verifies the raw signature, dedupes the authenticated event identity through
`WebhookIdempotencyStore`, and enqueues `WebhookWorkflow` for durable database, cache, and
observability mutations. Daytona lifecycle deliveries retain their signed Svix message id, and
cache writes are serialized per sandbox by event time so an older concurrent delivery cannot
overwrite a newer state. Internal alert delivery ids are deterministic for exact-body retries.
The idempotency Durable Object reconciles its deployed SQLite tables behind the constructor input
gate, transactionally preserving valid event, Daytona-state, and maintenance-command rows while
removing retired columns; an unknown lossy shape fails closed.
Signed `/internal/webhooks/replay` commands also claim a durable envelope identity before changing
Workflow state, so the same authenticated maintenance request cannot restart or resume twice.
`OpsMaintenanceWorkflow` runs analytics watchdogs, daily
retention metrics, billing-event retention, generated-output retention, BYOK maintenance inventory,
and Clerk-driven GDPR deletion lifecycle jobs from Worker cron/webhook triggers. Deletion jobs call the agent
and gateway workers through Service Bindings to clear Durable Object state before
removing R2 and Postgres rows. These destructive calls use the shared, versioned
`ccm1` signature contract, which binds method, pathname, millisecond timestamp,
and exact body hash without binding the Service Binding origin. `/internal/alert`
records Cloudflare-native alert events.
Provider request bodies are stream-bounded to 1 MiB before signature verification;
Daytona and signed internal endpoints use a 64 KiB ceiling.
Analytics Engine SQL reads are timeout- and byte-bounded before schema narrowing.
Polar cleanup calls have a 30-second request deadline, a 1 MiB response-stream
ceiling, and bounded order pagination.

Deletion Workflows keep only the small fenced identity/billing context in Workflow
state. Run Durable Objects and Composio connections are loaded and removed in 500-item
keyset pages; R2 objects are deleted in native 1,000-object batches. Sandbox account
state is destroyed once, and each database/external page is its own retriable step with
cursor-progress checks. The ops Workflow config uses Cloudflare's 25,000-step maximum so
large accounts are not constrained by the default 10-step setting; page sizes still
bound each step's memory and request payload.

Expired generated outputs are scanned through the expiry/id index in bounded keyset pages.
Each page deletes its objects from the configured R2 bucket before conditionally deleting
the exact matching Postgres rows in a separate step. R2 deletion is idempotent, so a failed
database step leaves only expired metadata that the same or next daily run can safely retry.
The daily run processes at most 50,000 records; any larger backlog is carried into the next run.
The `cheatcode-outputs` bucket also has a 60-day `expired-output-failsafe` lifecycle rule. It is
deliberately longer than the application-owned 30-day expiry: the Workflow remains responsible for
coordinated R2/Postgres deletion, while the native rule bounds storage leakage during a prolonged
maintenance outage.

After the grace period, a deletion Workflow atomically claims the exact Clerk
soft-delete generation in Postgres before any irreversible external work. A
Clerk recreation/update may cancel during grace, but cannot reactivate that row
after the fence is claimed. Final deletion atomically records a one-way Clerk
identity tombstone under the same advisory lock used by Clerk upserts, so stale
deliveries cannot recreate an erased account and a lost final response retries
idempotently.

Composio expiry events carry a connected-account ID but no application user ID.
The handler therefore resolves that Composio-project-global ID through the database
primary key; ownership and toolkit assignment are immutable after insertion,
and terminal status changes atomically reconcile the user's active default.

## Code Checks

```bash
pnpm --filter @cheatcode/webhooks-worker typecheck
```

## Env

- `CHEATCODE_ENVIRONMENT` (`production` in committed Wrangler config; local generated config overrides it)
- `CHEATCODE_RELEASE_SHA` (required for production deployments)
- `CF_VERSION_METADATA`
- `CLERK_WEBHOOK_SIGNING_SECRET`
- `DAYTONA_WEBHOOK_SIGNING_SECRET` (required; the endpoint's Svix signing secret from Daytona)
- `COMPOSIO_API_KEY`
- `ENTITLEMENTS_CACHE`
- `SANDBOX_STATE`
- `GATEWAY`
- `HYPERDRIVE`
- `INTERNAL_MAINTENANCE_SECRET`
- `POLAR_ACCESS_TOKEN`
- `POLAR_SERVER` (`production` by default; set `sandbox` only with a sandbox token)
- `POLAR_WEBHOOK_SECRET`
- `POLAR_PRODUCT_ID_PRO`, `POLAR_PRODUCT_ID_PREMIUM`, `POLAR_PRODUCT_ID_ULTRA`, `POLAR_PRODUCT_ID_MAX`
  form the environment-scoped product-to-tier catalog used when reconciling Polar Customer State.
- `COMPOSIO_WEBHOOK_SECRET`
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_ANALYTICS_API_TOKEN`
- `INTERNAL_ALERT_WEBHOOK_SECRET`
- `INTERNAL_ALERT_WEBHOOK_URL`
- `OPS_WORKFLOW`
- `R2_OUTPUTS`
- `R2_OUTPUTS_BUCKET_NAME` (must identify the bucket bound as `R2_OUTPUTS`)
- `R2_UPLOADS`
- `WEBHOOK_IDEMPOTENCY`
- `WEBHOOK_WORKFLOW`
- `USER_EVENTS`, `ERROR_EVENTS`, `PERFORMANCE_METRICS`
