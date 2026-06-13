# @cheatcode/web

Next.js 16 app shell with Clerk auth and AI SDK chat streaming. Production runs on Cloudflare Workers through OpenNext.
The Settings Billing panel consumes gateway billing state directly and exposes
checkout, portal, cancel-at-period-end, and reactivation controls.

## Public exports

Framework app only.

## Code Checks

```bash
pnpm --filter @cheatcode/web typecheck
```

Product QA is direct `agent-browser --auto-connect --session cheatcode-debug`
interaction against the running app plus console/network/log review. Do not add
or run browser-flow scripts for web acceptance testing.

## Env

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `NEXT_PUBLIC_GATEWAY_URL`
- `NEXT_PUBLIC_POLAR_PRO_MONTHLY_PRODUCT_ID` (required for checkout; the Billing
  panel disables upgrades when absent)
- `CLERK_SECRET_KEY`

## Deploy

```bash
pnpm --filter @cheatcode/web build
pnpm --filter @cheatcode/web deploy
```

`apps/web/wrangler.jsonc` binds the `cheatcode-web` Worker, routes `trycheatcode.com`
and `www.trycheatcode.com`, and uses R2 bucket `cheatcode-next-cache` for the
OpenNext incremental cache. Local OpenNext preview listens on port 3001 so the
gateway Worker can keep port 8787.
