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
`QuotaTracker` durable state during the Clerk deletion lifecycle.

`QuotaTracker` supports hard `try-consume` gates for connected-tool calls and
soft `record` metering for sandbox-hours that can exceed the plan limit while
still surfacing real usage in `/v1/limits`.

Billing routes create Polar checkout/portal sessions and manage end-of-period
cancellation/reactivation through `/v1/billing/state`, `/v1/billing/cancel`,
and `/v1/billing/reactivate`. They update V2 entitlement state and clear the
entitlement KV cache; final product verification still happens by operating the
Settings UI directly with `agent-browser`, not a billing test script.

Run creation requires the current Clerk primary email to be verified before the
request is forwarded to `agent-worker`, so authenticated but unverified users do
not spawn Blaxel sandbox work.

Gateway emits `first_byok_key_added` after the first successful provider-key save
and accepts authenticated `/v1/user-events` activation pings from the real web UI.

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

- `AGENT`
- `RATE_LIMITER`
- `QUOTA_TRACKER`
- `IDEMPOTENCY`
- `ENTITLEMENTS_CACHE`
- `HYPERDRIVE`
- `CLERK_SECRET_KEY` or `CLERK_JWT_KEY`
- `POLAR_ACCESS_TOKEN`
- `COMPOSIO_API_KEY`
- `COMPOSIO_AUTH_CONFIGS`
- `INTERNAL_MAINTENANCE_SECRET`
- `USER_EVENTS`
