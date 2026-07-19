# @cheatcode/gateway-worker

Public Hono API entrypoint. It verifies Clerk JWTs, resolves the Clerk subject to the
internal `users.id` UUID, lazily syncs the user from Clerk on first authenticated request
when webhooks have not run yet, rate-limits requests, and forwards agent work to
`agent-worker` via Service Binding.
The bootstrap reads one canonical Clerk identity snapshot including `updated_at`;
the database compare-and-swap prevents a slower Backend API response or delayed webhook
from regressing a newer email, display name, or avatar.

Provider key writes validate each supported BYOK provider through
`packages/byok` before calling the Vault-backed RPC. Invalid keys are rejected
before plaintext is sent to storage, and new providers are blocked when the
current entitlement tier has reached its BYOK slot limit. Deleting a key reranks
the remaining provider catalog in the same transaction so a freed tier slot is
available immediately. Project and thread deletes enqueue an exact-generation
resource-deletion job through the webhooks Service Binding. That call uses the
isolated `ccm2` resource-deletion capability and binds gateway issuer, webhooks
audience, method, path, timestamp, nonce, and exact body hash. The webhooks
receiver pins `webhooks.internal`; no shared key or legacy signature format is
accepted.

User-scoped Postgres transactions contain database work only. Secrets Store,
KV, Durable Object, service-binding, weather, Polar, and Composio operations
finish before a short RLS transaction begins or start after it commits; they
are never parallelized across an open transaction. Read paths resolve the
entitlement cache outside Postgres, while project and BYOK writes read the
authoritative entitlement row under the same per-user advisory-lock order as
entitlement reconciliation.

`QuotaTracker` supports hard `try-consume` gates for connected-tool calls and
soft `record` metering for sandbox-hours that can exceed the plan limit while
still surfacing real usage in `/v1/limits`. Limit synchronization carries the
entitlement row's `updatedAt` version, and the Durable Object ignores older
writes so a stale KV or Worker request cannot overwrite a newer plan. That
endpoint reports only measured quotas; request rate-limit headers remain the
canonical live rate-limit state.

Billing routes create Polar checkout/portal sessions and manage end-of-period
cancellation/reactivation through `/v1/billing/state`, `/v1/billing/cancel`,
and `/v1/billing/reactivate`. They update V2 entitlement state and clear the
entitlement KV cache. Checkout accepts only an optional same-origin local path;
the gateway derives the trusted frontend origin and both Polar redirect URLs, so
callers cannot provide an external success or return URL. Final product verification still happens by operating the
Settings UI directly with `agent-browser`, not a billing test script.

Run creation requires the current Clerk primary email to be verified before the
request is forwarded to `agent-worker`, so authenticated but unverified users do
not spawn Daytona sandbox work.
JWT verification also requires `azp` to match one of the exact HTTP(S) origins in
`CLERK_AUTHORIZED_PARTIES`; production is pinned to `https://trycheatcode.com`.
Resolved Clerk Backend API keys fail closed unless they are `sk_live_` in
production or `sk_test_` in laptop development.

Run-creation idempotency bodies are capped at 64 KiB. The Durable Object uses a
five-minute in-flight claim lease and retains completed keys for 24 hours; completion
is awaited and safely retried so a lost response cannot leave a started run looking
unclaimed. This lease is an operational duplicate-request guard, not a run-duration,
token, or cost ceiling. Expensive reads and all writes fail closed when their rate-limit
object is unavailable, while cheap read-only routes may fail open for availability.
The gateway hashes the key and canonical request identity before forwarding, and the
database enforces one key per user. A lost or `5xx` service-binding response is retried
with that same identity, so the downstream row and run-keyed Durable Object converge on
one run. Reusing a key for a different body or thread fails closed.

Public Clerk credentials, cookies, proxy credentials, plaintext idempotency keys, and
caller-supplied `X-Cheatcode-*` headers terminate at the gateway. Normal service-binding
requests receive only gateway-minted internal identity/idempotency headers. Artifact downloads
use that boundary to mint an owner-checked short-lived URL; only the resulting HMAC-bound
streaming URL is public. Local preview traffic has a separate, explicit capability/cookie bridge.

Composio account sync follows provider cursors instead of treating the first
page as complete, and fails closed if a user exceeds the 1,000-account safety
boundary. Cheatcode creates and syncs private accounts only; shared Composio
accounts are outside the tenant model. Connected-account
IDs are bounded and validated at HTTP/provider boundaries; database upserts
preserve the original user and toolkit owner and fail closed on any identity
collision. Provider list failures surface as retriable upstream errors instead
of presenting an unmarked stale account snapshot. A complete successful sync
removes local rows that are absent from Composio after a 15-minute visibility
grace, closing failed-delete and abandoned-link residue without racing a fresh
OAuth link.
Composio v3.1 REST pages and catalog/tool payloads are byte-bounded before
parsing, then schema- and cardinality-bounded so a provider pagination fault
cannot grow Worker memory without limit.
Catalog and connected-account provider snapshots may load in parallel, but DB
reconciliation begins only after both external reads settle. Connect creates
the provider link first and compensates by deleting it if response validation
or local persistence fails. Delete performs a short ownership read, the
provider deletion, and a separate idempotent local reconciliation; no network
request is made while either RLS transaction is open.

