# Cheatcode V2

Cheatcode is a TypeScript-first generalist AI agent platform with a Vercel-hosted Next.js frontend, Cloudflare Workers, Durable Objects, Workflows, Daytona Sandboxes, Supabase Postgres, Clerk, and Polar.

The live source, package READMEs, migrations, and deployment configuration define the current system. The deleted `plan.md` is intentionally not authoritative and must not be restored.

## Local setup

```bash
nvm use
cp .env.example .env.local
# Fill the production Supabase runtime-role URLs plus the Clerk development,
# Daytona, Polar sandbox, and integration values.
pnpm dev
```

`pnpm dev` is the complete local entrypoint. Docker Compose builds the pinned
Node and pnpm development image and starts Next.js plus the chained Workers.
Local Workers use the production Supabase database through its session pooler
and the same three isolated runtime roles as production Hyperdrive. Local
startup never applies database migrations. Stop the stack with:

```bash
pnpm dev:down
```

Expected local endpoints:

- Web: `http://127.0.0.1:3000`
- Gateway and chained Workers: `http://127.0.0.1:8787`
- Wrangler inspector: `http://localhost:9239`

Product QA is direct browser operation only:

```bash
agent-browser --auto-connect --session cheatcode-debug open http://127.0.0.1:3000
agent-browser --auto-connect --session cheatcode-debug snapshot -i
```

Use the snapshot-ref workflow directly, re-snapshot after DOM changes, capture
screenshots, inspect console and resource output, and review the running app
logs. Do not add product-flow test scripts, browser wrappers, prompt drivers,
temporary validators, or package aliases that simulate product QA. Typecheck,
lint, and build are code-health gates, not product acceptance tests.

## Code checks

```bash
pnpm skills:build
pnpm typecheck
pnpm lint
pnpm build
pnpm architecture:check
pnpm deadcode
```

## Database migrations

`scripts/migrate.ts` owns migration planning and execution. Every mutation
requires `--apply` and an explicit phase; `--phase=all` is read-only.

```bash
pnpm db:migrate -- --dry-run --phase=all
pnpm db:migrate -- --apply --phase=pre-deploy
pnpm db:migrate -- --apply --phase=post-deploy
pnpm db:migrate -- --apply --phase=release-finalization
```

The migration command loads `.env.migrate` on an authorized operator
workstation, validates the administrative connection target and pinned database
identity before applying changes, and accepts protected process environment
values in automation. Migration credentials are never loaded by the app or
bound to a Worker. Apply expand
migrations before code that depends on them, and apply contractions only after
all deployed code is compatible with the contracted schema.

Configure the three Worker Hyperdrive bindings with the existing guarded helper:

```bash
pnpm cloudflare:set-hyperdrive -- \
  --gateway-id <GATEWAY_HYPERDRIVE_ID> \
  --agent-id <AGENT_HYPERDRIVE_ID> \
  --webhooks-id <WEBHOOKS_HYPERDRIVE_ID>

pnpm cloudflare:set-hyperdrive -- \
  --gateway-id <GATEWAY_HYPERDRIVE_ID> \
  --agent-id <AGENT_HYPERDRIVE_ID> \
  --webhooks-id <WEBHOOKS_HYPERDRIVE_ID> \
  --apply
```

## Production deployment

The required `static-checks` workflow classifies each change before allocating
the heavier runners. It runs dependency-aware lint, typecheck, build,
architecture, dead-code, workflow, and lockfile checks only for affected
surfaces and their workspace dependents. Root build configuration changes still
run the complete gate.

Vercel's Git integration deploys `apps/web` from the repository. Its native
monorepo dependency graph skips builds when neither the web app nor one of its
declared workspace dependencies changed. Deploy the Cloudflare backend Workers
from a clean reviewed checkout with:

```bash
pnpm cloudflare:deploy
```

The deploy command refuses a dirty tree, reads the release SHA currently bound
to each Worker, and uses the same workspace graph to deploy only affected
Workers. The agent, webhooks, and gateway Workers remain an atomic release set
because gateway readiness requires one shared release identity; the gateway is
deployed last. The independent preview proxy deploys only when its dependency
closure changed. If Cloudflare release metadata is unavailable or inconsistent,
the command safely redeploys the relevant set instead of guessing.

There is no second release orchestrator, compatibility deploy command, or hidden
workspace-reconciliation command. Schema migrations, Worker deployment, and
Vercel deployment are explicit operations; operators must sequence them using
the expand/contract rule above and verify Worker health and the production web
revision before applying destructive migrations.

Publish a new immutable Daytona snapshot after changing
`infra/containers/sandbox/` by dispatching the protected workflow from `main`:

```bash
gh workflow run build-snapshot.yml --ref main -f confirmation=BUILD_SNAPSHOT
```

Review the emitted immutable snapshot name and commit it in the agent Worker
configuration. Production Daytona credentials and snapshot publication remain
inside that workflow.

Audit retention uses the separate protected `Audit Archive` workflow because it
performs destructive database and R2 maintenance. It accepts exact plan/apply
confirmation, verifies the pinned production database identity, and uses a
dedicated bucket-scoped Cloudflare token. Production audit archival must not run
from a laptop.

The repository contains only the active V2 implementation. The legacy V1 source
tree was permanently removed on July 13, 2026 after explicit user authorization.
