# @cheatcode/webhooks-worker

Webhook ingress for Clerk, Polar, Composio, and signed internal ops alerts.
Provider handlers verify raw signatures, dedupe event ids through
`WebhookIdempotencyStore`, and enqueue `WebhookWorkflow` for durable database
and cache mutations. `OpsMaintenanceWorkflow` runs analytics watchdogs, daily
usage rollups, BYOK maintenance inventory, and Clerk-driven GDPR deletion
lifecycle jobs from Worker cron/webhook triggers. Deletion jobs call the agent
and gateway workers through Service Bindings to clear Durable Object state before
removing R2 and Postgres rows. The Blaxel fallback path deletes both project
sandboxes and their derived persistent volumes when the agent Worker binding is
unavailable. `/internal/alert` records Cloudflare-native alert events.

## Code Checks

```bash
pnpm --filter @cheatcode/webhooks-worker typecheck
```

## Env

- `CLERK_WEBHOOK_SIGNING_SECRET` preferred, or `CLERK_WEBHOOK_SECRET` for legacy local envs
- `BL_API_KEY`
- `BL_WORKSPACE`
- `BL_REGION`
- `COMPOSIO_API_KEY`
- `ENTITLEMENTS_CACHE`
- `GATEWAY`
- `HYPERDRIVE`
- `INTERNAL_MAINTENANCE_SECRET`
- `POLAR_ACCESS_TOKEN`
- `POLAR_WEBHOOK_SECRET`
- `COMPOSIO_WEBHOOK_SECRET`
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_ANALYTICS_API_TOKEN`
- `INTERNAL_ALERT_WEBHOOK_SECRET`
- `INTERNAL_ALERT_WEBHOOK_URL`
- `OPS_WORKFLOW`
- `R2_OUTPUTS`
- `R2_SNAPSHOTS`
- `R2_UPLOADS`
- `WEBHOOK_IDEMPOTENCY`
- `WEBHOOK_WORKFLOW`
