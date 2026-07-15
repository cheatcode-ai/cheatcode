# @cheatcode/auth

Shared authentication and signed-capability protocols for Workers.

## Public exports

- `verifyClerkBearerToken` (requires an exact Clerk `azp` allowlist)
- `fetchClerkUserPrimaryEmail`
- `fetchClerkUserPrimaryEmailStatus`
- `updateClerkUserPublicMetadata`
- `hmacSha256Base64`
- `timingSafeEqual`
- `createInternalMaintenanceHeaders`
- `verifyInternalMaintenanceRequest`
- `mintPreviewCapability`
- `verifyPreviewCapability`
- `PreviewCapabilityError`
- `PREVIEW_HANDOFF_MAX_TTL_MS` (60 seconds)
- `PREVIEW_SESSION_MAX_TTL_MS` (10 minutes)

Preview capabilities are versioned, HMAC-signed, exact-host/sandbox/port bound,
nonce-bearing credentials. `handoff` tokens are query-only and `session` tokens
are cookie-only; callers must pass the expected transport kind when verifying.
The shared verifier rejects legacy formats, oversized inputs, future-issued
claims outside the protocol tolerance, and excessive lifetimes.

Internal maintenance calls use the single `ccm1` protocol. The HMAC binds the
uppercase HTTP method, exact pathname, 13-digit millisecond timestamp, and
SHA-256 hash of the exact request body. Origins are deliberately excluded so
the contract works across Cloudflare Service Bindings. The verifier rejects
queries, second-based timestamps, unversioned signatures, comma-wrapped legacy
signatures, and requests outside the five-minute clock-skew window.

Clerk user and JWKS reads use the documented Backend REST API with 10-second
deadlines and pre-parse response ceilings. Session JWT and webhook verification
continue to use Clerk's local cryptographic primitives; no SDK network transport
is used. A cached JWKS miss can refresh at most once every 30 seconds, allowing
signing-key rotation without turning attacker-selected key IDs into unbounded
provider traffic.

## Code Checks

```bash
pnpm --filter @cheatcode/auth typecheck
pnpm --filter @cheatcode/auth lint
```

## Env

Callers pass `CLERK_SECRET_KEY`, `CLERK_JWT_KEY`, `PREVIEW_TOKEN_SECRET`, or
`INTERNAL_MAINTENANCE_SECRET` from their validated Worker env.
