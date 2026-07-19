# @cheatcode/auth

Shared authentication and signed-capability protocols for Workers.

## Public exports

- `verifyClerkBearerToken` (requires an exact Clerk `azp` allowlist)
- `readCookieValue`
- `fetchClerkUserPrimaryEmailStatus`
- `fetchClerkUserSyncSnapshot`
- `updateClerkUserPublicMetadata`
- `hmacSha256Base64`
- `assertDistinctHmacSecrets`
- `assertHmacSecretStrength`
- `MINIMUM_HMAC_SECRET_UTF8_BYTES` (32 bytes)
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
Every shared HMAC operation rejects secrets shorter than 32 UTF-8 bytes before
key import; configuration errors never include the secret value.

Internal maintenance calls use only the `ccm2` protocol. The HMAC binds the
issuer, audience, least-privilege capability, uppercase HTTP method, exact
pathname, 13-digit millisecond timestamp, UUID nonce, and SHA-256 hash of the
exact request body. The receiver separately pins the expected hostname, so
Service Binding routes cannot be replayed through a public host. The verifier
rejects queries, unknown or cross-boundary envelopes, second-based timestamps,
legacy signatures, and requests outside the 30-second clock-skew window.

The nonce provides cryptographic domain separation; it is not stored or
consumed and therefore is not a single-use replay ledger. Every mutating `ccm2`
route must be idempotent or validate an authoritative generation before changing
state. Webhook replay additionally claims an exact durable command identity.

Clerk user and JWKS reads use the documented Backend REST API with 10-second
deadlines and pre-parse response ceilings. The canonical sync snapshot validates
Clerk's nonnegative safe-integer `updated_at` source version together with the
primary email, display name, and avatar used by the monotonic database sync.
Session JWT and webhook verification
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

Callers pass `CLERK_SECRET_KEY`, `CLERK_JWT_KEY`, `PREVIEW_TOKEN_SECRET`, or one
of the four isolated `ccm2` capability keys from their validated Worker env:
`GATEWAY_TO_WEBHOOKS_RESOURCE_DELETION_SECRET`,
`WEBHOOKS_TO_AGENT_LIFECYCLE_SECRET`, `INTERNAL_WEBHOOK_REPLAY_SECRET`, and
`RELEASE_DATABASE_READINESS_SECRET`. No shared or legacy fallback exists.
