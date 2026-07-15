# @cheatcode/env

Zod-validated environment helpers. This is the only package allowed to read `process.env`.

## Public exports

- `./web`: Next.js client/server env
- `./worker`: Cloudflare Worker binding schemas and Secrets Store resolution helpers
- `./migrate`: admin database identity pins plus the Cloudflare account pin used
  by the audit archive operation

## Code Checks

```bash
pnpm --filter @cheatcode/env typecheck
```

## Env

See root `.env.example` for runtime variables and `.env.migrate.example` for
admin-only migration/archive variables.

Vercel Production deployments accept only the exact gateway origin
`https://gateway.trycheatcode.com`; credentials, paths, queries, fragments, and
non-HTTPS remote origins are rejected. Loopback HTTP is allowed only outside
Vercel Production so local development and optimized local QA can reach Wrangler.
`PREVIEW_HOSTNAME` is required by both preview-producing Workers, normalized to a
multi-label DNS hostname (or `localhost:8787` in development), and production rejects a
port-bearing value. Moving previews to a different registrable site requires an atomic
DNS/Worker/Vercel env change; there is no legacy hostname fallback.

Worker schemas structurally validate Cloudflare service, KV, Durable Object, R2,
Analytics Engine, Workflow, and Secrets Store bindings before request handling starts.
