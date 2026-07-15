# @cheatcode/byok

Vault-backed bring-your-own-key helpers. Callers must run these functions inside `withUserContext()`.
Key validation also lives here so gateway writes and maintenance revalidation use
the same provider-specific checks.
Validation reads are byte-bounded and the timeout remains active through response
body parsing, so a provider cannot hold or exhaust the request after sending headers.

## Public exports

- `setProviderKey`
- `getProviderKey`
- `deleteProviderKey`
- `listProviderKeys`
- `validateProviderKey`

## Code Checks

```bash
pnpm --filter @cheatcode/byok typecheck
```

## Env

None directly. Uses the caller's database transaction and Supabase Vault RPCs.
