# CLAUDE.md

> Project context for Claude Code working on Cheatcode V2. The complete architecture lives in [`plan.md`](./plan.md). This file is the cliff-notes version Claude auto-loads every session.

## What this is

Cheatcode is a generalist AI agent platform. Users describe what they want, agents build it — apps, slides, research, browser automation, and media generation. Web-only product. **BYOK across all paid providers** (LLMs, image/video, TTS/STT, search).

Direct competitors: Manus (generalist async agent), HappyCapy (GUI workstation + skills marketplace), Zo Computer (persistent personal cloud computer). Our wedge: mobile-first app builder + multi-agent transparency + BYOK economics.

## Stack at a glance

| Layer | Choice |
|---|---|
| Language | **TypeScript** everywhere. No Python in backend. Python lives only inside the Daytona sandbox. |
| Backend runtime | **Cloudflare Workers + Durable Objects + Workflows** |
| Frontend | **Next.js 16.2.6 + React 19.2.6 + Tailwind 4.3 + shadcn CLI 4.6 + AI Elements + Streamdown** on Cloudflare Workers via OpenNext |
| Agent framework | **Mastra 1.35** on top of **Vercel AI SDK v6.0.182** |
| Sandbox | **Daytona Sandboxes** via REST-over-fetch (no SDK in Workers; `packages/tools-code/daytona-client.ts`) — one persistent sandbox per project (disk is the durable store) |
| Browser automation | **Stagehand v3.2 LOCAL mode** inside the Daytona sandbox image; noVNC for user takeover (via the `preview-proxy` worker) |
| Database | **Supabase Postgres via Cloudflare Hyperdrive** + **Drizzle 0.45.2** (no `service_role` from Workers — uses `app_worker` role) |
| Auth | **Clerk 7.3.4** (Workers JWT verify) |
| Billing | **Polar 0.46.4** (no fixed cost, rev-share only) |
| OAuth tool integrations | **Composio `@composio/core@0.8.1`** |
| Storage | **R2** (no Supabase Storage; zero egress) |
| Observability | **Cloudflare Workers Logs + Workers Tracing + Workers Analytics Engine** — no Sentry, no Langfuse, no Axiom |
| Default models | Claude Sonnet 4.6 (code) / GPT-5.4 Thinking (reasoning) / GPT-5.4 Mini fallback |

## Repo layout

