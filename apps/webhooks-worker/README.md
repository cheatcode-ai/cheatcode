# @cheatcode/webhooks-worker

Webhook ingress for Clerk, Polar, Composio, and Daytona.
Every handler verifies the raw signature, dedupes the authenticated event identity through
`WebhookIdempotencyStore`, and enqueues `WebhookWorkflow` for durable database, cache, and
observability mutations. Daytona lifecycle deliveries retain their signed Svix message id, and
cache writes are serialized per sandbox by event time so an older concurrent delivery cannot
overwrite a newer state. The store owns exact event and Daytona-state tables in its Durable Object
namespace and transactionally reconciles dormant objects when they are next activated. Provider
processing remains independently idempotent through deterministic Workflow
instance IDs, so event-cache expiry cannot repeat a provider mutation.
The provider database result is checkpointed before entitlement-cache refresh,
Clerk-to-Polar profile projection, or analytics emission. Those effects have
separate retryable Workflow steps, and an equal-version Clerk replay reapplies
the idempotent Polar projection so a database commit immediately before a lost
Workflow checkpoint cannot suppress it. Analytics carries the provider event ID
for append-only deduplication.
Polar reconciliation preserves operator-granted project-limit overrides and applies over-quota
resource policy from the effective limit rather than the catalog default.
Composio ingress is V3-only: it accepts the current `composio.trigger.message` and
`composio.connected_account.expired` envelopes, requires the documented event-specific identity
fields, and verifies only exact `v1,<base64>` signature tokens (including provider key-rotation
sets). Legacy payload versions and field aliases are rejected at ingress.
`DailyMaintenanceWorkflow` removes abandoned uploads, while `UserDeletionWorkflow`
owns Clerk-driven GDPR deletion lifecycle jobs. BYOK inventory runs directly from
the five-minute scheduled handler because its database UUID leases provide retry
and continuation state. Account deletion jobs call the agent Worker through
named Service Bindings before removing R2 and Postgres rows.
`AgentLifecycleEntrypoint` grants destructive agent-state operations, while the
separate `QuotaDeletionEntrypoint` grants only `deleteAllState` on the
agent-owned quota Durable Object. Cloudflare-authenticated properties pin both
bindings to the `webhooks` caller and their exact capabilities. The Agent Worker
revalidates the authoritative database deletion generation before changing
agent state.

The gateway-only `ResourceDeletionEntrypoint` registers project and thread
deletion jobs in `v2_resource_deletion_jobs`; the default HTTP handler exposes no
equivalent destructive route. `ResourceDeletionWorkflow` is separate from ops maintenance: each
instance leases one exact soft-delete generation, performs at most eight bounded actions, persists
its phase/cursor, and hands the lease to a deterministic continuation. It tombstones affected run
Durable Objects, removes the project sandbox workspace when applicable, deletes indexed output
objects before their rows, drains orphan R2 prefixes using R2's authoritative `truncated` flag,
clears active-run pointers, and only then hard-deletes the relational graph and job row. Every
irreversible step revalidates the exact lease, resource generation, phase, and NULL-safe cursor
inside its durable callback; database cleanup and finalization use the same guard transactionally.

The five-minute reconciler discovers every pending generation with set-based inserts and leases at
most 25 ready jobs, leaving Workflow creation-rate headroom and avoiding oldest-page starvation.
Claims share the database migration advisory fence, require run-owned generated outputs, and
remain disabled until the canonical workspace constraint is validated. Exhausted transient errors
are deferred with database backoff; permanent or repeatedly failing jobs are quarantined, emitted
to native logs/Analytics Engine, and terminated with `NonRetryableError` instead of being restarted.
Ambiguous or partial Workflow batch creation advances the fenced continuation before retry, and
repeated expired leases use the same quarantine threshold instead of cycling forever.
Provider request bodies are stream-bounded to 1 MiB before signature verification;
Daytona webhook bodies use a 64 KiB ceiling.
Polar cleanup calls have a 30-second request deadline, a 1 MiB response-stream
ceiling, and one 100-order page per durable account-deletion action.

