# @cheatcode/auth

Shared authentication and signed-capability protocols for Workers.

## Public exports

- `verifyClerkBearerToken` (requires an exact Clerk `azp` allowlist)
- `readCookieValue`
- `fetchClerkUserPrimaryEmailStatus`
- `fetchClerkUserSyncSnapshot`
- `updateClerkUserPublicMetadata`
- `hmacSha256Base64`
- `timingSafeEqual`
- `mintPreviewCapability`
- `verifyPreviewCapability`
- `PreviewCapabilityError`

Preview capabilities are versioned, HMAC-signed, exact-host/sandbox/port bound,
nonce-bearing credentials. `handoff` tokens are query-only and `session` tokens
are cookie-only; callers must pass the expected transport kind when verifying.
The shared verifier rejects legacy formats, oversized inputs, future-issued
claims outside the protocol tolerance, and excessive lifetimes.
Every shared HMAC operation rejects secrets shorter than 32 UTF-8 bytes before
key import; configuration errors never include the secret value.

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

Callers pass `CLERK_SECRET_KEY`, `CLERK_JWT_KEY`, or
`PREVIEW_TOKEN_SECRET` from their validated Worker env. Sandbox skill-runtime
access uses random per-run opaque capabilities whose digests and exact scopes
live on the tenant-scoped agent-run row shared by local and production Workers;
this package owns their strict token format, generation, parsing, and
constant-time digest verification.
Worker-to-Worker destructive operations use named, scoped Cloudflare Service
Bindings instead of an authentication protocol from this package.
