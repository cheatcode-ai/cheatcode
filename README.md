# Cheatcode V2

Cheatcode is a TypeScript-first generalist AI agent platform with a Vercel-hosted Next.js frontend, Cloudflare Workers, Durable Objects, Workflows, Daytona Sandboxes, Supabase Postgres, Clerk, and Polar.

The live source, package READMEs, migrations, and deployment configuration define the current system. The deleted `plan.md` is intentionally not authoritative and must not be restored.

## Local Setup

```bash
pnpm install
pnpm exec supabase start
cp .env.migrate.example .env.migrate
cp apps/gateway-worker/.dev.vars.example apps/gateway-worker/.dev.vars
pnpm turbo skills:build
pnpm typecheck:scripts
pnpm turbo db:generate
pnpm tsx scripts/migrate.ts --apply --phase=pre-deploy
pnpm tsx scripts/migrate.ts --apply --phase=post-deploy
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
rather than running them. The removed V1 tree must not be restored or copied
back as a testing surface.

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
pnpm docker:clean
```

V2 production uses Vercel for `apps/web`, Cloudflare for the backend Workers,
Supabase, and hosted Daytona sandboxes. Build the sandbox image directly with
the command in `infra/containers/sandbox/README.md`; its AMD64 platform matches
Daytona's runner. The obsolete standalone Docker Compose runtime was removed
because Daytona supplies the sandbox daemon and lifecycle in production.

`pnpm dev` writes ignored `wrangler.local-dev.generated.jsonc` files next to
each Worker config with production-only Secrets Store bindings removed. Local
Workers read secrets from `.dev.vars`; production deploys still use the
committed `wrangler.jsonc` Secrets Store bindings. Before local Workers start,
`pnpm dev` validates that `apps/agent-worker/.dev.vars` has the required
Daytona, preview, maintenance, and output-signing secrets.

Expected local endpoints:

- `apps/web`: `http://localhost:3000`
- Gateway Worker: `http://localhost:8787` from one chained `wrangler dev`
  process that includes gateway, agent, and webhooks Workers
- Wrangler inspector: `http://localhost:9239` (kept off 9229 so
  `agent-browser --auto-connect` attaches to Chrome on 9222, not workerd)
- Supabase Studio: `http://localhost:54323`

Database migrations use an expand/deploy/contract sequence enforced by
`scripts/migrate.ts`: raw pre-SQL and Drizzle migrations run before the backend
release; destructive raw post-SQL runs only after the new Workers are live.
Every apply requires an explicit `--phase=pre-deploy` or
`--phase=post-deploy`; `--phase=all` is read-only planning only. Use
`SUPABASE_MIGRATION_URL` from a git-ignored `.env.migrate`; never bind it to a
Worker.

`.env.migrate.example` points at local Supabase only. Before applying a
production migration, confirm `SUPABASE_MIGRATION_URL` targets the same
Supabase project/ref as the production Hyperdrive config, or apply the DDL via
Supabase MCP and verify the deployed Worker route that depends on it.

`scripts/migrate.ts` validates the target before it prints or applies a
migration plan. There is no standalone database validation script in V2; the
guardrail runs inside the migration operation that needs it.

When rotating or replacing the production Hyperdrive configuration, update every
database-backed Worker `wrangler.jsonc` binding together with the reviewed
configuration ID:

```bash
pnpm prod:set-hyperdrive -- --id <HYPERDRIVE_CONFIG_ID>
pnpm prod:set-hyperdrive -- --id <HYPERDRIVE_CONFIG_ID> --apply
```