```
apps/
  web/                    Next.js 16 (Cloudflare Workers/OpenNext)
  gateway-worker/         Public Hono router + Clerk JWT + rate limit
  agent-worker/           Agent loop + AgentRun DO + ProjectSandbox DO + Daytona adapter
  preview-proxy/          Custom preview proxy (preview.trycheatcode.com) in front of Daytona previews
  webhooks-worker/        Clerk, Polar, Composio webhooks + internal ops workflows

packages/
  agent-core/             Mastra instance + ToolLoopAgent wrappers + workflows
  tools-code/             Sandbox shell/file/git/runCode tools
  tools-browser/          Stagehand LOCAL + noVNC takeover
  tools-docs/             pptxgenjs, docx, exceljs, @react-pdf/renderer
  tools-data/             Arquero CSV analysis + Recharts SSR charts in the sandbox
  tools-media/            FAL (image/video) + ElevenLabs (TTS/STT)
  tools-research/         Exa + Firecrawl
  db/                     Drizzle schema (per-domain) + queries + migrations
  byok/                   Vault-backed BYOK with provider validation
  skills/                 Build-time skill bundler + runtime loader
  observability/          Structured logger + error handler + Analytics Engine emitters
  env/                    @t3-oss/env-core per app
  types/                  Zod schemas + InferAgentUIMessage + branded IDs
  auth/                   Clerk verifyToken helpers
  billing/                Polar SDK wrappers + entitlement checks
  ui/                     shared V1-parity UI primitives, icon barrel, AI response renderer
  tsconfig/               Shared base/nextjs/worker/library configs
  biome-config/           Shared biome.jsonc

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
pnpm dev                              # Run apps/web + all Workers via wrangler dev
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
location. Delete future V2 product validators instead of running them. Legacy
V1 tests under `cheatcode/` are preserved reference material only and are not
part of V2 QA.

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
| Add a new skill | `skills/<name>/SKILL.md` (+ optional `references/` / `assets/`) — see plan.md Section 12 |
| Add a DB table | `packages/db/src/schema/<domain>.ts` then `drizzle-kit generate` |
| Add a Worker route | `apps/<worker>/src/routes/<name>.ts` |

## Skills system

8 curated skills bundled at build time into `packages/skills/src/generated.ts` (Workers have no filesystem at runtime). Anthropic SKILL.md format. V2 has no bundled skill scripts, no `evals/evals.json`, no local skill-eval runner, and no `skill_run_script` tool.

The 8 skills: `pitch-deck`, `deep-research` (covers parallel fan-out research), `competitor-brief`, `slide-from-prd`, `csv-analyst`, `social-post-pack`, `landing-page`, `mobile-app`. External skill registry exports, skills.sh links, public publishing scripts, and launch-prep copy are outside V2 unless the user explicitly re-expands the plan.

Full details in plan.md Section 12.

## What NOT to do

- ❌ Don't use Node `fs` at runtime in Workers — there's no filesystem. Bundle files at build time (see `scripts/build-skills.ts`).
- ❌ Don't use Supabase Realtime — Durable Objects own all streaming.
- ❌ Don't store files in Postgres `bytea` — index in R2 via `generated_outputs` table.
- ❌ Don't use Inngest — Cloudflare Workflows is the durable runtime.
- ❌ Don't add Sentry, Langfuse, or Axiom — V1 ships Workers-native observability only.
- ❌ Don't expose Cheatcode as an MCP server, and don't add shadcn registry MCP tooling in V1.
- ❌ Don't bypass `packages/byok` to access provider keys directly.
- ❌ Don't use `service_role` from Workers — `app_worker` only.
- ❌ Don't use `postgres.js` — use `pg` (node-postgres) per Cloudflare's Hyperdrive + Drizzle guide.
- ❌ Don't `drizzle-kit push` in production — always `generate` + review + `migrate`.
- ❌ Don't add new vendors without checking plan.md Section 19 first.

## Subagent / multi-agent patterns

Use Mastra Workflows for orchestration. Each subagent is a `ToolLoopAgent` with explicit `stopWhen: stepCountIs(N)` budget caps. The `deep-research-fanout` workflow shows the canonical fanout pattern (see plan.md Section 8.5).

When using subagents for complex tasks, give each their own Daytona-backed ProjectSandbox if they need isolated filesystem state. Otherwise share the parent's sandbox.

## Plan.md is source of truth

If you're proposing a change that contradicts `plan.md`, **update plan.md first** in the same PR. Architectural drift between plan and code is the #1 cause of bit-rot.

## When stuck

- Sandbox not working? `apps/agent-worker/src/durable-objects/project-sandbox.ts` + `packages/tools-code/src/daytona-client.ts` — check Daytona auth (`DAYTONA_API_KEY`), sandbox name/snapshot, `DAYTONA_TARGET` region, and the toolbox/session paths. Reference: `docs/plans/daytona-rest-reference.md`.
- Auth broken? `packages/auth/` — Clerk JWT verify pattern with `@clerk/backend`.
- Skill not triggering? Inspect the bundled skill `description` first — it is
  the activation field, not the body. Use manual fixture review plus final UI
  QA from plan.md Section 12.3; do not add a local skill-eval test script or bundled skill script.
- Stream not resuming? Check AgentRun SSE replay state, `data-seq`, and the client resume cursor.
- Type errors that look impossible? Likely `exactOptionalPropertyTypes` or `noUncheckedIndexedAccess`. Both are strict-mode-only; not relaxed.
- "Cannot find module" in Worker? Missing `nodejs_compat` flag in `wrangler.jsonc`.
