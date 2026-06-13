# @cheatcode/auth

Clerk token verification helpers for Workers and shared auth utilities.

## Public exports

- `verifyClerkBearerToken`
- `fetchClerkUserPrimaryEmail`
- `fetchClerkUserPrimaryEmailStatus`
- `primaryEmailFromClerkUserResource`
- `primaryEmailStatusFromClerkUserResource`
- `getBearerToken`
- `hmacSha256Base64`
- `timingSafeEqual`
- `verifyInternalMaintenanceRequest`

## Code Checks

```bash
pnpm --filter @cheatcode/auth typecheck
```

## Env

Callers pass `CLERK_SECRET_KEY` or `CLERK_JWT_KEY` from their validated Worker env.
