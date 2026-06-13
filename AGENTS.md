# AGENTS.md

> Cross-tool context for AI coding agents working on Cheatcode V2 (OpenAI Codex, Cursor, Gemini CLI, Aider, Cline, etc.). Follows the [agents.md](https://agents.md) open spec. The complete architecture lives in [`plan.md`](./plan.md).

## Project

Cheatcode is a generalist AI agent platform on Cloudflare. Users describe what they want; agents build apps, slides, research, browser automation, and media. **TypeScript everywhere. BYOK across all paid providers.**

Status: clean greenfield V2 build. The legacy V1 tree under `cheatcode/` is
preserved as ignored reference material and must not be deleted unless the user
explicitly asks to delete the V1 code by name — see `plan.md` Section 20.

## Stack

| Layer | Choice |
|---|---|
| Backend | Cloudflare Workers + Durable Objects + Workflows |
| Frontend | Next.js 16.2.6 + React 19.2.6 + Tailwind 4.3 + shadcn + AI Elements + Streamdown on Cloudflare Workers via OpenNext |
| Agent framework | Mastra 1.35 on Vercel AI SDK v6.0.182 |
| Sandbox | Blaxel Sandboxes via `@blaxel/core@0.2.84` per project |
| Browser | Stagehand v3.2 LOCAL inside the Blaxel sandbox image |
| Database | Supabase Postgres via Hyperdrive + Drizzle 0.45.2 |
| Auth | Clerk 7.3.4 |
| Billing | Polar 0.46.4 |
| OAuth tools | Composio `@composio/core@0.8.1` |
| Storage | R2 (no Supabase Storage) |
| Observability | Workers Logs + Workers Tracing + Workers Analytics Engine (no third-party APM in V1) |
| Lint/format | Biome 2.4 (single config, no ESLint+Prettier except next plugin) |
| QA | Direct `agent-browser --auto-connect --session cheatcode-debug` UI operation + console/network/log review; no scripted test harnesses |
| Monorepo | pnpm 10 + Turborepo 2.5 |

## Repo layout

```
apps/                    Deployable services
  web/                   Next.js 16 on Cloudflare Workers via OpenNext
  gateway-worker/        Public Hono router + Clerk JWT + rate limit
  agent-worker/          Agent loop + AgentRun DO + ProjectSandbox DO
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
  ui/                    Shared V1-parity UI primitives, icon barrel, AI response renderer

skills/                  9 curated Anthropic SKILL.md skills
infra/                   Wrangler configs, Supabase migrations, Blaxel sandbox Dockerfile
scripts/                 Operational helpers only: build skills, secrets, deploy orchestration, migrations, audit archive
```

## Build

```bash
pnpm install                            # Install workspace deps (use pnpm@10, not npm/yarn)
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
instead of running it. Preserved V1 tests under `cheatcode/` are ignored
reference material only; do not run, copy, or delete them unless the user
explicitly asks to delete V1 code by name.

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
pnpm dev                                # apps/web (Next dev) + all Workers (wrangler dev) + Miniflare
```

Required local env vars in `.env.local` (template in `.env.example`):

```
# Cloudflare
CLOUDFLARE_API_TOKEN=
CLOUDFLARE_ACCOUNT_ID=
CLOUDFLARE_ANALYTICS_API_TOKEN=
OUTPUT_DOWNLOAD_SIGNING_SECRET=

# Blaxel
BL_API_KEY=
BL_WORKSPACE=cheatcode
BL_REGION=us-pdx-1
BLAXEL_SANDBOX_IMAGE=sandbox/cheatcode-sandbox:yoo6c20wgw03

# Supabase — Workers/Next connect as app_worker only (never service_role).
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
DATABASE_URL=
# SUPABASE_MIGRATION_URL (admin/DDL role) is NOT here — it lives in a git-ignored
# .env.migrate, used only by scripts/migrate.ts and scripts/archive-audit-log.ts.
# Never bind it to a Worker.

# Clerk
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=

# Polar
NEXT_PUBLIC_POLAR_PRO_MONTHLY_PRODUCT_ID=
POLAR_ACCESS_TOKEN=
POLAR_WEBHOOK_SECRET=

# Composio
COMPOSIO_API_KEY=
COMPOSIO_AUTH_CONFIGS={"github":"ac_...","gmail":"ac_...","slack":"ac_...","notion":"ac_...","linear":"ac_..."}
COMPOSIO_WEBHOOK_SECRET=

# Internal ops alerts
INTERNAL_ALERT_WEBHOOK_SECRET=
INTERNAL_MAINTENANCE_SECRET=

# Gateway
NEXT_PUBLIC_GATEWAY_URL=https://gateway.trycheatcode.com
```

Never commit `.env.local`. Use `wrangler secrets-store secret create` for production app
secrets. Blaxel credentials (`BL_API_KEY`, `BL_WORKSPACE`, `BL_REGION`) are standard
Worker secrets on `cheatcode-agent`; sync them with `pnpm sync:worker-secrets -- --apply`,
which uses `wrangler versions secret put`.

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
10. **Workers connect as `app_worker` Postgres role**, never `service_role`.

Full lint + strict-mode config in `plan.md` Section 21.

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
chore: bump @blaxel/core to 0.2.84
docs(plan): update Section 12 with build-time bundler pattern
```

PR titles follow the same convention. Single-line, <72 chars.

## What NOT to do

- ❌ **Don't use Node `fs` at runtime in Workers** — no filesystem. Bundle at build time.
- ❌ **Don't use Supabase Realtime** — Durable Objects own streaming.
- ❌ **Don't add Inngest, Sentry, Langfuse, or Axiom** — Workers-native primitives only for V1.
- ❌ **Don't store files in Postgres** — R2 + `generated_outputs` index.
- ❌ **Don't use `service_role` from Workers.**
- ❌ **Don't use `postgres.js`** — use `pg` (node-postgres) for Hyperdrive compatibility.
- ❌ **Don't `drizzle-kit push` in production** — `generate` → review → `migrate`.
- ❌ **Don't bypass `packages/byok`** to access provider keys.
- ❌ **Don't expose Cheatcode as an MCP server** — V1 consumes MCPs only.
- ❌ **Don't introduce new vendors** without proposing the change in plan.md first.

## Plan.md is source of truth

If a proposed change contradicts `plan.md`, **update plan.md in the same PR** before implementing. Architectural drift is the top failure mode.

Specifically check before changing:
- Section 4: locked tech stack versions
- Section 7: Postgres schema
- Section 11: feature → architecture mapping
- Section 21: code quality + lint rules

## Documentation

Each package has a `README.md` with: purpose, public exports, code checks, env vars consumed. JSDoc required on Mastra tool definitions (descriptions are part of the LLM prompt — production behavior, not docs).

## Getting help

- Architecture questions → `plan.md`
- Tool/library version questions → `plan.md` Section 4 (locked exact pins)
- Schema questions → `plan.md` Section 7
- Skill writing → `plan.md` Section 12
- Lint/strict-mode → `plan.md` Section 21
