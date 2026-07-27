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
before plaintext is sent to storage. Project and thread deletes enqueue an exact-generation
resource-deletion job through the webhooks Worker's named
`ResourceDeletionEntrypoint`. The dedicated Service Binding is the capability:
the default webhooks HTTP surface does not expose deletion admission, and
Cloudflare-authenticated binding properties pin the gateway caller and
`resource-deletion` permission without an application-managed shared secret.

User-scoped Postgres transactions contain database work only. Secrets Store,
KV, Durable Object, service-binding, weather, Polar, and Composio operations
finish before a short RLS transaction begins or start after it commits; they
are never parallelized across an open transaction. Read paths resolve the
entitlement cache outside Postgres, while project and BYOK writes read the
authoritative entitlement row under the same per-user advisory-lock order as
entitlement reconciliation.

`QuotaTracker` supports hard `try-consume` gates for connected-tool calls and
soft `record` metering for sandbox-hours. Limit synchronization carries the
entitlement row's `updatedAt` version, and the Durable Object ignores older
writes so a stale KV or Worker request cannot overwrite a newer plan. Request
rate-limit headers remain the canonical live rate-limit state.

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

Production deploys bind an immutable `CHEATCODE_RELEASE_SHA` into every affected
Worker. Each Durable Object initializes one current SQLite contract and validates
that exact contract before using existing storage.

The gateway health response exposes its own release SHA and the release SHAs
reported by its agent and webhook service bindings. Deployments publish the
gateway last so public traffic observes only a backend set built from the same
reviewed revision. SQLite schema validation remains synchronous.

`IdempotencyStore`, `RateLimiter`, and `QuotaTracker` each own one exact SQLite
schema. New objects initialize that schema directly; existing objects must
already match it before an operation is admitted. Run creation is also durably
idempotent in Postgres, so request-cache state cannot create a duplicate run.

The shared framework-free tool capability catalog in `@cheatcode/types`
statically constrains the Mastra tool registry to the same exact names. Each
tool summary also declares whether it uses the sandbox and whether it produces
an artifact; AgentRun stream status and deliverable routing derive from those
same traits instead of maintaining parallel tool-name lists.

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
- `CHEATCODE_RELEASE_SHA` (required for production deployments)
- `CF_VERSION_METADATA`
- `AGENT`
- `WEBHOOKS`
- `RESOURCE_DELETION` (named `ResourceDeletionEntrypoint` Service Binding;
  granted only to gateway with authenticated caller/capability properties)
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
- `USER_EVENTS`, `ERROR_EVENTS`, `PERFORMANCE_METRICS`
