# AGENTS.md

> Cross-tool context for AI coding agents working on Cheatcode V2 (OpenAI Codex, Cursor, Gemini CLI, Aider, Cline, etc.). Follows the [agents.md](https://agents.md) open spec. The live source, deployment configuration, migrations, and package READMEs define the current architecture.

## Project

Cheatcode is a generalist AI agent platform on Cloudflare. Users describe what they want; agents build apps, slides, research, browser automation, and media. **TypeScript everywhere. BYOK across all paid providers.**

Status: active V2 build. The user authorized permanent removal of the local V1
source tree on July 13, 2026; the repository now contains V2 code only.

## Stack

| Layer | Choice |
|---|---|
| Backend | Cloudflare Workers + Durable Objects + Workflows |
| Frontend | Next.js 16.2.10 + React 19.2.7 + Tailwind 4.3.2 + shadcn 4.6.0 + AI Elements + Streamdown on Vercel |
| Agent framework | Mastra 1.51.0 on Vercel AI SDK v6.0.205 |
| Sandbox | Daytona per-user sandboxes via REST-over-fetch |
| Browser | Stagehand v3.7.0 LOCAL inside the Daytona sandbox snapshot |
| Database | Supabase Postgres via Hyperdrive + Drizzle 0.45.2 |
| Auth | Clerk 7.5.19 |
| Billing | Polar 0.48.1 |
| OAuth tools | Composio v3.1 REST via bounded `@cheatcode/composio` client |
| Storage | R2 (no Supabase Storage) |
| Observability | Workers Logs + Workers Tracing + Workers Analytics Engine (no third-party APM in the initial release) |
| Lint/format | Biome 2.5.2 (single config, no ESLint+Prettier except next plugin) |
| QA | Direct `agent-browser --auto-connect --session cheatcode-debug` UI operation + console/network/log review; no scripted test harnesses |
| Monorepo | pnpm 11.15.0 + Turborepo 2.10.5 |

## Repo layout

```
apps/                    Deployable services
  web/                   Next.js 16 frontend deployed by Vercel
  gateway-worker/        Public Hono router + Clerk JWT + rate limit
  agent-worker/          Agent loop + AgentRun DO + per-user ProjectSandbox DO
  preview-proxy/         Cloudflare Worker in front of Daytona previews
  webhooks-worker/       Polar/Clerk/Composio webhooks + internal ops workflows

packages/                Shared libraries
  agent-core/            Mastra instance + workflows
  tools-*/               Tool implementations per domain
  db/                    Drizzle schema (per-domain) + queries + migrations
  byok/                  Vault-backed BYOK key store
  skills/                Build-time skill bundler
  observability/         Structured logger + error handler + Analytics Engine emitters
  env/                   t3-env + Zod
  types/                 Zod schemas + branded IDs + InferAgentUIMessage
  ui/                    Shared Cheatcode UI primitives, icon barrel, AI response renderer

skills/                  8 curated Anthropic SKILL.md skills
infra/                   Wrangler configs, Supabase migrations, Daytona sandbox Dockerfile
scripts/                 Operational helpers only: build skills, local startup, deploy orchestration, migrations, audit archive
```

## Build

```bash
pnpm install                            # Install workspace deps (use pnpm@11.15.0, not npm/yarn)
pnpm turbo skills:build                 # Bundle skills/ into packages/skills/src/generated.ts (REQUIRED before build)
pnpm turbo db:generate                  # Generate Drizzle types from schema
pnpm turbo build                        # Production build
```

`skills:build` is a build dependency — it must run before any package compiles. Turborepo handles ordering.

## Code Checks + Product QA

```bash
pnpm turbo typecheck                    # tsc --noEmit across all packages
pnpm turbo lint                         # Biome check (fails CI on warnings)
pnpm turbo build                        # Production build
```

Product/acceptance testing is direct `agent-browser --auto-connect --session cheatcode-debug`
UI interaction only: click/fill/type through real flows, capture screenshots,
inspect console/network output, and read app logs. Do not add or run scripted
test harnesses for product flows, browser automation, prompt submission, auth,
accessibility, load, or final E2E. Package `test` scripts are intentionally not
part of the V2 command surface, and source-level `*.test.ts` files are
intentionally absent. Do not generate temporary validation scripts either;
operate the UI directly and check logs, and remove any throwaway product QA
script that appears in the V2 tree. Operational scripts may exist only for
build, migration, secret sync, Docker cleanup, and guarded deploy orchestration;
they are not product tests and must not simulate UI/user flows. Do not create temporary
testing scripts in `scripts/`, package folders, `/tmp`, or any out-of-tree
location.

May 27, 2026 user override: never use scripts for product testing. Product QA
means direct `agent-browser` UI operation, screenshots, console/network
inspection, and running app-log review only. Delete any future V2 product-flow
validator, prompt runner, browser wrapper, or throwaway QA helper on sight
instead of running it. The removed V1 tree must not be restored, copied back,
or used as a source of product-test scripts.

May 28, 2026 hardening: do not wrap product QA in `pnpm`, `tsx`, shell loops,
`/tmp` helpers, generated files, browser-driver wrappers, package aliases, or
any scripted flow. Every product UI action, screenshot, console read,
network/resource inspection, and app-log inspection must be issued directly in
the transcript. Typecheck/lint/build are code-health gates only; they are not
product QA.

May 28, 2026 direct override: delete any product-flow test script, temporary
helper, command-loop runner, browser wrapper, prompt driver, curl flow, or
package alias when discovered. The active V2 tree should contain no product-test
scripts. The remaining `scripts/` files are operational only and must not click
the UI, submit prompts, drive auth, gather acceptance evidence, or replace
direct `agent-browser` operation.

May 28, 2026 latest user directive: code the all-weeks V2 surface first, then
run final product QA only through direct `agent-browser --auto-connect --session
cheatcode-debug` UI actions and direct console/network/app-log inspection. Do
not write, run, or keep scripts to submit prompts, click UI, drive auth, wrap
`agent-browser`, run curl flows, or gather acceptance evidence.

## Run locally

```bash
pnpm dev                                # Compose: Next + chained Workers against production Supabase
pnpm dev:down                           # Stop the local Compose stack
```

Required local env vars in `.env.local` (template in `.env.example`):

```
# Production Supabase session-pooler URLs for the three isolated Worker roles.
# Administrative migration credentials never belong in .env.local.
SUPABASE_GATEWAY_DATABASE_URL=
SUPABASE_AGENT_DATABASE_URL=
SUPABASE_WEBHOOKS_DATABASE_URL=

# Per-Worker signed tenant context (three distinct secrets, each at least 32 bytes)
DATABASE_CONTEXT_SIGNING_SECRET_GATEWAY=
DATABASE_CONTEXT_SIGNING_SECRET_AGENT=
DATABASE_CONTEXT_SIGNING_SECRET_WEBHOOKS=

# Daytona
DAYTONA_API_KEY=
DAYTONA_API_URL=https://app.daytona.io/api
DAYTONA_TARGET=us
DAYTONA_SANDBOX_SNAPSHOT=
DAYTONA_WORKSPACE_VOLUME=cheatcode-workspaces-development
PREVIEW_TOKEN_SECRET=

# Clerk development instance only
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=

# Polar
POLAR_ACCESS_TOKEN=
POLAR_WEBHOOK_SECRET=

# Composio
COMPOSIO_API_KEY=
COMPOSIO_AUTH_CONFIGS={"github":"ac_...","gmail":"ac_...","slack":"ac_...","notion":"ac_...","linear":"ac_..."}
COMPOSIO_WEBHOOK_SECRET=

# Internal ops alerts
INTERNAL_ALERT_WEBHOOK_SECRET=

# Capability-scoped ccm2 contracts (four distinct secrets, each at least 32 bytes)
GATEWAY_TO_WEBHOOKS_RESOURCE_DELETION_SECRET=
WEBHOOKS_TO_AGENT_LIFECYCLE_SECRET=
INTERNAL_WEBHOOK_REPLAY_SECRET=
RELEASE_DATABASE_READINESS_SECRET=

# Gateway
NEXT_PUBLIC_GATEWAY_URL=http://127.0.0.1:8787
```

Never commit `.env.local`. It is the sole laptop application credential file;
its database URLs contain only the three least-privilege production runtime
roles. Vercel and Cloudflare receive production credentials directly through
their protected production environments. Administrative migration credentials
live only in git-ignored `.env.migrate` on authorized operator workstations.

## Code conventions (CI-enforced)

1. **No `any`** — use `unknown` + narrowing or Zod validation.
2. **No `console.log`** — use the structured logger from `packages/observability`.
3. **No direct `process.env`** — import from `packages/env`.
4. **Branded IDs** for every entity (`UserId`, `ProjectId`, etc.).
5. **Default exports only where the framework requires** (Next.js routing, Worker entries, Mastra agent defs).
6. **No floating promises** — await, void, or chain every promise.
7. **Zod-validate at trust boundaries** — HTTP input, LLM output, env, webhooks.
8. **Files ≤800 lines, functions ≤50 lines, cognitive complexity ≤15.**
9. **BYOK keys never logged.** Decrypt only inside the active `withUserContext()` transaction and pass request-scoped values downward. Do not cache plaintext in module scope, KV, DO storage, logs, or R2.
10. **Workers use separate least-privilege Postgres roles**: `app_gateway`,
    `app_agent`, and `app_webhooks`. They never use `service_role`; the historical
    `app_worker` transition role must not exist in the production-ready target.

The enforced rules live in the root `biome.jsonc` and TypeScript configs.

## Naming

- Files: `kebab-case.ts`. React components: `PascalCase.tsx`. Type-only files: `*.types.ts`.
- Types/interfaces: `PascalCase`. No `I` prefix.
- Functions/variables: `camelCase`. Booleans: `is/has/can/should` prefix.
- Constants: `UPPER_SNAKE_CASE` only for true module-level immutables.

## Commit messages

Conventional commits required (enforced by commitlint via Lefthook `commit-msg` hook):

```
feat(agent): add wide research workflow
fix(sandbox): handle snapshot restore on cold start
refactor(db): split provider_keys into keys.ts
chore(skills): update pitch-deck references
chore(sandbox): update Daytona snapshot
docs(architecture): document the build-time bundler pattern
```

PR titles follow the same convention. Single-line, <72 chars.

## What NOT to do

- ❌ **Don't use Node `fs` at runtime in Workers** — no filesystem. Bundle at build time.
- ❌ **Don't use Supabase Realtime** — Durable Objects own streaming.
- ❌ **Don't add Inngest, Sentry, Langfuse, or Axiom** — use Workers-native primitives.
- ❌ **Don't store files in Postgres** — R2 + `generated_outputs` index.
- ❌ **Don't use `service_role` from Workers.**
- ❌ **Don't use `postgres.js`** — use `pg` (node-postgres) for Hyperdrive compatibility.
- ❌ **Don't `drizzle-kit push` in production** — `generate` → review → `migrate`.
- ❌ **Don't bypass `packages/byok`** to access provider keys.
- ❌ **Don't expose Cheatcode as an MCP server** — Cheatcode consumes MCPs only.
- ❌ **Don't add hard step, token, or cost ceilings to agent loops** — use semantic completion; cancellation and timeouts are operational guards.
- ❌ **Don't introduce new vendors** without an explicit architecture decision and matching documentation/config updates.

## Architecture change discipline

The deleted `plan.md` is not authoritative and must not be restored. Base changes on the live code, schemas, migrations, deployment configuration, and package READMEs. Update these documents in the same change whenever an architectural boundary moves.

Specifically check before changing:
- `pnpm-workspace.yaml` and the lockfile for exact dependency versions
- `packages/db/src/schema`, `packages/db/drizzle`, and `infra/supabase/migrations` for Postgres behavior
- Worker `wrangler.jsonc`, `apps/web/vercel.json`, and `.github/workflows` for deployment topology
- `biome.jsonc` and TypeScript configs for code-quality rules

## Documentation

Each package has a `README.md` with: purpose, public exports, code checks, env vars consumed. JSDoc required on Mastra tool definitions (descriptions are part of the LLM prompt — production behavior, not docs).

## Getting help

- Architecture questions → live app/package boundaries and their READMEs
- Tool/library version questions → `pnpm-workspace.yaml` and `pnpm-lock.yaml`
- Schema questions → `packages/db/src/schema`, Drizzle migrations, and Supabase migrations
- Skill writing → `skills/*/SKILL.md` plus `scripts/build-skills.ts`
- Lint/strict-mode → `biome.jsonc` and the root/package TypeScript configs
