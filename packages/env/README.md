# @cheatcode/env

Zod-validated environment helpers. This is the only package allowed to read `process.env`.

## Public exports

- `./web`: Next.js client/server env
- `./worker`: Cloudflare Worker binding schemas/parsers for gateway, agent, and webhooks

## Code Checks

```bash
pnpm --filter @cheatcode/env typecheck
```

## Env

See root `.env.example`.
