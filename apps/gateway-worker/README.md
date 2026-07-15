# @cheatcode/gateway-worker

Public Hono API entrypoint. It verifies Clerk JWTs, resolves the Clerk subject to the
internal `users.id` UUID, lazily syncs the user from Clerk on first authenticated request
when webhooks have not run yet, rate-limits requests, and forwards agent work to
`agent-worker` via Service Binding.

Provider key writes validate each supported BYOK provider through
`packages/byok` before calling the Vault-backed RPC. Invalid keys are rejected
before plaintext is sent to storage, and new providers are blocked when the
current entitlement tier has reached its BYOK slot limit. `/internal/users/:userId/delete-state`
is an HMAC-protected maintenance route used by webhooks to clear the user's
`QuotaTracker` durable state during the Clerk deletion lifecycle. Destructive
gateway-to-agent cleanup and webhooks-to-gateway deletion calls use the shared
`ccm1` method/path/millisecond-timestamp/body-hash signature contract and shared
deletion schemas; no legacy signature format is accepted.

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
entitlement KV cache; final product verification still happens by operating the
Settings UI directly with `agent-browser`, not a billing test script.

Run creation requires the current Clerk primary email to be verified before the
request is forwarded to `agent-worker`, so authenticated but unverified users do
not spawn Daytona sandbox work.
JWT verification also requires `azp` to match one of the exact HTTP(S) origins in
`CLERK_AUTHORIZED_PARTIES`; production is pinned to `https://trycheatcode.com`.

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
requests receive only gateway-minted internal identity/idempotency headers; local preview
traffic has a separate, explicit capability/cookie bridge.

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
non-cacheable `503` while the agent converges. The closed health body reports
the gateway and service-bound agent release identities so deployment can verify
both before publishing the same gateway bundle with the gate set to `open`.
The exact HMAC-authenticated user-state deletion route remains available so a
Clerk deletion lifecycle is not stranded during the release window.

If a barrier step fails, the deploy operation re-deploys and verifies the closed
gate before stopping. If close-gate recovery itself cannot be verified, the gate
state is reported as unconfirmed and requires immediate inspection. Once closed,
recover by rerunning the complete deployment from the same immutable commit. To
abandon it, keep gateway closed, review and roll agent back if it changed, then
roll gateway back to the matching known-good open version and verify `/health`;
never bypass convergence by flipping the gate in the dashboard.

The HTTP barrier stops new public work but cannot terminate a request or Durable
Object execution accepted before closure. Changes to active `AgentRun` behavior
or gateway-owned Durable Object state therefore need an explicit drain/state
migration decision; the release gate alone is not an atomic Durable Object
migration mechanism.

`IdempotencyStore` owns one exact SQLite table shape. Constructor initialization
runs behind the Durable Object input gate and transactionally rebuilds an older
deployed shape while preserving valid completed and in-flight entries; unknown
lossy shapes fail closed instead of silently discarding request outcomes.

`/v1/tools` and `/v1/agents` read the shared framework-free capability catalog
from `@cheatcode/types`. The Mastra registries are statically constrained to the
same exact names; workflows are exposed through tools and are not reported as
agents.

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
- `CHEATCODE_RELEASE_GATE` (`open` normally; generated production release config closes it during agent convergence)
- `CHEATCODE_RELEASE_SHA` (required for production deployments)
- `CF_VERSION_METADATA`
- `AGENT`
- `RATE_LIMITER`
- `QUOTA_TRACKER`
- `IDEMPOTENCY`
- `ENTITLEMENTS_CACHE`
- `HYPERDRIVE`
- `CLERK_SECRET_KEY` or `CLERK_JWT_KEY`
- `CLERK_AUTHORIZED_PARTIES` (comma-separated exact HTTP(S) origins)
- `POLAR_ACCESS_TOKEN`
- `POLAR_SERVER` (`production` by default; set `sandbox` only with sandbox credentials/products)
- `POLAR_PRODUCT_ID_PRO`, `POLAR_PRODUCT_ID_PREMIUM`, `POLAR_PRODUCT_ID_ULTRA`, `POLAR_PRODUCT_ID_MAX`
- `COMPOSIO_API_KEY`
- `COMPOSIO_AUTH_CONFIGS`
- `INTERNAL_MAINTENANCE_SECRET`
- `USER_EVENTS`, `ERROR_EVENTS`, `PERFORMANCE_METRICS`
