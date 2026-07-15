# CLAUDE.md

> Project context for Claude Code working on Cheatcode V2. The live source, deployment configuration, migrations, and package READMEs define the current architecture.

## What this is

Cheatcode is a generalist AI agent platform. Users describe what they want, agents build it — apps, slides, research, and browser automation. Web-only product. **BYOK across all paid providers** (LLMs, search, parsing, and automation APIs).

Direct competitors: Manus (generalist async agent), HappyCapy (GUI workstation + skills marketplace), Zo Computer (persistent personal cloud computer). Our wedge: mobile-first app builder + multi-agent transparency + BYOK economics.

## Stack at a glance

| Layer | Choice |
|---|---|
| Language | **TypeScript** everywhere. No Python in backend. Python lives only inside the Daytona sandbox. |
| Backend runtime | **Cloudflare Workers + Durable Objects + Workflows** |
| Frontend | **Next.js 16.2.9 + React 19.2.7 + Tailwind 4.3.1 + shadcn CLI 4.6.0 + AI Elements + Streamdown** on Vercel |
| Agent framework | **Mastra 1.42.0** on top of **Vercel AI SDK v6.0.205** |
| Sandbox | **Daytona Sandboxes** via REST-over-fetch (no SDK in Workers; `packages/tools-code/src/daytona-client.ts`) — one persistent sandbox per user with isolated project folders |
| Browser automation | **Stagehand v3.7.0 LOCAL mode** inside the Daytona sandbox image |
| Database | **Supabase Postgres via Cloudflare Hyperdrive** + **Drizzle 0.45.2** (no `service_role` from Workers — uses `app_worker` role) |
| Auth | **Clerk 7.5.2** (Workers JWT verify) |
| Billing | **Polar 0.48.1** (no fixed cost, rev-share only) |
| OAuth tool integrations | **Composio v3.1 REST via bounded `@cheatcode/composio` client** |
| Storage | **R2** (no Supabase Storage; zero egress) |
| Observability | **Cloudflare Workers Logs + Workers Tracing + Workers Analytics Engine** — no Sentry, no Langfuse, no Axiom |
| Default models | Claude Sonnet 4.6 (code) / GPT-5.4 Thinking (reasoning) / GPT-5.4 Mini fallback |

## Repo layout

```
apps/
  web/                    Next.js 16 frontend deployed by Vercel
  gateway-worker/         Public Hono router + Clerk JWT + rate limit
  agent-worker/           Agent loop + AgentRun DO + ProjectSandbox DO + Daytona adapter
  preview-proxy/          Cloudflare wildcard proxy in front of Daytona previews
  webhooks-worker/        Clerk, Polar, Composio webhooks + internal ops workflows

packages/
  agent-core/             Mastra agent, workflows, tools, and runtime contexts
  tools-code/             Sandbox shell/file/git/runCode tools
  tools-browser/          Stagehand LOCAL browser automation
  tools-docs/             pptxgenjs, docx, exceljs, @react-pdf/renderer
  tools-data/             Arquero CSV analysis + deterministic SVG charts
  tools-research/         Exa + Firecrawl
  db/                     Drizzle schema (per-domain) + queries + migrations
  byok/                   Vault-backed BYOK with provider validation
  skills/                 Build-time skill bundler + runtime loader
  observability/          Structured logger + error handler + Analytics Engine emitters
  env/                    @t3-oss/env-core per app
  types/                  Zod schemas + InferAgentUIMessage + branded IDs
  auth/                   Clerk verifyToken helpers
  billing/                Polar SDK wrappers + entitlement checks
  ui/                     shared UI primitives, icon barrel, AI response renderer
  tsconfig/               Shared base/nextjs/worker/library configs

skills/                   8 curated Anthropic SKILL.md skills
infra/                    Wrangler configs, Supabase migrations, Daytona sandbox Dockerfile/snapshot
scripts/                  Operational helpers only: build skills, secrets, deploy orchestration, migrations, audit archive
```

## Critical conventions (non-negotiable)

These are CI-enforced. Violating them blocks merge.

1. **No `any`** — use `unknown` + narrowing or Zod. Biome `noExplicitAny: error`.
2. **No `console.log`** — use the structured logger from `packages/observability`. Logger redacts BYOK keys, bearer tokens, and emails.
3. **No direct `process.env`** — import from `packages/env` (t3-env + Zod).
4. **Branded IDs** — `UserId`, `ProjectId`, `ThreadId`, `AgentRunId`, etc. from `packages/types`. Never mix.
5. **Default exports only where the framework requires** (Next.js routing, Worker entries, Mastra agent/workflow defs, config files). Everywhere else: named exports.
6. **No floating promises** — every promise is awaited, voided, or chained. Biome enforces.
7. **Zod-validate all trust boundaries** — HTTP input, LLM output, env, webhooks, DB rows from external systems.
8. **Files ≤800 lines, functions ≤50 lines, cognitive complexity ≤15.**
9. **BYOK keys** are decrypted on demand via `packages/byok` Vault RPC inside `withUserContext()` and passed only as request-scoped values. **Never log them, never cache in module scope, never persist to KV/DOs/R2.**
10. **Workers connect to Postgres as `app_worker` role**, never `service_role`. RLS is enabled only on `provider_keys` and `audit_log`.

## Common commands

```bash
pnpm install                          # Install all workspace deps
pnpm dev                              # Run Next dev plus the backend Workers through Wrangler
pnpm turbo skills:build               # Bundle skills/* into packages/skills/src/generated.ts
pnpm turbo db:generate                # Generate Drizzle types from schema
pnpm turbo lint                       # Biome check (fails on warnings in CI)
pnpm turbo typecheck                  # tsc --noEmit across all packages
pnpm turbo build                      # Production build
pnpm audit:archive -- --dry-run       # Admin-only audit partition archive plan
pnpm --filter @cheatcode/db db:generate  # Create new migration
```