Daily maintenance has exactly one deterministic Workflow identity per UTC day:
`daily-maintenance-YYYY-MM-DD`. Its strict immutable payload carries that day and
the scheduled instant as `cleanupCutoff`; a duplicate daily trigger reuses the
retained instance through the shared deterministic-instance helper. There is no
daily-maintenance table, lease, admission reconciler, release fence, or
continuation instance. Creation failures and terminal failures that are not
replayed by a duplicate delivery recover through the next day's new instance.

Cleanup scans at most 500 upload intents per page whose terminal run, explicit
awaited-artifact quiescence timestamp, and `cleanup_not_before`
remote-side-effect grace deadline are all at or before the immutable cutoff.
Each page validates database key order, idempotently deletes its deterministic R2
keys, then deletes rows only when the exact id, R2 key, quiescence timestamp,
cleanup deadline, terminal-run proof, and cutoff still match. Unquiesced,
reactivated, or grace-fenced intents remain indexed for recovery. Committed
generated outputs remain outside this cleanup path.

BYOK maintenance runs directly from the five-minute scheduled handler. A pass
claims at most twenty ten-key pages under 15-minute UUID leases, closes each
short user-context transaction before provider validation, and records a
conclusive result only when the exact fingerprint and unexpired lease remain
current. Failed or interrupted work becomes claimable after lease expiry, so no
Workflow continuation state is required.

The Worker config gives each Workflow binding Cloudflare's 25,000-step
operational ceiling. User and resource deletion keep durable progress in
Postgres and advance through deterministic continuations; daily maintenance
keeps one day's bounded page steps in its Workflow history. R2 account cleanup
uses native 1,000-object batches, indexed output pages contain 50 rows, project
run tombstones use 25-run pages, and thread jobs complete each run's Durable
Object plus R2 prefix before advancing.

Clerk deletion is a durable Postgres soft-delete, not a sleeping Workflow. After the
30-day grace deadline, the five-minute reconciler discovers at most 25 new generations
and leases at most 25 queued or expired `v2_user_deletion_jobs`. Claiming a lease also
atomically installs the exact epoch-millisecond deletion fence. Each Workflow generation
performs at most eight actions and persists its phase, provider/keyset cursor, continuation,
lease, and failure state before handing work to an awaited deterministic continuation.
Cron reclaims failed or abandoned continuations after lease expiry, and a later Worker
release uses its current version identity without restarting retired code. There is no
total page, object, or action cap across generations. The first accepted Clerk deletion is
terminal: the identity lock rejects delayed create/update deliveries, and replayed delete
events cannot change the original grace generation. Create/update deliveries carry Clerk's
numeric `updated_at` source version into the database; older deliveries are explicit no-ops
and equal-version replays are idempotent, so arrival order cannot regress the identity profile.

The monotonic account sequence is run Durable Objects, shared sandbox, Polar billing,
quota Durable Object, Composio, R2 plus upload-intent rows, project archival, then relational
finalization. The run phase aborts and joins every AgentRun before the authoritative R2 prefix
sweep and exact intent deletion, preventing a late upload from recreating a removed object.
Every action first renews the job lease and revalidates the exact user-generation fence.
Destructive side effects repeat that lease and phase/cursor check inside their own durable
step attempt, so a cached validation cannot outlive an expired lease.

