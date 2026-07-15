# @cheatcode/web

Next.js 16 app shell with Clerk auth and AI SDK chat streaming. Production runs on Vercel.
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
- `NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA` (provided automatically by Vercel's enabled system variables)
- `NEXT_PUBLIC_GATEWAY_URL`
- `NEXT_PUBLIC_PREVIEW_HOSTNAME` (must match both preview Workers and the Cloudflare wildcard route)
- `CLERK_SECRET_KEY`

Local development and Vercel Preview require Clerk `pk_test_`/`sk_test_` keys.
Vercel Production fails its build unless both Clerk keys use the `pk_live_`/`sk_live_`
prefixes. Middleware also restricts Clerk session-token authorized parties to the exact
loopback, Vercel deployment, or production request origin for that environment. Preview
deployments are matched to their exact system-provided `VERCEL_URL`; no wildcard Vercel
origin is trusted.
The production CSP admits the exact validated `NEXT_PUBLIC_GATEWAY_URL`; a real Vercel
Production build pins that value to `https://gateway.trycheatcode.com`, while optimized
local QA can use its loopback Wrangler origin.
Production additionally admits only Vercel's exact immutable deployment origin so the
guarded release workflow can verify `/api/health` before promoting the deployment.

## Deploy

`apps/web/vercel.json` disables automatic Git deployments for every branch. The
guarded `Production Release` workflow builds, stages, and verifies one immutable
exact-SHA Vercel production deployment without assigning production domains. It
then releases and verifies the Cloudflare backend, promotes that already-verified
deployment, and waits for `trycheatcode.com` to report the same release SHA before
post-deploy database contractions can run.