Pre-commit (Lefthook) runs Biome on staged + typecheck on changed packages. Must stay <5s.
Product/acceptance testing is direct `agent-browser --auto-connect --session cheatcode-debug`
UI operation plus console/network/app-log review. Do not add or run scripted
browser/product-flow test harnesses; package `test` scripts and source-level
`*.test.ts` files are intentionally absent from the V2 command surface. Do not generate temporary validation scripts either; operate
the UI directly and check logs, and remove any throwaway product QA script that
appears in the V2 tree. Operational scripts may exist only for build,
migration, secret sync, Docker cleanup, and guarded deploy orchestration; they are not
product tests and must not simulate UI/user flows. Do not create temporary
testing scripts in `scripts/`, package folders, `/tmp`, or any out-of-tree
location. Delete future V2 product validators instead of running them. The
removed V1 tree must not be restored or copied back as a testing surface.

May 28, 2026 hardening: do not wrap product QA in `pnpm`, `tsx`, shell loops,
`/tmp` helpers, generated files, browser-driver wrappers, package aliases, or
any scripted flow. Each UI action, screenshot, console read, network/resource
inspection, and app-log inspection must be issued directly in the transcript.
Typecheck/lint/build remain code-health gates only.

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

## Where things live

| Need | File |
|---|---|
| Add a new tool | `packages/tools-<domain>/src/<tool>.ts` |
| Add a new agent | `packages/agent-core/src/mastra/agents/<name>.ts` |
| Add a new workflow | `packages/agent-core/src/mastra/workflows/<name>.ts` |
| Add a new skill | `skills/<name>/SKILL.md` (+ optional `references/` / `assets/`) |
| Add a DB table | `packages/db/src/schema/<domain>.ts` then `drizzle-kit generate` |
| Add a web route | `apps/web/src/app/<route>/page.tsx` (use `(app)` for the authenticated shell) |
| Add a Worker route | `apps/<worker>/src/<domain>-routes.ts`, registered from that Worker's `src/index.ts` |

## Skills system

8 curated skills bundled at build time into `packages/skills/src/generated.ts` (Workers have no filesystem at runtime). Anthropic SKILL.md format. V2 has no bundled skill scripts, no `evals/evals.json`, no local skill-eval runner, and no `skill_run_script` tool.

The 8 skills: `pitch-deck`, `deep-research` (covers parallel fan-out research), `competitor-brief`, `slide-from-prd`, `csv-analyst`, `social-post-pack`, `landing-page`, `mobile-app`. External skill registry exports, skills.sh links, public publishing scripts, and launch-prep copy are outside V2 unless the user explicitly re-expands the plan.

The bundler contract lives in `scripts/build-skills.ts` and `packages/skills`.

## What NOT to do

- ❌ Don't use Node `fs` at runtime in Workers — there's no filesystem. Bundle files at build time (see `scripts/build-skills.ts`).
- ❌ Don't use Supabase Realtime — Durable Objects own all streaming.
- ❌ Don't store files in Postgres `bytea` — index in R2 via `generated_outputs` table.
- ❌ Don't use Inngest — Cloudflare Workflows is the durable runtime.
- ❌ Don't add Sentry, Langfuse, or Axiom — use Workers-native observability only.
- ❌ Don't expose Cheatcode as an MCP server or add shadcn registry MCP tooling.
- ❌ Don't bypass `packages/byok` to access provider keys directly.
- ❌ Don't use `service_role` from Workers — `app_worker` only.
- ❌ Don't use `postgres.js` — use `pg` (node-postgres) per Cloudflare's Hyperdrive + Drizzle guide.
- ❌ Don't `drizzle-kit push` in production — always `generate` + review + `migrate`.
- ❌ Don't add hard step, token, or cost ceilings to agent loops — semantic completion decides when work is done; cancellation and timeouts remain operational guards.
- ❌ Don't add new vendors without an explicit architecture decision and matching documentation/config updates.

## Subagent / multi-agent patterns

Use Mastra Workflows for orchestration. Agent loops stop through Vercel AI SDK's semantic `isLoopFinished()` predicate, with no fixed step or token ceilings. The `deep-research-fanout` workflow is the canonical fanout implementation.

All agents for a user share that user's Daytona-backed `ProjectSandbox`. Isolate filesystem work in the relevant `/workspace/<project-slug>` folder and coordinate concurrent writes; never provision a sandbox per subagent.

## Architecture change discipline

The deleted `plan.md` is not authoritative and must not be restored. Use live source, schemas, migrations, deployment configuration, and package READMEs, and update those artifacts together when architecture changes.

## When stuck

- Sandbox not working? Start with `apps/agent-worker/src/durable-objects/project-sandbox-lifecycle.ts`, `apps/agent-worker/src/durable-objects/project-sandbox-runtime.ts`, and `packages/tools-code/src/daytona-client.ts`; check Daytona auth (`DAYTONA_API_KEY`), the configured snapshot and target, and toolbox/session requests.
- Auth broken? `packages/auth/` — Clerk JWT verify pattern with `@clerk/backend`.
- Skill not triggering? Inspect the bundled skill `description` first — it is
  the activation field, not the body. Use manual fixture review plus final UI
  QA through the direct browser workflow; do not add a local skill-eval test script or bundled skill script.
- Stream not resuming? Check AgentRun SSE replay state, `data-seq`, and the client resume cursor.
- Type errors that look impossible? Likely `exactOptionalPropertyTypes` or `noUncheckedIndexedAccess`. Both are strict-mode-only; not relaxed.
- "Cannot find module" in Worker? Missing `nodejs_compat` flag in `wrangler.jsonc`.