Gateway emits `first_byok_key_added` after the first successful provider-key save
and accepts authenticated `/v1/user-events` activation pings from the real web UI.

Production releases use `CHEATCODE_RELEASE_GATE` as a fail-closed deployment
barrier. The deploy operation first publishes the final gateway bundle with the
gate set to `closed`; every public route, including `/health`, returns a
non-cacheable `503`. Agent and webhooks are then deployed with their own gates
set to `draining`; the gateway health body proves both service-bound downstream
SHAs and gates. The release drains AgentRun and every webhook, ops, and
resource-deletion Workflow before redeploying both services `closed` and allowing
DDL. In steady state, the public 200 `/health` response also fails closed unless
both downstream services report `open` at the gateway's exact release SHA. After closed reconciliation,
contractions, and Vercel promotion, agent and webhooks reopen first and gateway
opens last. Internal lifecycle work reaches quota state through the webhooks
Worker's direct cross-Worker Durable Object binding, so gateway has no maintenance
bypass route during the closed window.

If a barrier step fails, the deploy operation re-deploys and verifies all three
writer gates closed before stopping. If recovery cannot be verified, writer state
is reported as unconfirmed and requires immediate inspection. Once closed,
recover by rerunning the complete deployment from the same immutable commit. If
that release cannot continue, keep the gateway closed and dispatch a reviewed,
forward-compatible `stage-closed` release that explicitly names the superseded
closed SHA. Never recover a schema contraction by deploying older code or bypass
convergence by flipping the gate in the dashboard.

The HTTP barrier stops new public work, and the draining agent/webhook gates fence
new admissions while pinned Workflow and Durable Object continuations finish. The
coordinated release drains relational AgentRun state and every retained writer
Workflow before moving those services to `closed` and running DDL. Durable Object schema changes use
explicit in-place reconciliation; the gate alone is not an atomic migration.

`IdempotencyStore` owns one exact SQLite table shape in its stable namespace and
reconciles dormant objects to that shape when they are next activated. Run
creation is also durably idempotent in Postgres, so request-cache evolution
cannot create a duplicate run.

`/v1/tools` and `/v1/agents` read the shared framework-free capability catalog
from `@cheatcode/types`. The Mastra registries are statically constrained to the
same exact names; workflows are exposed through tools and are not reported as
agents. Each tool summary also declares whether it uses the sandbox and whether
it produces an artifact; AgentRun stream status and deliverable routing derive
from those same traits instead of maintaining parallel tool-name lists.

## Public exports

- `gatewayApp`
- `gatewayRoutes`
- `GatewayAppType`
- `IdempotencyStore`
- `QuotaTracker`
- `RateLimiter`

## Code Checks

```bash
pnpm --filter @cheatcode/gateway-worker typecheck
```

## Env

- `CHEATCODE_ENVIRONMENT` (`production` in committed Wrangler config; local generated config overrides it)
- `CHEATCODE_RELEASE_GATE` (`open` normally; coordinated production releases close gateway first while agent/webhooks drain, then close all writers)
- `CHEATCODE_RELEASE_SHA` (required for production deployments)
- `CF_VERSION_METADATA`
- `AGENT`
- `WEBHOOKS`
- `PREVIEW_PROXY` (generated local-only Service Binding; production preview
  traffic reaches the preview Worker through its wildcard route)
- `RATE_LIMITER`
- `QUOTA_TRACKER`
- `IDEMPOTENCY`
- `ENTITLEMENTS_CACHE`
- `HYPERDRIVE` (dedicated config whose database login is exactly `app_gateway`)
- `DATABASE_CONTEXT_SIGNING_SECRET_GATEWAY` (role-specific Secrets Store binding;
  must match the `app_gateway` Supabase Vault HMAC secret)
- `CLERK_SECRET_KEY` or `CLERK_JWT_KEY`
- `CLERK_AUTHORIZED_PARTIES` (comma-separated exact HTTP(S) origins)
- `POLAR_ACCESS_TOKEN`
- `POLAR_SERVER` (`production` by default; set `sandbox` only with sandbox credentials/products)
- `POLAR_PRODUCT_ID_PRO`, `POLAR_PRODUCT_ID_PREMIUM`, `POLAR_PRODUCT_ID_ULTRA`, `POLAR_PRODUCT_ID_MAX`
- `COMPOSIO_API_KEY`
- `COMPOSIO_AUTH_CONFIGS`
- `GATEWAY_TO_WEBHOOKS_RESOURCE_DELETION_SECRET` (ccm2 `resource-deletion`
  capability shared only with the webhooks verifier)
- `RELEASE_DATABASE_READINESS_SECRET` (ccm2 `database-readiness` capability;
  the release environment receives no destructive capability key)
- `USER_EVENTS`, `ERROR_EVENTS`, `PERFORMANCE_METRICS`