The GitHub static-check workflow runs repository-wide lint, typecheck, and build gates. The
`Production Release` workflow is a manual-only `workflow_dispatch` operation
gated by the exact `RELEASE_PRODUCTION` confirmation and the `production`
environment; a push to `main` must never deploy Cloudflare resources, promote
Vercel production, or mutate the production database by itself. Local production deploy
commands also refuse to run unless `CHEATCODE_PROD_DEPLOY_APPROVED=true` is set
after explicit approval. The release workflow builds, stages, and health-checks an
exact-SHA Vercel production candidate without assigning domains before it mutates
the database or backend. It then serializes pre-deploy migrations, the Cloudflare
backend, promotion of that already-verified Vercel deployment, production-domain
health checks, and post-deploy contractions. Product
correctness is verified through direct `agent-browser` UI operation and logs,
not standalone product-flow validation scripts.

The protected `Production` GitHub environment must provide the
`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `DAYTONA_API_KEY`,
`SUPABASE_MIGRATION_URL`, and `VERCEL_TOKEN` secrets. Repository variables provide
the four `SUPABASE_MIGRATION_EXPECTED_*` identity values, `VERCEL_ORG_ID`,
`VERCEL_PROJECT_ID`, and `NEXT_PUBLIC_GATEWAY_URL`. Static checks use an inert,
test-shaped Clerk publishable value rather than a deployable credential. Protected deployment URLs are verified with
authenticated `vercel curl` requests using the scoped CI token, so no separate
protection-bypass secret is distributed. `VERCEL_PRODUCTION_URL` is optional and
defaults to the canonical `https://trycheatcode.com` frontend origin.

Publish a new immutable Daytona snapshot after changing `infra/containers/sandbox/`:

```bash
docker build --platform=linux/amd64 -t cheatcode-sandbox:<immutable-tag> infra/containers/sandbox
daytona snapshot push cheatcode-sandbox:<immutable-tag> --name <snapshot-name> --cpu 2 --memory 4 --disk 10
```

Cloudflare Secrets Store sync is dry-run by default, never prints secret values, creates missing
entries, and rotates existing entries by name:

```bash
pnpm sync:secrets -- --env-file apps/web/.env.local --env-file apps/webhooks-worker/.dev.vars
pnpm sync:secrets -- --env-file apps/web/.env.local --env-file apps/webhooks-worker/.dev.vars --store-id <STORE_ID> --apply
```

Worker deploys are also dry-run by default:

```bash
pnpm deploy:workers
CHEATCODE_PROD_DEPLOY_APPROVED=true pnpm deploy:workers -- --apply
```

The committed Wrangler files are authoritative: an apply replaces Worker vars
with a generated copy of the declared config plus the exact release SHA and does
not retain undeclared dashboard vars. It deploys the final gateway bundle closed,
waits for its exact-SHA `503`, deploys agent, verifies the agent SHA through the
still-closed gateway health response, and only then redeploys the same gateway
bundle open. Webhooks and preview proxy follow after that pair has converged.
If any barrier step fails, the operation re-deploys and verifies the closed gate
before stopping. If even that recovery cannot be verified, it reports the gate
state as unconfirmed and requires immediate inspection rather than claiming
production is closed.
The local deploy script releases only the Cloudflare backend.
Production disables every Vercel Git auto-deploy and promotes the staged prebuilt
frontend only from the coordinated release workflow.

After the script has verified the recovered closed gate, further release-barrier
recovery is deliberately manual. First fix the transient cause and rerun the
complete deployment from the same immutable commit;
the sequence is idempotent and re-verifies every release identity. If the release
must be abandoned, leave gateway closed, perform a reviewed rollback of agent if
it changed, then roll gateway back to the matching known-good open Worker version
and verify the public `/health` response before resuming frontend promotion or
post-deploy migrations. Never flip the gate open in the dashboard or reopen it
against an unverified agent version.

The release barrier drains new public requests; it does not cancel requests or
Durable Object executions already in flight. A change to active `AgentRun`
behavior or gateway-owned Durable Object state must be handled as an explicit
drain/state migration rather than assuming the HTTP gate makes that state
transition atomic.

The repository contains only the active V2 implementation. The legacy V1 source
tree was permanently removed on July 13, 2026 after explicit user authorization.
