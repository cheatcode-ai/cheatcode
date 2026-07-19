# @cheatcode/webhooks-worker

Webhook ingress for Clerk, Polar, Composio, Daytona, and signed internal ops alerts.
Every handler verifies the raw signature, dedupes the authenticated event identity through
`WebhookIdempotencyStore`, and enqueues `WebhookWorkflow` for durable database, cache, and
observability mutations. Daytona lifecycle deliveries retain their signed Svix message id, and
cache writes are serialized per sandbox by event time so an older concurrent delivery cannot
overwrite a newer state. Internal alert delivery ids are deterministic for exact-body retries.
The store owns exact event, Daytona-state, and maintenance-command tables in its Durable Object
namespace and transactionally reconciles dormant objects when they are next activated. Provider
processing remains independently idempotent through deterministic Workflow
instance IDs, so event-cache expiry cannot repeat a provider mutation.
The provider database result is checkpointed before entitlement-cache refresh,
Clerk-to-Polar profile projection, or analytics emission. Those effects have
separate retryable Workflow steps, and an equal-version Clerk replay reapplies
the idempotent Polar projection so a database commit immediately before a lost
Workflow checkpoint cannot suppress it. Analytics carries the provider event ID
for append-only deduplication.
Composio ingress is V3-only: it accepts the current `composio.trigger.message` and
`composio.connected_account.expired` envelopes, requires the documented event-specific identity
fields, and verifies only exact `v1,<base64>` signature tokens (including provider key-rotation
sets). Legacy payload versions and field aliases are rejected at ingress.
Signed `/internal/webhooks/replay` commands also claim a durable envelope identity before changing
Workflow state, so the same authenticated maintenance request cannot restart or resume twice.
`OpsMaintenanceWorkflow` runs analytics watchdogs, daily
retention metrics, generated-output retention, BYOK maintenance inventory,
and Clerk-driven GDPR deletion lifecycle jobs from Worker cron/webhook triggers. Account deletion
jobs call the agent Worker through a Service Binding and clear quota state through a direct
cross-Worker Durable Object binding before removing R2 and Postgres rows. These destructive
agent calls use the isolated `ccm2` agent-lifecycle capability, binding the
webhooks issuer, agent audience, method, pathname, millisecond timestamp, UUID
nonce, and exact body hash. The Agent receiver pins the `agent.internal` Service
Binding host and revalidates the authoritative database deletion generation before
changing state. `/internal/alert` records Cloudflare-native alert events.

The release-only workspace and Daytona snapshot operation is also owned by
`OpsMaintenanceWorkflow`. Every nondeleted user is paged, including users with zero active
projects, so an already-validated workspace constraint cannot skip future snapshot releases.
It pages only compact owner IDs into Workflow history, then loads one
owner's complete project inventory inside each prepare/commit/finalize operation so a large owner
page cannot breach Cloudflare's 1 MiB step-result limit. Each deterministic generation handles at
most 2,000 owners (about 6,042 steps), carries a chained evidence digest and keyset cursor into the
next generation, and therefore has no total-owner cap under the 25,000-step platform ceiling. Each
owner's durable sandbox fence is prepared before a maintenance-locked Postgres compare-and-swap
and finalized against the same canonical goal. Finalization advances at most one bounded
local-disk transfer chunk when needed; an incomplete owner is resumed with the same keyset cursor
before later users can advance. Restarted generations and reused continuations converge
idempotently. Final evidence includes absent/current/upgraded sandbox counts, the target snapshot,
and chained canonical-workspace and sandbox digests. Schema contraction and release opening remain
blocked until the verifier follows the exact generation chain for the closed release SHA.

Signed `/internal/resource-deletions` requests register project and thread deletion jobs in
`v2_resource_deletion_jobs`. `ResourceDeletionWorkflow` is separate from ops maintenance: each
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
Daytona and signed internal endpoints use a 64 KiB ceiling.
Analytics Engine SQL reads are timeout- and byte-bounded before schema narrowing.
Polar cleanup calls have a 30-second request deadline, a 1 MiB response-stream
ceiling, and one 100-order page per durable account-deletion action.

Daily activation and generated-output cleanup are one restart-safe state machine in
`v2_retention_jobs`. The daily trigger registers one UTC-day row; the five-minute reconciler leases
queued or expired rows and recreates every live reserved continuation for the active Worker release.
An errored or terminated deterministic instance is restarted, a failed initial creation returns to
database backoff, and a continuation reserved before its parent exits remains discoverable even if
child creation never returned. Completed day rows are retained as idempotency tombstones for 32 days
and then purged.

