# @cheatcode/byok

Vault-backed bring-your-own-key helpers. Callers must run these functions inside `withUserContext()`.
Key validation also lives here so gateway writes and maintenance revalidation use
the same provider-specific checks.
Validation reads are byte-bounded and the timeout remains active through response
body parsing, so a provider cannot hold or exhaust the request after sending headers.
Maintenance revalidation loads plaintext for one claimed fingerprint and UUID lease
inside a short user-context transaction, closes Postgres before provider I/O, and
never returns the plaintext from a durable Workflow step. Conclusive results are
applied later through an unexpired fingerprint-and-lease compare-and-set, so a
concurrently replaced or reclaimed key cannot be mutated by stale work.

## Public exports

- `setProviderKey`
- `getProviderKey`
- `getProviderKeyForRevalidation`
- `deleteProviderKey`
- `listProviderKeys`
- `validateProviderKey`

## Code Checks

```bash
pnpm --filter @cheatcode/byok typecheck
```

## Env

None directly. Uses the caller's database transaction and Supabase Vault RPCs.
