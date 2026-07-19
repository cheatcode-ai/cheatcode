# Cheatcode V2

Cheatcode is a TypeScript-first generalist AI agent platform with a Vercel-hosted Next.js frontend, Cloudflare Workers, Durable Objects, Workflows, Daytona Sandboxes, Supabase Postgres, Clerk, and Polar.

The live source, package READMEs, migrations, and deployment configuration define the current system. The deleted `plan.md` is intentionally not authoritative and must not be restored.

## Local Setup

```bash
nvm use
cp .env.example .env.local
# Fill the Clerk development, Daytona, Polar sandbox, and integration values.
# Run `openssl rand -hex 32` thirteen times: four distinct local database passwords,
# three distinct per-Worker tenant-context HMAC secrets, and four distinct ccm2
# capability secrets, plus the preview-token and output-download signing secrets.
# Repeat each Worker password only in that Worker's matching connection URL.
pnpm dev
```

`pnpm dev` is the complete local entrypoint. Docker Compose builds the pinned
Node 22.22.2/pnpm 11.8.0 development image, starts the Vault-capable Postgres
database, provisions isolated `app_gateway`, `app_agent`, and `app_webhooks`
roles, applies all three local migration phases, and then starts Next.js plus the
chained Workers. Source changes sync into
the app container; migration changes restart the app behind the migration gate so
the stack cannot stay healthy against a stale schema, and dependency-file changes
rebuild it. Stop the stack with:

```bash
pnpm dev:down
```

After Weeks 1-8 are implemented in code, product QA is manual browser operation
only:

```bash
agent-browser --auto-connect --session cheatcode-debug open http://127.0.0.1:3000
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
in the repo are for build, migration, sandbox maintenance, and deploy
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

V2 production uses Vercel for `apps/web`, Cloudflare for the backend Workers,
Supabase, and hosted Daytona sandboxes. Build the sandbox image directly with
the command in `infra/containers/sandbox/README.md`; its AMD64 platform matches
Daytona's runner. Compose is local-only; it is not a production deployment path.

`pnpm dev` writes ignored `wrangler.local-dev.generated.jsonc` files next to
each Worker config with production-only Secrets Store bindings removed. Root
`.env.local` is the sole laptop credential source; Wrangler receives only each
Worker's allowlisted bindings, and Next retains only its own allowlisted values
after loading that root file. Production deploys still use the committed
`wrangler.jsonc` Secrets Store bindings. Each generated Worker config receives
only its own role-specific local Hyperdrive connection. Local startup rejects
Clerk live keys, non-sandbox Polar configuration, production Daytona workspace
inheritance, missing explicit snapshot/runtime settings, and cloud-control
credentials.

Expected local endpoints:

- `apps/web`: `http://127.0.0.1:3000`
- Gateway Worker: `http://127.0.0.1:8787` from one chained `wrangler dev`
  process that includes gateway, agent, webhooks, and the real preview-proxy
  Worker. Sandbox previews use `*.localhost:8787`; no extra domain is required.
- Wrangler inspector: `http://localhost:9239` (kept off 9229 so
  `agent-browser --auto-connect` attaches to Chrome on 9222, not workerd)
- Postgres: `postgres://localhost:54322/postgres` (loopback only)

Database migrations use an expand/contract/prove/finalize sequence enforced by
`scripts/migrate.ts`: raw pre-SQL and Drizzle migrations run before the backend
release; destructive runtime contractions run only behind the closed-writer
barrier. The one-time V1 retirement is a separate `release-finalization` stream:
production can apply it only after the exact dedicated-role CLOSED Workers pass
the signed database-readiness probe, and the release repeats that probe before
opening any writer. Every apply requires an explicit `--phase=pre-deploy`,
`--phase=post-deploy`, or `--phase=release-finalization`; `--phase=all` is
read-only planning only. Use
`SUPABASE_MIGRATION_URL` from root `.env.local` locally or protected CI
environment variables in production; it is never bound to a Worker. Production
DDL is applied only by the protected release workflow after it proves the pinned
database identity matches the three reviewed Hyperdrive targets. The Supabase
dashboard and MCP are read-only verification surfaces during a release, never an
alternative mutation path.

