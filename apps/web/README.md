# @cheatcode/web

Next.js 16 app shell with Clerk auth and AI SDK chat streaming. Production runs on Vercel.
The Settings Billing panel consumes gateway billing state directly and exposes
checkout, portal, cancel-at-period-end, and reactivation controls.

Persisted assistant runs may cross message pages, but each API row stays bounded. The history
query actively follows cursors until every segment through the final marker is loaded, then
losslessly reconstructs structured fragments and merges the run under its stable run ID. A
partial or corrupt transcript is never rendered as a duplicate assistant message.

Deliverable parts contain durable output identity and presentation metadata, never an expiring
URL. A download click calls the authenticated gateway mint endpoint, validates its bounded response,
and follows the resulting short-lived capability directly to the streaming response.

Composer uploads always land in a writable project. If none is selected, choosing the first
valid file creates and selects a general project named from that file. Files upload sequentially
as raw bounded requests, show per-batch progress and actionable failures, and become durable
`uploads/` files in that project instead of being pasted into message text. The composer inserts
a compact `/uploads/...` reference after each successful save. `/` is exclusively the
persistent project-file browser;
`@` is exclusively the user-skill picker. The file browser reads durable project-file metadata and
does not create or wake Daytona merely because the user opens it.

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
- `NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA` (embedded from the exact release SHA by the prebuilt workflow)
- `NEXT_PUBLIC_GATEWAY_URL`
- `NEXT_PUBLIC_PREVIEW_HOSTNAME` (must match both preview Workers and the Cloudflare wildcard route)
- `CLERK_SECRET_KEY`
- `VERCEL_ENV` (actual Vercel runtime environment)
- `VERCEL_TARGET_ENV` (Vercel build/deployment target)
- `VERCEL_URL` (actual immutable deployment hostname)

Local development requires Clerk `pk_test_`/`sk_test_` keys. Every Vercel
deployment requires the production `pk_live_`/`sk_live_` keys; development keys
exist only in root `.env.local` on the laptop. Middleware also restricts Clerk session-token authorized parties to the exact
loopback, Vercel deployment, or production request origin for that environment. Preview
deployments are matched to their exact system-provided `VERCEL_URL`; no wildcard Vercel
origin is trusted.
The prebuilt production build explicitly sets `VERCEL_TARGET_ENV=production`,
which selects the live Clerk, canonical gateway, preview-hostname, and exact-SHA
validation branch before a deployment URL exists. Only an actual Vercel
`production` or `preview` runtime requires `VERCEL_URL`; Vercel supplies
`VERCEL_ENV` and `VERCEL_URL` after the prebuilt artifact is deployed.
`next.config.ts` and the runtime env accessor share the pure validators exported
by `@cheatcode/env/web-config`; all four public build values are explicit and
missing values have no local or production fallback.
The config loads the repository-root `.env.local` through `@next/env` for local
builds and strips all loaded Worker-only values before Next evaluates the app;
no second env file under `apps/web` is used.
The production CSP admits the exact validated `NEXT_PUBLIC_GATEWAY_URL`; a real Vercel
Production build pins that value to `https://gateway.trycheatcode.com`, while optimized
local QA can use its loopback Wrangler origin.
Production additionally admits only Vercel's exact immutable deployment origin.

## Deploy

Vercel's Git integration deploys `apps/web` from the repository using the
checked-in build command. Production public environment values select the live
Clerk instance, canonical gateway, and preview hostname. Verify `/api/health`
and the deployed revision after Vercel finishes.
