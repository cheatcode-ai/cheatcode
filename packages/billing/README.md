# @cheatcode/billing

Polar SDK wrappers for checkout, customer portal, subscription
cancel/reactivate, and entitlement tier helpers.

## Public exports

- `createCheckoutUrl`
- `createCustomerPortalUrl`
- `cancelSubscriptionAtPeriodEnd`
- `reactivateSubscription`
- `entitlementValuesForTier`
- `inferTierFromPolarProduct`
- `tierLimits`

`tierLimits` includes the launch daily AI cost caps used by the agent Worker:
Free `$10`, Pro `$50`, Team `$200`, and no default Enterprise cap.

`inferTierFromPolarProduct` requires product metadata `tier=pro|team|enterprise`
by default. Name/ID fallback is only for explicitly marked local fixtures.
User-facing cancellation schedules end-of-period cancellation through
`subscriptions.update({ cancelAtPeriodEnd: true })`; immediate revoke is not a
default app flow.

## Code Checks

```bash
pnpm --filter @cheatcode/billing typecheck
```

## Env

- `POLAR_ACCESS_TOKEN` is resolved by the caller and never logged.