`scripts/migrate.ts` validates the target before it prints or applies a
migration plan. There is no standalone database validation script in V2; the
guardrail runs inside the migration operation that needs it.

Each database-backed Worker has its own Hyperdrive and Postgres login. Update all
three reviewed configuration IDs in one validated operation when provisioning or rotating them:

```bash
pnpm prod:set-hyperdrive -- \
  --gateway-id <GATEWAY_HYPERDRIVE_ID> \
  --agent-id <AGENT_HYPERDRIVE_ID> \
  --webhooks-id <WEBHOOKS_HYPERDRIVE_ID>
pnpm prod:set-hyperdrive -- \
  --gateway-id <GATEWAY_HYPERDRIVE_ID> \
  --agent-id <AGENT_HYPERDRIVE_ID> \
  --webhooks-id <WEBHOOKS_HYPERDRIVE_ID> \
  --apply
```

The GitHub static-check workflow runs repository-wide lint, typecheck, and build gates. The
`Production Release` workflow is a manual-only `workflow_dispatch` operation
gated by the phase-specific `STAGE_PRODUCTION_CLOSED`,
`RECONCILE_PRODUCTION_CLOSED`, or `OPEN_PRODUCTION`
confirmation and the `production` environment; a push to `main` must never deploy
Cloudflare resources, promote Vercel production, or mutate the production database
by itself. Local commands stay dry-run; the protected workflow alone supplies the
apply authorization and release-job deadline. Production release is deliberately split across three
manual dispatches for the same immutable commit. `stage-closed` first builds,
stages, and health-checks an exact-SHA Vercel production candidate without
assigning domains, then applies expand-only migrations while the current release
is still open. It next closes the gateway, deploys agent/webhooks in `draining`
so already admitted work can finish, proves stable quiescence, and deploys those
writers fully `closed`. The successful stage stores the exact Vercel deployment
ID, immutable URL, release SHA, control-workflow ref, and stage run identity in a
GitHub artifact; operators hand only that stage run ID to OPEN.
`reconcile-closed` re-proves ordinary Workflows drained, then runs the exact
release-scoped workspace and Daytona-snapshot Workflow across every active user while all writers
remain closed.
The `open` dispatch downloads and validates that immutable handoff and revalidates
the frontend artifact, writer barrier, and reconciliation evidence. Before any
contraction, it creates an encrypted custom-format dump of the `drizzle`, `public`,
and `vault` schemas plus an encrypted export of the decrypted Vault records. The
job decrypts the archive, verifies every file checksum, and makes `pg_restore`
parse the complete dump before the protected artifact is accepted. Only then does
OPEN apply contractions, promote that exact deployment ID, and prove the canonical
Vercel alias resolves to it. Backend OPEN then re-proves the contracted database target,
redeploys every writer CLOSED on its dedicated role, exercises all three roles
through a signed readiness aggregate, and reopens agent and webhooks before
gateway last. The critical section rechecks the exact canonical Vercel deployment
and production web SHA immediately before gateway opens. The
Workflow derives all project paths from live V2 data and the canonical generator;
it has no operator-supplied workspace map. Product correctness is
verified through direct `agent-browser` UI operation and logs, not standalone
product-flow validation scripts.

