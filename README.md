# Cheatcode V2

Cheatcode is a TypeScript-first generalist AI agent platform with a Vercel-hosted Next.js frontend, Cloudflare Workers, Durable Objects, Workflows, Daytona Sandboxes, Supabase Postgres, Clerk, and Polar.

The live source, package READMEs, migrations, and deployment configuration define the current system. The deleted `plan.md` is intentionally not authoritative and must not be restored.

## Run Cheatcode locally

`pnpm dev` is the only supported full-stack local entrypoint. It builds a
reproducible Docker image and starts:

- the Next.js web app;
- the gateway, agent, webhooks, and preview-proxy Workers in one chained local
  Wrangler process;
- local Durable Object, KV, R2, Workflow, and Wrangler state; and
- the shared package build watcher.

The application processes run locally, but a fully functional stack still uses
real remote services. In particular, local Workers connect to the production
Supabase database through its public session pooler and three isolated runtime
roles, and agents create development sandboxes in Daytona. Local startup never
starts Postgres, applies migrations, or deploys anything to Cloudflare or
Vercel.

### Prerequisites

Install:

- Docker Desktop or Docker Engine with a recent Docker Compose release that
  supports `docker compose up --watch`;
- NVM (or another version manager capable of selecting the exact Node version
  in `.nvmrc`); and
- Corepack, which supplies the exact pnpm version declared in `package.json`.

Prepare and verify the host toolchain:

```bash
nvm install
nvm use
corepack enable
corepack prepare pnpm@11.15.0 --activate

node --version
pnpm --version
docker compose version
docker info
```

The expected Node and pnpm versions are `v22.22.2` and `11.15.0`. Do not ignore
an engine warning: select or install Node 22.22.2 before installing packages or
running repository commands. Docker must be running before `pnpm dev`.

### Configure local credentials

Create the one local application environment file:

```bash
cp .env.example .env.local
chmod 600 .env.local
```

Fill every required value in `.env.local`. Keep the following boundaries:

- `SUPABASE_GATEWAY_DATABASE_URL`, `SUPABASE_AGENT_DATABASE_URL`, and
  `SUPABASE_WEBHOOKS_DATABASE_URL` are the production Supabase session-pooler
  URLs for `app_gateway`, `app_agent`, and `app_webhooks`. Do not use a direct
  database URL, an administrative role, `service_role`, or one role's password
  for another role.
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` must come from the
  Clerk development instance and must begin with `pk_test_` and `sk_test_`.
  Production Clerk keys are intentionally rejected locally.
- `DAYTONA_API_KEY`, `DAYTONA_SANDBOX_SNAPSHOT`, `DAYTONA_TARGET`, and
  `DAYTONA_WORKSPACE_VOLUME` select the development Daytona environment.
  `DAYTONA_WORKSPACE_VOLUME` must remain
  `cheatcode-workspaces-development`; never point local runs at the production
  workspace volume.
- `POLAR_SERVER` must remain `sandbox`. Add the Polar sandbox access token,
  webhook secret, and sandbox product IDs to exercise billing locally.
- Each signing secret group in `.env.example` must contain non-placeholder
  values of at least 32 UTF-8 bytes. Secrets within a group must be distinct.
  The startup runner checks these requirements before launching a Worker.
- Keep `NEXT_PUBLIC_GATEWAY_URL=http://127.0.0.1:8787`,
  `NEXT_PUBLIC_PREVIEW_HOSTNAME=localhost`, and
  `NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA=development` for the standard local
  topology.
- `COMPOSIO_API_KEY`, `COMPOSIO_AUTH_CONFIGS`, and
  `COMPOSIO_WEBHOOK_SECRET` are required for connected-tool flows.
  `COMPOSIO_AUTH_CONFIGS` is the JSON object that maps each supported toolkit
  name to its Composio auth-config ID.
- `DEEPSEEK_PLATFORM_API_KEY` is optional because users may rely entirely on
  BYOK. `DAYTONA_ORG_ID`, Clerk webhook verification, and internal alert
  delivery are optional only when the corresponding account or callback flow
  is not being exercised.

Do not copy `.env.production` into `.env.local`. Do not put database migration
credentials in this file; authorized operators keep those only in the ignored
`.env.migrate` file. The full variable list and safe local defaults live in
[`.env.example`](./.env.example).

### Start the stack

From the repository root:

```bash
pnpm dev
```

The first run builds the pinned Node 22.22.2/pnpm 11.15.0 image, installs the
locked workspace dependencies inside it, builds shared packages, validates
`.env.local`, generates permission-restricted local Wrangler configs, and then
starts the watchers. Subsequent source edits are synchronized into the
container. Changes to package manifests or the lockfile trigger an image
rebuild.

Wait for the Compose service to report `healthy`. In another terminal:

```bash
docker compose --env-file .env.local ps
docker compose --env-file .env.local logs -f app
```

Expected local endpoints:

- Web app: `http://localhost:3001`
- Gateway and chained Workers: `http://127.0.0.1:8787`
- Gateway health: `http://127.0.0.1:8787/health`
- Wrangler inspector: `http://127.0.0.1:9239`

The Compose health check verifies both the web app's Cheatcode symbol asset and
the gateway's JSON health response. A healthy gateway also proves that the
service-bound agent and webhooks Workers are reachable.

### Stop or reset the stack

Stop all local services cleanly:

```bash
pnpm dev:down
```

The normal shutdown keeps the local Next and Wrangler cache volumes so the next
start is faster. If those generated caches become corrupt, remove only those
local volumes and rebuild:

```bash
docker compose --env-file .env.local down --volumes --remove-orphans
pnpm dev
```

This does not delete production Supabase data or Daytona workspaces. Project and
account deletion must still go through the application so its durable cleanup
workflow can remove remote resources correctly.

### Troubleshooting

- **Node engine mismatch:** run `nvm install 22.22.2 && nvm use 22.22.2`, then
  confirm `node --version` before retrying.
- **Docker cannot connect:** start Docker Desktop or the Docker daemon and
  confirm `docker info` succeeds.
- **A required environment value is missing:** read the startup error, update
  the named value in `.env.local`, and rerun `pnpm dev`. The runner also rejects
  production Clerk keys, unsafe database targets, reused signing secrets, and
  cloud-only credentials in the local file.
- **Port already in use:** release ports `3001`, `8787`, and `9239`; the
  supported Compose topology binds all three to loopback.
- **A dependency changed but the image did not rebuild:** run
  `docker compose --env-file .env.local build --no-cache app`, then
  `pnpm dev`.
- **The UI loads but an external feature fails:** confirm the relevant remote
  service credential is populated and active. Supabase, Clerk, Daytona, Polar,
  Composio, and provider APIs are not emulated by Compose.
- **A provider webhook is being tested:** the provider must be configured to
  reach the local webhooks Worker through a trusted public ingress, and its
  signing secret must match `.env.local`. Loopback URLs cannot receive
  internet-originated callbacks by themselves.

### Verify the product

Product QA is direct browser operation only:

```bash
agent-browser --auto-connect --session cheatcode-debug open http://localhost:3001
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