Polar order inspection is read-only and persists its page between actions. When the newest paid
subscription order has a prorated refundable balance, the Workflow commits exactly one immutable
`v2_user_deletion_refund_intents` row before revoking the subscription or creating a refund. The
row binds the deletion job, generation, order, amount, currency, and stable
`cheatcode:user-deletion-refund:<job-id>` identity. Every retry first lists that exact order's
refunds and accepts only the complete three-field metadata identity; otherwise it replays the same
[Polar idempotency key](https://polarsource-polar.mintlify.app/api-reference/introduction) on the
[refund create](https://polar.sh/docs/api-reference/refunds/create) request. Polar SDK retries are
disabled so Cloudflare Workflow owns the retry boundary. Exact provider ID/status evidence commits
under the exact billing-lease and intent row locks; webhooks-owned transition policy executes
inside that transaction, with SQL validation and CHECK constraints as persistence backstops.
A pending refund defers the job; a failed, canceled,
duplicate, partial, or mismatched identity quarantines it. The database trigger blocks leaving
`billing` or deleting the job while any refund intent is unresolved, so finalization fails closed
even after a provider commit, response loss, lease handoff, or Workflow-checkpoint loss.

Composio uses ten-connection keyset pages with at most five concurrent 30-second revocations; R2
uses its authoritative 1,000-object `truncated` batches. Replayed deletes treat already-missing
provider resources as success. Finalization atomically records a one-way Clerk identity tombstone
under the same advisory lock used by Clerk upserts and deletes the user plus its job row by cascade.
Transient failures return the job to cron with database backoff; permanent or repeatedly expired
work is quarantined and alerted.

Composio expiry events carry a connected-account ID but no application user ID.
The handler therefore resolves that Composio-project-global ID through the database
primary key; ownership and toolkit assignment are immutable after insertion,
and terminal status changes atomically reconcile the user's active default.

Production binds one immutable `CHEATCODE_RELEASE_SHA`, exposed by `/health`
only to the gateway's service-binding probe (`https://webhooks.internal/health`);
on the public webhook host the route answers as not found.
HTTP, cron, idempotency, deletion, and workflow continuation paths use their
normal durable ownership and idempotency contracts; database migrations retain
their separate target, role, lock, and schema validation.

## Code Checks

```bash
pnpm --filter @cheatcode/webhooks-worker typecheck
```

## Env

- `CHEATCODE_ENVIRONMENT` (`production` in committed Wrangler config; local generated config overrides it)
- `CHEATCODE_RELEASE_SHA` (required for production deployments)
- `CF_VERSION_METADATA`
- `AGENT_LIFECYCLE` (named `AgentLifecycleEntrypoint` Service Binding;
  granted only to webhooks with authenticated caller/capability properties)
- `CLERK_WEBHOOK_SIGNING_SECRET`
- `DAYTONA_WEBHOOK_SIGNING_SECRET` (required; the endpoint's Svix signing secret from Daytona)
- `COMPOSIO_API_KEY`
- `ENTITLEMENTS_CACHE`
- `SANDBOX_STATE`
- `QUOTA_DELETION` (named `QuotaDeletionEntrypoint` Service Binding to
  agent-worker; grants only `deleteAllState`)
- `HYPERDRIVE` (dedicated config whose database login is exactly `app_webhooks`)
- `DATABASE_CONTEXT_SIGNING_SECRET_WEBHOOKS` (role-specific Secrets Store binding;
  must match the `app_webhooks` Supabase Vault HMAC secret)
- `POLAR_ACCESS_TOKEN`
- `POLAR_SERVER` (`production` by default; set `sandbox` only with a sandbox token)
- `POLAR_WEBHOOK_SECRET`
- `POLAR_PRODUCT_ID_PRO`, `POLAR_PRODUCT_ID_PREMIUM`
  form the environment-scoped product-to-tier catalog used when reconciling Polar Customer State.
- `COMPOSIO_WEBHOOK_SECRET`
- `DAILY_MAINTENANCE_WORKFLOW`
- `RESOURCE_DELETION_WORKFLOW`
- `R2_OUTPUTS`
- `USER_DELETION_WORKFLOW`
- `WEBHOOK_IDEMPOTENCY`
- `WEBHOOK_WORKFLOW`
- `USER_EVENTS`, `ERROR_EVENTS`, `PERFORMANCE_METRICS`

## Public exports

- `DailyMaintenanceWorkflow`
- `ResourceDeletionEntrypoint`
- `ResourceDeletionWorkflow`
- `UserDeletionWorkflow`
- `WebhookIdempotencyStore`
- `WebhookWorkflow`