The protected `Production` GitHub environment must provide the
`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`,
`AUDIT_ARCHIVE_CLOUDFLARE_API_TOKEN`, `DAYTONA_API_KEY`,
`SUPABASE_MIGRATION_URL`, `VERCEL_TOKEN`,
`DATABASE_BACKUP_ENCRYPTION_KEY`, and
`RELEASE_DATABASE_READINESS_SECRET` secrets. The readiness secret must contain at
least 32 UTF-8 bytes and exists only in the protected release environment and the
three production writer Workers. The backup encryption key must also contain at
least 32 UTF-8 bytes. It exists only in the protected release environment and is
needed to recover the encrypted 90-day pre-contraction artifact; it is never bound
to an application Worker. Before any release phase,
the checksum-pinned Daytona CLI verifies that the configured immutable snapshot
exists exactly once, is active with the reviewed resources and region, and was
built from unchanged sandbox image source on the release's ancestry. It also requires the shared
production workspace volume exactly once in the same organization, ready and error-free, and
rejects duplicate canonical sandbox labels so Durable Object recovery is independent of physical
sandbox names. Daytona volumes use provider-managed object-store capacity and expose no fixed
region or size field; the target is instead checked on the snapshot and every canonical sandbox.
The one-time
`CHEATCODE_MIGRATION_ATTESTATIONS` protected secret is also required while the
attested V1 external-resource contraction remains pending and should be removed
after that raw migration is recorded. Repository variables provide
the four `SUPABASE_MIGRATION_EXPECTED_*` identity values, `VERCEL_ORG_ID`,
`VERCEL_PROJECT_ID`, and `NEXT_PUBLIC_GATEWAY_URL`. Static checks use an inert,
test-shaped Clerk publishable value rather than a deployable credential. Protected deployment URLs are verified with
authenticated `vercel curl` requests using the scoped CI token, so no separate
protection-bypass secret is distributed. `VERCEL_PRODUCTION_URL` is required and
must exactly equal the canonical `https://trycheatcode.com` frontend origin.
Use one least-privilege Cloudflare release token scoped to the production account
and the exact `trycheatcode.com` zone. It needs account `Workers Scripts Write`
(the Workflows list/detail/version/instance APIs accept this permission), exact-zone
`Workers Routes Write`, exact-zone `Zone Read`, and account `Workers R2 Storage Read`
for the read-only output lifecycle verification; add only a named read permission
that the pinned Wrangler version demonstrably requests. Do not grant broad Account
or Zone Write. The backend verifies the checked-in route contract and creates only
missing exact no-script exclusions for Clerk, documentation, and `www` before the
preview wildcard is deployed. The same fail-closed release gate verifies the exact
`cheatcode-outputs` lifecycle contract: abandoned multipart uploads expire after seven
days and unindexed output objects expire after 60 days. See Cloudflare's [permission catalog](https://developers.cloudflare.com/fundamentals/api/reference/permissions/)
and [Workflows API authorization](https://developers.cloudflare.com/api/resources/workflows/methods/list/).

Publish a new immutable Daytona snapshot after changing `infra/containers/sandbox/`
by dispatching the protected workflow from `main`:

```bash
gh workflow run build-snapshot.yml --ref main -f confirmation=BUILD_SNAPSHOT
```

Review the emitted immutable snapshot name, then commit it in the agent Worker
configuration. A local AMD64 Docker build is an optional non-publishing check;
production Daytona credentials and snapshot publication stay in GitHub.

Worker commands are dry-run locally:

```bash
pnpm deploy:workers -- --phase stage-closed
pnpm deploy:workers -- --phase open
pnpm reconcile:production-workspaces -- --release-sha <40-character-sha>
```

Production release mutation is authorized only through the protected three-dispatch
`Production Release` workflow. Do not run a partial local `--apply`, promote a
Vercel URL manually, or flip a Worker gate in the dashboard; those paths cannot
produce the immutable cross-provider handoff and recovery evidence.

Audit retention has a separate protected `Audit Archive` workflow because it is
maintenance rather than a release. It accepts an exact plan/apply confirmation,
uses the pinned production database identity, and receives a dedicated
bucket-scoped Cloudflare token. Production audit DDL and R2 operations cannot run
from a laptop.

The committed Wrangler files are authoritative: an apply replaces Worker vars
with a generated copy of the declared config plus the exact release SHA and does
not retain undeclared dashboard vars. The `stage-closed` phase closes the gateway
first, then deploys agent and webhooks at the exact SHA in `draining`. Fresh HTTP,
scheduled, and ordinary Workflow admissions are rejected while already-admitted
Workflow, Durable Object, sandbox, and persistence continuations finish. Two stable
drain proofs must pass before agent and webhooks are redeployed `closed`; the proofs
are then repeated and the current preview proxy is deployed. Stage-only generated
configs use the transition `app_worker` Hyperdrive until role grants expand; source
and OPEN configs always retain the dedicated least-privilege Hyperdrives. The
separate reconciliation phase runs the one exact release-scoped workspace Workflow
while every writer remains closed. The outer OPEN workflow applies contractions and
promotes the selected Vercel artifact before invoking the backend OPEN half; the
backend script independently verifies both facts before changing a writer. Its
360-minute job admits mutation only when the full 230-minute stage budget (or
160-minute OPEN budget) plus a separate 50-minute fail-closed recovery reserve
still fits. Every child process, health poll, Cloudflare request, Vercel proof, and
database query is clipped to that absolute budget. If a barrier-owned step
fails, the operation re-deploys and verifies gateway, agent, and webhooks closed
before stopping; an unverified recovery is reported as an urgent unconfirmed
writer state. The local deploy script releases only the Cloudflare backend.
Production disables every Vercel Git auto-deploy and promotes the staged prebuilt
frontend only from the coordinated release workflow.

The `app_worker` binding override is deliberately one-shot. Before mutating any
Worker, stage verifies the pinned raw-migration ledger and refuses to run once
`0059_finalize_worker_database_roles.sql` has dropped that role. The immediate
steady-state follow-up release must remove the transition Hyperdrive ID, transition
binding mode, ledger guard, and all transition-only documentation/config branches;
its draining and closed deployments use the dedicated source Hyperdrives directly.
This hard stop prevents one-time cutover compatibility from becoming a permanent
release path.

Release-barrier recovery is deliberately operator-dispatched. If automated
close-gate recovery is unconfirmed, inspect all three writer health responses,
fix the transient cause, and rerun the complete deployment from the same
immutable commit. The forward-only preflight permits that exact gateway-closed
SHA to resume even when a partial failure left downstream gates incomplete;
no different or older release receives that repair exception. Once recovery is
verified, the sequence is idempotent and re-verifies every release identity. If the
release
cannot continue, leave the gateway closed and dispatch a reviewed,
forward-compatible `stage-closed` release that explicitly names the superseded
closed SHA. Both the currently deployed open SHA and an explicitly superseded
closed SHA must be strict Git ancestors of the candidate; only resuming the exact
same closed SHA is exempt. Never deploy older code after a schema contraction, flip the gate
open in the dashboard, or reopen it against an unverified agent version.

The release barrier rejects new admissions without canceling a pinned Workflow
or Durable Object continuation already in flight. Before any DDL, the draining
phase explicitly waits for relationally active
AgentRuns and every retained AgentRun/webhook/ops/resource-deletion Workflow to
become quiescent across stable Cloudflare API passes.
Errored and terminated instances fail immediately because Cloudflare can restart
them on that retiring version; `complete` is the only retained status ignored by
the drain gate. `infra/cloudflare/production-workflow-inventory.json` is the
authoritative account inventory: undeclared or duplicate Cheatcode resources fail
the release, and a `retiring` entry remains scanned until its exact resource is
purged. Newly created resources must have their Cloudflare IDs pinned in the first
steady-state follow-up commit.
Persisted Durable Object changes use in-place schema reconciliation rather than
assuming the HTTP gate makes that state transition atomic. Canonical workspace
reconciliation therefore runs inside the user's durable sandbox transition fence,
which rejects new workspace operations
and waits for operations already admitted by that object before touching a
folder.

The repository contains only the active V2 implementation. The legacy V1 source
tree was permanently removed on July 13, 2026 after explicit user authorization.
