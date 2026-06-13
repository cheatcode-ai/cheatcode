# Cheatcode V2

Cheatcode is a TypeScript-first generalist AI agent platform on Cloudflare Workers, Durable Objects, Workflows, Blaxel Sandboxes, Supabase Postgres, Clerk, and Polar.

`plan.md` is the source of truth for product scope, architecture, schema, security, and delivery order.

## Local Setup

```bash
pnpm install
pnpm exec supabase start
cp .env.migrate.example .env.migrate
cp apps/gateway-worker/.dev.vars.example apps/gateway-worker/.dev.vars
pnpm turbo skills:build
pnpm typecheck:scripts
pnpm turbo db:generate
pnpm tsx scripts/migrate.ts --apply
pnpm turbo build
```

Run locally:

```bash
pnpm dev
```

After Weeks 1-8 are implemented in code, product QA is manual browser operation
only:

```bash
agent-browser --auto-connect --session cheatcode-debug open http://localhost:3000
agent-browser --auto-connect --session cheatcode-debug snapshot -i
```

Use the snapshot-ref workflow directly: click/fill/type through login, project
chat, preview tabs, settings, billing, BYOK, integrations, and mobile layouts;
re-snapshot after DOM changes; capture screenshots; inspect console/resource
output; and review the running Next/Wrangler logs. Do not add or run
checked-in product-flow scripts for smoke, E2E, load, prompt submission,
auth, browser automation, accessibility, or final product QA. Package `test`
scripts and source-level `*.test.ts` files are intentionally absent; real
acceptance testing is the UI plus logs. Do not generate temporary
validation scripts either; operate the UI directly and remove any throwaway
product QA script that appears in the V2 tree. Operational scripts that remain
in the repo are for build, migration, secret sync, Docker cleanup, and deploy
guardrails only; they are never acceptance evidence. The `scripts/` directory is
not a testing surface; delete any script that submits prompts, drives auth or
browser flows, checks accessibility/load, or gathers final product evidence.
May 27, 2026 user override: never use scripts for product testing. Product QA
must be direct UI operation with `agent-browser`, screenshots, console/network
inspection, and running app-log review. Delete future V2 product validators
rather than running them. Legacy V1 tests under `cheatcode/` are ignored
reference material and are not part of V2 QA.

May 28, 2026 hardening: product QA cannot be wrapped in `pnpm`, `tsx`, shell
loops, `/tmp` helpers, generated files, browser-driver wrappers, package
aliases, or any scripted flow. Each UI action, screenshot, console read,
network/resource inspection, and app-log inspection must be issued directly in
the transcript. Typecheck/lint/build are code-health gates only.

May 28, 2026 latest user directive: code the all-weeks V2 surface first, then
perform final product QA only through direct
`agent-browser --auto-connect --session cheatcode-debug` UI actions plus direct
console/network/app-log inspection. Delete any V2 script that submits prompts,
drives auth/browser flows, checks accessibility/load, wraps `agent-browser`, or
gathers final product evidence.

Docker local behavior:

```bash
pnpm docker:dev:build
pnpm docker:dev:up
pnpm docker:dev:down
pnpm docker:prod:build
pnpm docker:prod:up
pnpm docker:prod:down
pnpm docker:clean
```

V2 production deploys to Cloudflare Workers/OpenNext, Supabase, and hosted
Blaxel sandboxes. Docker Compose is not the production runtime. The root compose files
exist to build/run the sandbox image in a predictable `cheatcode-dev` or
`cheatcode-prod` Docker Desktop group, pinned to `linux/amd64` to match the
hosted Blaxel sandbox image. `pnpm dev` checks the authenticated Blaxel CLI
workspace before starting Workers; pass `--skip-blaxel-check` only when running
frontend or routing code without sandbox-backed tools.

`pnpm dev` writes ignored `wrangler.local-dev.generated.jsonc` files next to
each Worker config with production-only Secrets Store bindings removed. Local
Workers read secrets from `.dev.vars`; production deploys still use the
committed `wrangler.jsonc` Secrets Store bindings. Before local Workers start,
`pnpm dev` validates that `apps/agent-worker/.dev.vars` has the required
standard Worker secrets for Blaxel and output downloads.

Expected local endpoints:

