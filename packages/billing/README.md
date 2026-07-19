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
- `entitlementValuesForTier`
- `tierLimits`
- `PLAN_CATALOG`
- sandbox-hour quota helpers

Current tiers are `free`, `pro`, `premium`, `ultra`, and `max`. Entitlements
cover sandbox hours, active projects, BYOK provider slots, and Composio calls.
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