Activation uses stable event-kind/user keyset pages of 200, below
[Analytics Engine's 250-data-point invocation limit](https://developers.cloudflare.com/analytics/analytics-engine/limits/).
Every page includes the cohort day plus a deterministic event identity, validates strict key order,
and compare-and-swaps the exact lease, phase, and both persisted cursors. A generation emits at most
four pages. Initial and continuation payloads are distinct and bind the UTC day, continuation,
release UUID, and lease UUID into a deterministic identity below Cloudflare's 100-character limit.
The chain therefore has no total activation-row cap, while conservative step retries keep each
generation comfortably inside its two-hour database lease. Cleanup cannot begin until the terminal
activation page atomically changes the durable phase. Since Analytics Engine is append-only and a
Workflow step may replay, cohort SQL must use `count(DISTINCT blob6)` for those event identities.
BYOK maintenance dispatches
every five minutes and claims only ten fingerprints per database step under
15-minute UUID leases; each claimed key gets its own durable provider step. That
step closes the user-context transaction before validation, records completion
only after a conclusive provider response, and mutates a key only when its exact
fingerprint and unexpired lease remain current. Each instance handles at most 200
claims before handing remaining due work to a deterministic continuation, so a
backlog drains without a total cohort cap and transient failures become claimable
again after lease expiry.

All three Workflows use Cloudflare's maximum 25,000-step allowance as an operational ceiling, not
as a product completion, token, cost, or total-work cap. Workflow history stays small because
durable progress lives in Postgres and unfinished work advances through deterministic
continuations. R2 objects use native 1,000-object batches, indexed output pages contain 50 rows,
project run tombstones use 25-run pages, and thread jobs complete each run's Durable Object plus R2
prefix before advancing. The Worker keeps Cloudflare's explicit 10,000-subrequest ceiling;
continuation boundaries, rather than a total-row cap, bound each execution.

Expired generated outputs are scanned through the expiry/id index in 500-row keyset pages.
Before the first output cursor advances, cleanup drains only upload intents whose terminal run,
explicit awaited-artifact quiescence timestamp, and `cleanup_not_before` remote-side-effect grace
deadline are all at or before the day's fixed cutoff. Each intent page revalidates the exact
retention lease, deletes its deterministic R2 keys, and removes the matching intent identities
transactionally while retaining the existing `cleanup` phase. Unquiesced or grace-fenced intents
remain indexed for recovery. Generated outputs use the same terminal-run requirement in both page
selection and exact row deletion, so an active run can renew an idempotently replayed output before
issuing a download capability without racing retention. A database trigger makes terminal run state
immutable, preserving that maintenance proof across the object-first deletion gap.
Each page deletes its objects from the `R2_OUTPUTS` binding before conditionally deleting
the exact matching Postgres rows and advancing the cursor in one database transaction. The R2
attempt first compare-and-swaps the exact current phase and cursor; the transactional row deletion
repeats that exact guard, so an earlier cached step cannot regress or destroy work after progress
moves. R2 deletion is idempotent, so a failed database step safely retries the same page. A
generation handles at most two pages and hands the fenced lease to another continuation. There is
no total cleanup-row cap, and the day is terminal only after an empty cleanup page is observed.
The `cheatcode-outputs` bucket also has a 60-day `expired-output-failsafe` lifecycle rule. It is
deliberately longer than the application-owned 30-day expiry: the Workflow remains responsible for
coordinated R2/Postgres deletion, while the native rule bounds storage leakage during a prolonged
maintenance outage. Every protected backend release verifies the complete lifecycle rule set against
`infra/cloudflare/production-r2-contract.json` before writers close and again before the gateway opens.

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
before customer deletion or phase advance. A pending refund defers the job; a failed, canceled,
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

Production binds `CHEATCODE_RELEASE_GATE` explicitly. `draining` rejects HTTP,
cron admission, and fresh idempotency writes while already-admitted Webhook,
ResourceDeletion, ordinary Ops, and deletion-continuation work may finish. `closed`
also fences those continuation paths. Only the exact release-scoped
workspace/sandbox Ops Workflow may run closed, and it reaches the agent through
the signed maintenance contract. `/health` always reports the exact gate and SHA.

## Code Checks

```bash
pnpm --filter @cheatcode/webhooks-worker typecheck
```

## Env

- `CHEATCODE_ENVIRONMENT` (`production` in committed Wrangler config; local generated config overrides it)
- `CHEATCODE_RELEASE_SHA` (required for production deployments)
- `CHEATCODE_RELEASE_GATE` (`open` in source; coordinated releases inject `draining` and then `closed` before database migration/reconciliation)
- `CF_VERSION_METADATA`
- `CLERK_WEBHOOK_SIGNING_SECRET`
- `DAYTONA_WEBHOOK_SIGNING_SECRET` (required; the endpoint's Svix signing secret from Daytona)
- `COMPOSIO_API_KEY`
- `ENTITLEMENTS_CACHE`
- `SANDBOX_STATE`
- `QUOTA_TRACKER`
- `HYPERDRIVE` (dedicated config whose database login is exactly `app_webhooks`)
- `DATABASE_CONTEXT_SIGNING_SECRET_WEBHOOKS` (role-specific Secrets Store binding;
  must match the `app_webhooks` Supabase Vault HMAC secret)
- `GATEWAY_TO_WEBHOOKS_RESOURCE_DELETION_SECRET` (ccm2 resource-deletion verifier)
- `WEBHOOKS_TO_AGENT_LIFECYCLE_SECRET` (ccm2 agent-lifecycle caller)
- `INTERNAL_WEBHOOK_REPLAY_SECRET` (ccm2 operator replay verifier only)
- `RELEASE_DATABASE_READINESS_SECRET` (ccm2 database-readiness verifier only)
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
- `RESOURCE_DELETION_WORKFLOW`
- `R2_OUTPUTS`
- `WEBHOOK_IDEMPOTENCY`
- `WEBHOOK_WORKFLOW`
- `USER_EVENTS`, `ERROR_EVENTS`, `PERFORMANCE_METRICS`