- `apps/web`: `http://localhost:3000`
- `apps/web` Workers parity preview: `pnpm --filter @cheatcode/web preview` (`http://localhost:3001`)
- Gateway Worker: `http://localhost:8787` from one chained `wrangler dev`
  process that includes gateway, agent, and webhooks Workers
- Wrangler inspector: `http://localhost:9239` (kept off 9229 so
  `agent-browser --auto-connect` attaches to Chrome on 9222, not workerd)
- Supabase Studio: `http://localhost:54323`

Database migrations run in the locked order from `plan.md` Section 7.10:
raw pre-SQL, Drizzle migrations, then raw post-SQL. Use
`SUPABASE_MIGRATION_URL` from a git-ignored `.env.migrate`; never bind it to a
Worker.

`.env.migrate.example` points at local Supabase only. Before applying a
production migration, confirm `SUPABASE_MIGRATION_URL` targets the same
Supabase project/ref as the production Hyperdrive config, or apply the DDL via
Supabase MCP and verify the deployed Worker route that depends on it.

`scripts/migrate.ts` validates the target before it prints or applies a
migration plan. There is no standalone database validation script in V2; the
guardrail runs inside the migration operation that needs it.

After `wrangler hyperdrive create cheatcode-db --connection-string=...`, replace
the placeholder `00000000-0000-0000-0000-000000000000` Hyperdrive IDs in Worker
`wrangler.jsonc` files with the created configuration ID:

```bash
pnpm prod:set-hyperdrive -- --id <HYPERDRIVE_CONFIG_ID>
pnpm prod:set-hyperdrive -- --id <HYPERDRIVE_CONFIG_ID> --apply
```

The GitHub static-check workflow runs package lint/typecheck/build only. Production deploys
and production DB migration applies are manual-only
`workflow_dispatch` operations gated by a typed production-deploy confirmation
and the `production` environment; a push to `main` must never deploy Cloudflare
resources or mutate the production database by itself. Local production deploy
commands also refuse to run unless `CHEATCODE_PROD_DEPLOY_APPROVED=true` is set
after explicit approval. The deploy workflow keeps the deployment sequence
manual and serialized. Product
correctness is verified through direct `agent-browser` UI operation and logs,
not standalone deployment validation scripts. Blaxel SDK credentials
(`BL_API_KEY`, `BL_WORKSPACE`, `BL_REGION`) plus
`OUTPUT_DOWNLOAD_SIGNING_SECRET` are checked as standard Worker secrets on
`cheatcode-agent`:

```bash
pnpm sync:worker-secrets
pnpm sync:worker-secrets -- --apply
```

The default search path includes `.env.local`, `.env.development`,
`docker.dev`, and per-Worker `.dev.vars` files, and fails if any required
standard Worker secret is missing. Use `--allow-partial` only for targeted
debugging. `--apply` uses `wrangler versions secret put` so it works with
Workers Versions without running `wrangler deploy`.

For local sandbox-backed dev,
`pnpm sync:blaxel-local-token` refreshes Blaxel CLI auth and writes the current
CLI JWT to `apps/agent-worker/.dev.vars` only when `BL_API_KEY` is missing or
already a JWT-shaped CLI token; long-lived non-JWT API keys are preserved.

Publish the sandbox image to Blaxel after changing `infra/containers/sandbox/`:

```bash
bl push -d ./infra/containers/sandbox --type sandbox --name cheatcode-sandbox
bl get image sandbox/cheatcode-sandbox --latest
```

Cloudflare Secrets Store sync is dry-run by default and never prints secret
values:

```bash
pnpm sync:secrets -- --env-file apps/web/.env.local --env-file apps/webhooks-worker/.dev.vars
pnpm sync:secrets -- --env-file apps/web/.env.local --env-file apps/webhooks-worker/.dev.vars --store-id <STORE_ID> --apply
```

Worker deploys are also dry-run by default:

```bash
pnpm deploy:workers
CHEATCODE_PROD_DEPLOY_APPROVED=true pnpm deploy:workers -- --apply
```

The deploy script runs `agent -> gateway -> web -> webhooks` so the
gateway service binding points at an existing `cheatcode-agent` Worker.

The preserved `cheatcode/` directory is the legacy V1 codebase. It is ignored by V2 tooling until a proper legacy snapshot branch/archive exists.
