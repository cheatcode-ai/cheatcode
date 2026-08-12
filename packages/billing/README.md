# @cheatcode/billing

Polar SDK wrappers for checkout, customer portal, subscription lifecycle, the
plan catalog, and resource-entitlement helpers.

## Public exports

- `createCheckoutUrl`
- `createCustomerPortalUrl`
- `cancelSubscriptionAtPeriodEnd`
- `reactivateSubscription`
- `ensurePolarCustomer`
- `getPolarCustomerState`
- `updateCustomerProfile`
- `entitlementCacheFromValues`
- `PLAN_CATALOG`
- sandbox-hour quota helpers
- `@cheatcode/billing/quota-runtime`: worker-only `QuotaTrackerRuntime`; this
  subpath owns quota storage, retention, and RPC input validation and is not
  re-exported from the Node-safe package root

Current tiers are `free`, `pro`, and `premium`. Entitlements
cover sandbox hours, active projects, BYOK provider slots, and Composio calls.
The effective project ceiling may include a nullable operator-granted override stored on the
entitlement row; plan reconciliation preserves that override.
Tier values, validation, and ordering come from the neutral
`@cheatcode/types/billing` contract; this package owns only plan catalog and
billing-provider behavior.
Each user has one shared sandbox as a tenancy invariant rather than a plan
entitlement. Model tokens, model spend, deployments, and seats are not metered
here.
User-facing cancellation schedules end-of-period cancellation through
`subscriptions.update({ cancelAtPeriodEnd: true })`; immediate revoke is not a
default app flow.
Polar SDK calls have a 30-second request deadline and a 1 MiB response-stream
ceiling. Responses are then projected into bounded customer, subscription, URL,
and active-subscription shapes before reaching application state.
Customer-session parsing accepts Polar's required `customerPortalUrl` field only; obsolete generic
URL aliases are rejected at the provider boundary.

## Code Checks

```bash
pnpm --filter @cheatcode/billing typecheck
```

## Env

- `POLAR_ACCESS_TOKEN` is resolved by the caller and never logged.
- Callers may pass `server: "sandbox"` for isolated local QA; production remains the default.
