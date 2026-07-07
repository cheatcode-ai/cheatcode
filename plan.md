# Cheatcode V2 — Complete Implementation Plan

> Greenfield TypeScript build. Clean migration, no phasing. Locked stack as of May 19, 2026.
> Legacy preservation rule: the existing V1 code under `cheatcode/` is protected
> reference material. Do not delete, move, rewrite, archive, or otherwise clean
> up that tree until the user explicitly asks you to delete the V1 code by name
> in that exact future request.

---

## Table of Contents

1. [Product Vision & Positioning](#1-product-vision--positioning)
2. [Competitive Context](#2-competitive-context)
3. [Headline Architecture Decisions](#3-headline-architecture-decisions)
4. [Locked Tech Stack](#4-locked-tech-stack)
5. [Monorepo Structure](#5-monorepo-structure)
6. [Service Architecture](#6-service-architecture)
7. [Data Architecture](#7-data-architecture)
8. [Agent Architecture](#8-agent-architecture)
9. [Blaxel Sandbox Strategy](#9-blaxel-sandbox-strategy)
10. [Frontend Architecture](#10-frontend-architecture)
11. [Feature → Architecture Mapping](#11-feature--architecture-mapping)
12. [Skills System](#12-skills-system)
13. [Observability](#13-observability)
14. [Security](#14-security)
15. [CI/CD](#15-cicd)
16. [Cost Projection](#16-cost-projection)
17. [8-Week Implementation Plan](#17-8-week-implementation-plan)
18. [Setup & Run Commands](#18-setup--run-commands)
19. [Known Risks](#19-known-risks)
20. [Legacy Cleanup](#20-legacy-cleanup)
21. [Code Quality, Strict Mode & Lint Policy](#21-code-quality-strict-mode--lint-policy)
22. [Repo Documentation Files](#22-repo-documentation-files)
23. [API Contracts](#23-api-contracts)
24. [Durable Object Specifications](#24-durable-object-specifications)
25. [Tool Registry & Streaming Events](#25-tool-registry--streaming-events)
26. [Error Taxonomy](#26-error-taxonomy)
27. [Local Development Environment](#27-local-development-environment)
28. [Pricing Tiers & Entitlements](#28-pricing-tiers--entitlements)
29. [Onboarding & Lifecycle Hooks](#29-onboarding--lifecycle-hooks)
30. [Performance Budgets & Telemetry](#30-performance-budgets--telemetry)

---

## 1. Product Vision & Positioning

**Product:** Cheatcode is a generalist AI agent platform that builds apps, generates documents (slides, PDFs, spreadsheets), runs research (deep + wide), and automates browsers. It's accessed via a web app — no native mobile or desktop apps in V1.

**Positioning one-liner:** "AI agents that build, research, and ship — your keys, your models, your sandbox."

**Wedges vs competitors:**

- **Mobile-first web app builder** — responsive app surfaces inside the same sandbox preview, with desktop/mobile UI review and no native app-store scope.
- **Transparent multi-agent progress** — live VM view + per-agent task lanes + reasoning traces. HappyCapy users complain they can't see what subagents are doing; we make it the headline feature.
- **BYOK across paid providers** — LLMs, search, parsing, and automation APIs. Zero inference markup. Users pay providers directly.
- **Curated in-product skills catalog** — 9 hand-curated skills at launch, Anthropic SKILL.md format, bundled at build time. External registry publishing is outside V2.
- **Free-tier-friendly stack** — Cloudflare hosts both the web app and Workers; Blaxel gives up to $200 starter credits.

**Target user:** Indie hackers, founders, product folks, technical-adjacent operators who want an AI that delivers finished work (decks, reports, deployed apps) — not another chatbot.

---

## 2. Competitive Context

| Competitor | Their wedge | Our differentiation |
|---|---|---|
| **Manus** (Meta-acquired Dec 2025, $2B) | Async generalist agent with live VM view + Wide Research + public run views. CodeAct (Python action mechanism). | Mobile-first web app builder; BYOK keeps cost zero to us; clearer pricing |
| **Zo Computer** | Persistent personal cloud computer + Skills + multi-channel inbound (SMS/iMessage/email/Telegram). | Web app focus; deeper app-builder mode; mobile preview wedge |
| **HappyCapy** ($10M+ raised, $1M ARR in 20 days) | GUI workstation + 300K skill marketplace + Anthropic Skills format + Capy Mail. | Multi-agent transparency; mobile-first web apps; smaller, curated skill set with quality |
| **Lovable** | Deep Supabase integration for fullstack apps. | We do mobile-first web apps + slides + research + media, not just fullstack |
| **v0** | Vercel ecosystem + UI generation. | We do more than UI gen; we own the agent runtime and deploy the product on Cloudflare |
| **Bolt.new** | WebContainers (browser-native Node.js). | We build mobile-first web app surfaces in a remote sandbox that supports full runtime dependencies |

**Not our competition** — different lane (developer SWE-agent tools, not generalist agents for non-devs): Replit Agent, Devin, Cursor, Claude Code. We don't position against them and don't benchmark feature parity with them.

---

## 3. Headline Architecture Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Backend language | **TypeScript** | Single language across stack; Vercel AI SDK + Mastra ecosystem |
| Backend runtime | **Cloudflare Workers + DOs + Workflows** | Edge gateway, durable run state, R2/Hyperdrive integration |
| Agent framework | **Mastra 1.35** on **Vercel AI SDK v6.0.182** | Mastra = agent/workflow orchestration + tools; AI SDK = streaming + tool loop. Mastra Memory is not used in V2. |
| Sandbox | **Blaxel Sandboxes via `@blaxel/core` 0.2.84** | Hosted persistent VM sandboxes with sub-25ms standby resume, process/file APIs, previews, volumes, and $200 starter credits |
| Browser automation | **Stagehand v3.2 LOCAL mode** in the Blaxel sandbox image | Free; uses sandbox CPU we already pay for; full Stagehand v3 features |
| Frontend | **Next.js 16.2.6 + React 19.2.6 + Tailwind 4.3 + shadcn CLI 4.6 + AI Elements + Streamdown** on Cloudflare Workers via `@opennextjs/cloudflare` 1.19.11 | Single Cloudflare deployment surface; OpenNext supports App Router, RSC, SSR, Server Actions, Middleware, ISR, and response streaming |
| Database | **Supabase Postgres + Hyperdrive + Vault** | Free tier 500MB DB / 50k MAUs; Hyperdrive eliminates Worker cold connection |
| ORM | **Drizzle 0.45.2** | Edge-native, ~50KB; native Hyperdrive support |
| Auth | **Clerk 7.3.4** | Free tier 10k MAUs; mature Workers support |
| Billing | **Polar 0.46.4** | No fixed cost; rev-share only |
| Repo | **pnpm 10 + Turborepo 2.5** | Standard for TS monorepos; CI can use GitHub cache without a Vercel account |
| Lint/format | **Biome 2.4** | 10-30× faster than ESLint+Prettier; single config |
| Product QA | **Direct `agent-browser --auto-connect --session cheatcode-debug` UI operation + console/network/app-log review** | No scripted product-test harnesses, generated QA drivers, prompt runners, or wrapper scripts. Validation happens only by operating the real UI and checking console/network/app logs; Stagehand is only inside the sandbox product runtime |
| Workflows | **Cloudflare Workflows** | Single vendor; no Inngest |
| Secrets | **Cloudflare Secrets Store (app) + Supabase Vault (BYOK)** | Native to each tier; Vault TCE for per-user keys |
| Observability | **Cloudflare Workers Logs + Workers Tracing + Workers Analytics Engine** | Fully Cloudflare-native. No Sentry, no Langfuse, no third-party APM. 3-day Workers Logs retention is the V1 limit. |
| CI/CD | **GitHub Actions + cloudflare/wrangler-action@v3 + OpenNext Cloudflare CLI** | Every deployable surface ships to Cloudflare; no Vercel hosting dependency |
| Skills format | **Anthropic SKILL.md** (YAML frontmatter + body + references/assets only) | Open portable format. V2 intentionally has no bundled skill scripts, local skill eval fixtures, public registry export, or external skills.sh publishing flow. |

---

## 4. Locked Tech Stack

### 4.1 Locked stack — the pnpm catalog (single source of version truth)

Every dependency is pinned **exactly once**, in `pnpm-workspace.yaml`'s `catalog:`. Each `apps/*` and `packages/*` `package.json` references a dependency as `"<pkg>": "catalog:"` — never a literal version, never a range, never `latest`. Bumping a version = editing this one file. This block is the **complete** dependency set for the monorepo; nothing is pinned anywhere else, and §10.2 / §6's stack tables are derived views of it.

```yaml
# pnpm-workspace.yaml
packages:
  - apps/*
  - packages/*

catalog:
  # ── AI SDK + agent framework ──
  ai: 6.0.182
  '@ai-sdk/anthropic': 2.0.50
  '@ai-sdk/google': 3.0.80
  '@ai-sdk/openai': 2.0.101
  # 3.0.184 is the matching React package for ai@6.0.182.
  '@ai-sdk/react': 3.0.184
  '@openrouter/ai-sdk-provider': 2.9.0
  '@mastra/core': 1.35.0
  # ── Frontend ──
  next: 16.2.6
  react: 19.2.6
  react-dom: 19.2.6
  tailwindcss: 4.3.0
  '@tailwindcss/postcss': 4.3.0
  tw-animate-css: 1.4.0
  tailwind-scrollbar: 4.0.2
  tailwind-scrollbar-hide: 4.0.0
  ai-elements: 1.9.0
  streamdown: 2.5.0
  remend: 1.3.0
  '@streamdown/code': 1.1.1          # plugins are on independent semver tracks —
  '@streamdown/math': 1.0.2          # they do NOT follow streamdown's 2.5.0
  '@streamdown/mermaid': 1.0.2
  katex: 0.16.47
  '@tanstack/react-query': 5.100.11
  '@tanstack/react-virtual': 3.13.24
  zustand: 5.0.13
  nuqs: 2.8.9
  react-hook-form: 7.76.0
  '@hookform/resolvers': 5.2.2
  next-themes: 0.4.6
  next-intl: 4.12.0
  cmdk: 1.1.1                          # ⌘K command palette engine (apps/web, §10.6)
  '@opennextjs/cloudflare': 1.19.11
  web-vitals: 5.2.0
  sonner: 2.0.7
  geist: 1.7.0
  lucide-react: 1.16.0
  # ── Backend / Workers ──
  hono: 4.11.7
  '@hono/zod-openapi': 0.18.4
  '@blaxel/core': 0.2.84
  '@browserbasehq/stagehand': 3.2.0
  '@vercel/og': 0.11.1
  # ── Auth / billing / integrations ──
  '@clerk/backend': 3.4.9
  '@clerk/nextjs': 7.3.4
  '@polar-sh/sdk': 0.46.4
  '@composio/core': 0.10.0
  # ── Data ──
  drizzle-orm: 0.45.2
  pg: 8.21.0                                  # Required by Hyperdrive + Drizzle node-postgres setup (§7.3); omitted in the original catalog.
  '@types/pg': 8.20.0
  '@supabase/ssr': 0.10.3
  '@supabase/supabase-js': 2.106.0
  '@t3-oss/env-nextjs': 0.13.11
  zod: 3.25.76
  # ── Tools: docs / data / research ──
  pptxgenjs: 3.12.0
  docx: 9.5.1
  exceljs: 4.4.0
  '@react-pdf/renderer': 4.3.1
  recharts: 3.2.1
  arquero: 8.0.3
  exa-js: 2.13.0
  '@mendable/firecrawl-js': 1.29.0
  # ── Dev / build / checks ──
  typescript: 5.9.3
  '@biomejs/biome': 2.4.14
  turbo: 2.5.8
  wrangler: 4.93.0
  supabase: 2.100.1                            # Local CLI/runtime management; hosted project version is verified before migration (§7.2).
  '@cloudflare/workers-types': 4.20260520.1
  '@types/node': 22.19.19                    # Required by apps/web tsconfig ("types": ["node"]); omitted in original catalog.
  '@types/react': 19.2.15
  '@types/react-dom': 19.2.3
  drizzle-kit: 0.31.10
  shadcn: 4.6.0
  tsx: 4.22.3                                  # runs scripts/migrate.ts + build scripts
  lefthook: 2.1.8
  '@commitlint/cli': 21.0.1
  '@commitlint/config-conventional': 21.0.1
  knip: 6.14.1
  madge: 8.0.0
  eslint-config-next: 16.2.6
  '@next/bundle-analyzer': 16.2.6
```

The root `package.json` carries only the package-manager pin, workspace scripts, operational
helpers, and repo-wide tooling (every entry `catalog:`) — no app dependencies of
its own. Operational scripts are not product tests, are not acceptance evidence,
and must never drive UI/user flows. Never use a package script, a file in
`scripts/`, or an out-of-tree helper as product QA. Product QA is raw
`agent-browser --auto-connect --session cheatcode-debug` commands plus manual
console/network/app-log review only. The "no scripts for testing" rule is
literal: any script, package command, generated file, or throwaway helper whose
purpose is to validate product behavior by submitting prompts, clicking through
screens, driving auth, checking accessibility, running load, opening browsers,
or collecting acceptance evidence must be deleted in the same change that finds
it. Operational scripts exist only for build, database migration, local
orchestration, secret sync, Docker cleanup, and explicit production guardrails.

User override from May 27, 2026: do not use scripts for product testing at all.
Do not create or run checked-in, temporary, or out-of-tree QA scripts. The only
product test workflow is to operate the real UI directly with `agent-browser`,
clicking/filling/typing through the app, then checking browser console, network
behavior, and app logs.

May 28, 2026 hardening: this rule is intentionally literal. Product QA must not
be wrapped in `pnpm`, `tsx`, shell loops, `/tmp` files, browser drivers,
generated helpers, package aliases, or chained flow runners. Every product
verification step is a visible direct UI action (`agent-browser open`,
`snapshot -i`, `click`, `fill`, `type`, screenshots) plus direct
console/network/app-log inspection. Static typecheck/lint/build commands may
still run as code-health gates, but they are not product testing and cannot
replace the final UI/log pass.

May 28, 2026 direct override: "never use scripts" means never use scripts for
product testing, including temporary helpers. Do not add a hidden Node, TS,
Python, shell, Playwright, Cypress, Selenium, Stagehand, curl, or
`agent-browser` wrapper to make QA faster. Delete any such file or package
entry immediately when discovered. Active V2 source contains no product-test
scripts; the remaining `scripts/` files are operational only and must not be
used as acceptance evidence.

May 28, 2026 latest user directive: code the V2 implementation first, across
all planned weeks, and reserve product acceptance for the final direct UI/log
pass. Do not write, run, or keep scripts to "test faster" while building. If a
script exists to validate product behavior, submit prompts, click UI, drive
auth, wrap `agent-browser`, run curl flows, collect load/accessibility evidence,
or perform E2E acceptance, delete it immediately. Only direct
`agent-browser --auto-connect --session cheatcode-debug` interaction and
direct console/network/app-log inspection may prove product behavior.

May 28, 2026 direct testing override: never use scripts for product testing.
Testing the product means using the actual UI, clicking and typing through the
screens with direct `agent-browser` commands, and checking browser
console/network output plus local Worker/Next/Blaxel logs. Delete any product
testing script, wrapper, prompt runner, shell loop, curl flow, generated
browser driver, package alias, or temporary helper on sight. Do not keep it
around for convenience, do not run it once before deletion, and do not recreate
it outside the repo. Operational scripts may remain only when they start
services, build artifacts, sync secrets, run migrations, or perform guarded
deploy/admin operations; they are never product tests and must not contain UI
flow assertions.

May 28, 2026 latest user instruction: "don't use scripts for testing" is a hard
delivery rule. V2 product verification must be done by opening the running app,
clicking, filling, typing, navigating, taking screenshots, checking browser
console/network state, and reading service logs directly. Do not write or run a
script to submit prompts, drive the UI, replay flows, gather screenshots, parse
network output, or make acceptance faster. If such a script exists in V2,
delete it immediately without executing it. Code-health and operations commands
such as lint, typecheck, build, migrations, secret sync, Docker orchestration,
and deploy guardrails may remain only because they do not simulate or validate
user-facing product behavior.

May 27, 2026 delete audit: the V2 source tree intentionally has no product-test
scripts to keep. If a future file, package command, workflow step, or temporary
helper exists to test product behavior, submit prompts, automate auth/browser
flows, collect accessibility/load evidence, or wrap `agent-browser`, delete it
instead of running it. Do not rename it, move it to `/tmp`, keep it as a private
helper, or replace it with a shell loop. The preserved `cheatcode/` V1 tree may
contain legacy tests or QA assets; those are ignored reference material for V2
and must not be run, copied into V2, or deleted unless the user explicitly asks
to delete V1 code by name.

```json
{
  "name": "cheatcode",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@10.33.2",
  "scripts": {
    "audit:archive": "tsx scripts/archive-audit-log.ts",
    "build": "turbo build",
    "db:generate": "turbo db:generate",
    "deploy:workers": "tsx scripts/deploy-phased.ts",
    "dev": "tsx scripts/dev.ts",
    "docker:clean": "tsx scripts/clean-docker.ts",
    "docker:dev:build": "docker compose -f docker-compose.dev.yml build",
    "docker:dev:down": "docker compose -f docker-compose.dev.yml down --remove-orphans",
    "docker:dev:up": "docker compose -f docker-compose.dev.yml up -d --build",
    "docker:prod:build": "docker compose -f docker-compose.prod.yml build",
    "docker:prod:down": "docker compose -f docker-compose.prod.yml down --remove-orphans",
    "docker:prod:up": "docker compose -f docker-compose.prod.yml up -d --build",
    "lint": "biome check . && turbo lint",
    "prod:set-hyperdrive": "tsx scripts/set-hyperdrive-id.ts",
    "skills:build": "turbo skills:build",
    "sync:blaxel-local-token": "tsx scripts/sync-blaxel-local-token.ts",
    "sync:secrets": "tsx scripts/sync-secrets.ts",
    "sync:worker-secrets": "tsx scripts/sync-worker-secrets.ts",
    "typecheck": "turbo typecheck && pnpm typecheck:scripts",
    "typecheck:scripts": "tsc -p tsconfig.scripts.json --noEmit"
  },
  "devDependencies": {
    "@biomejs/biome": "catalog:",
    "@commitlint/cli": "catalog:",
    "@commitlint/config-conventional": "catalog:",
    "@types/node": "catalog:",
    "knip": "catalog:",
    "lefthook": "catalog:",
    "madge": "catalog:",
    "supabase": "catalog:",
    "tsx": "catalog:",
    "turbo": "catalog:",
    "typescript": "catalog:",
    "wrangler": "catalog:"
  }
}
```

App-scoped dev/check tools (`wrangler`, `drizzle-kit`, `eslint-config-next`, `@next/bundle-analyzer`) are `devDependencies` of the specific `apps/*`/`packages/*` that need them — again all `catalog:`. V2 has no source-level Vitest specs, no checked-in Playwright/Cypress/Selenium tests, and no smoke, load, prompt, accessibility, E2E, or browser-testing package scripts. All product validation is direct `agent-browser` UI operation plus console/network/app-log review after the all-weeks code surface is implemented. The `scripts/` directory is forbidden for product testing: it may contain only operational helpers for build, migration, local orchestration, secrets, Docker cleanup, deploy orchestration, and audit/archive work. If a V2 file or package script appears whose purpose is product validation, prompt submission, browser driving, auth-flow driving, load checks, accessibility checks, or acceptance testing, delete the file or script entry instead of running it. Do not replace a deleted testing script with a renamed command, package alias, local `/tmp` file, or manual shell loop. This delete rule applies regardless of the filename: `qa`, `smoke`, `test`, `e2e`, `flow`, `acceptance`, `a11y`, `load`, `demo`, `walkthrough`, `replay`, or `validate` commands are forbidden when they exercise product behavior or collect acceptance evidence. The standalone V2 `validate:*` command surface has been deleted to avoid confusing operational guardrails with testing; safety checks that must remain live inside the operation that needs them, such as `scripts/migrate.ts` refusing a wrong Supabase target before applying DDL.
Starting or stopping the local stack is operational setup, not product testing;
the evidence trail starts only once the real UI is operated directly through
visible `agent-browser` commands and logs are inspected by hand.

### 4.2 Default model picks (all BYOK)

| Capability | Default | Premium | Cheap |
|---|---|---|---|
| Code generation | `claude-sonnet-4-6` | `claude-opus-4-8` | `gpt-5.4-mini` |
| Reasoning | `claude-sonnet-4-6` w/ thinking | `gpt-5.4-thinking` | `claude-haiku-4-5-20251001` |
| Vision | `claude-sonnet-4-6` | `gpt-5.4` | `gemini-2.5-flash` |
| Media generation | Deferred out of V1 | — | — |
| Web search | Exa | — | — |
| Scraping | Firecrawl | Stagehand + LOCAL Chromium | — |
| Future PDF parse | LlamaParse key validation only in V1 | LandingAI ADE | — |

AgentRun defaults to the code-generation primary (`claude-sonnet-4-6`) when no model is
selected. If that request-scoped Anthropic BYOK call fails with a provider-side
billing/quota/opaque stream error and the user has an OpenAI BYOK key in Vault,
AgentRun retries the same request with `gpt-5.4-mini` (interactive consent, §23.5 /
§8.6 model-fallback). Explicit user model choices are never silently overridden.

**Centralized model catalog — the single source of truth is `packages/types/src/models.ts`**
(`AGENT_MODEL_CATALOG`, 4 entries: `anthropic/claude-sonnet-4-6`,
`anthropic/claude-opus-4-8`, `openai/gpt-5.4-thinking`, `openai/gpt-5.4-mini`). The
client `AGENT_MODEL_OPTIONS` is re-derived from it as the **design-5 picker** — **Auto**
(client-only pseudo-entry), Claude Sonnet 4.6, Claude Opus 4.8, GPT-5.4 Thinking, GPT-5.4
Mini — with the stable public option shape `{ id, label, requestValue, description }`.
**Gemini 2.5 Flash and the standalone OpenRouter-Auto row are pruned from the *displayed*
catalog** (the Bud design's Models list omits them); they remain reachable only as
explicit free-string `body.model` ids. The **backend resolver still accepts any
free-string model id**, so the *usable* universe stays "all OpenRouter-supported models."

**Model resolution chain (per-surface, disable-aware).** A run's model id resolves
`explicit body.model → project default (settings.defaultModel) → user per-surface default →
plan-defined production default`, keyed by `surfaceOf(projectMode)` (App builder =
`app-builder`/`app-builder-mobile`, General agent = `general`). Disabled models (the user's
`disabled_models` set) are **skipped** at each fall-through step; an explicit pick of a
disabled model returns `validation_model_unavailable` (400), and the model-fallback offer is
suppressed when `openai/gpt-5.4-mini` is disabled. The per-surface user **Agent-defaults
matrix** (App builder / General agent, each with a model + budget) is the user-level layer.

**OpenRouter is the catch-all transport (no new vendor).** OpenRouter is already a
first-class BYOK provider (`ProviderSchema`, the `openrouter` validator, the generic key
store, and the settings key row all exist). For a resolved model id the transport rule is:
prefer the user's **direct provider key** (Sonnet/Opus → Anthropic, GPT-5.4* → OpenAI); else
if they hold an **OpenRouter** key, route via OpenRouter (reaching any OpenRouter-supported
model, incl. `openrouter/auto`, which is what "Auto" uses under the hood); else
`byok_key_missing`. Both a single OpenRouter key and per-provider keys are supported
simultaneously. Google Gemini stays reachable as an explicit `google/<id>` pick.

**No hard-coded model pricing (decision 2026-06-13).** User billing is **sandbox-hours**
(§28), never token spend. Run-cost USD — used only for budget-cap / daily-cost-cap
enforcement and cost telemetry — is resolved **(1)** from the gateway's reported cost
(OpenRouter returns actual USD per generation, captured in `usageFromMastraChunk` →
`event.usd`), falling back to **(2)** a cached, keyless OpenRouter `/models` price map
(edge-cached 24h + in-isolate memo). There is **no `MODEL_PRICING` hard-coded table and no
Opus 4.8 price placeholder**; `/models` is public, so this introduces no new vendor.

- Research log (2026-05-27): Exa over official Anthropic API pricing docs
  confirms Claude Sonnet 4.6 is `$3 / MTok` input and `$15 / MTok` output, and
  official OpenAI API pricing docs confirm GPT-5.4 is `$2.50 / MTok` input and
  `$15 / MTok` output while GPT-5.4 mini is `$0.75 / MTok` input and
  `$4.50 / MTok` output. Implementation implication: AgentRun estimates BYOK
  token spend for budget-cap enforcement and usage telemetry only; Cheatcode
  still charges no LLM markup and never stores provider keys outside Vault.
- Research log (2026-05-27): Exa over official Anthropic model docs confirms
  `claude-sonnet-4-6` is Active and the Models API can validate/resolve model
  ids. Exa over official OpenAI model docs confirms `gpt-5.4`,
  `gpt-5.4-mini`, and `gpt-5.4-thinking` are documented API model ids, with
  Responses API support for streaming/function calling. Context7 `/vercel/ai`
  confirms AI SDK v6 `useChat({ messages })`, request-time `sendMessage(...,
  { body })`, `DefaultChatTransport.prepareSendMessagesRequest`, and
  `prepareReconnectToStreamRequest` match the V2 transport implementation.
  Implementation implication: the locked default/fallback model ids and AI SDK
  transport code remain valid; no Section 4 version change is required.
- Research log (2026-05-28): Context7 `/vercel/ai` confirms
  `@ai-sdk/google` and `createGoogle(...)` / `google("gemini-2.5-flash")`
  usage; Context7 `/browserbase/stagehand` confirms Stagehand v3 can run
  `google/gemini-2.5-flash` with `GOOGLE_GENERATIVE_AI_API_KEY`; Firecrawl
  scrape of the official Gemini pricing page confirms paid-tier
  `gemini-2.5-flash` pricing at `$0.30 / MTok` input and `$2.50 / MTok`
  output. Implementation implication: Google BYOK is wired into the agent
  model router, browser-tool credential flow, budget estimates, and UI model
  selector.
- Research log (2026-05-27): Context7 `/openrouterteam/ai-sdk-provider` plus
  local package types for `@openrouter/ai-sdk-provider@2.9.0` confirm
  `createOpenRouter({ apiKey, appName, appUrl, compatibility }).chat(modelId)`.
  Implementation implication: AgentRun resolves OpenRouter keys from Vault and
  injects them into Mastra request context exactly like Anthropic/OpenAI BYOK.
- Research log (2026-05-27): Context7 `/composiohq/composio/v0.10.0` and
  local pinned `@composio/core@0.8.1` types confirm `composio.tools.get(userId,
  { toolkits })` and `composio.tools.execute(slug, { userId,
  connectedAccountId, arguments, version? })`. Local 0.8.1 docs also confirm
  manual execution should use a concrete toolkit `version` unless explicitly
  opting into latest-version execution. Implementation implication:
  `composio_execute` defaults to exact-version execution, exposes
  `allowLatestVersion` as an explicit escape hatch, and never reads OAuth state
  outside `v2_user_integrations`.
- Research log (2026-05-27): Context7 `/polarsource/polar-js` and local
  `@polar-sh/sdk@0.46.4` types confirm
  `customerSessions.create({ externalCustomerId })`, checkout creation with
  `products: string[]` of product IDs, and webhook event types including
  `customer.state_changed`,
  `subscription.*`, `order.paid`, `order.refunded`, and `refund.created`.
  Current webhook payload docs show subscription/customer payloads carry
  `externalCustomerId`/`customer.externalId` plus nested `product.metadata`.
  Implementation implication: gateway accepts `productId`, creates
  checkout/portal sessions with the internal user UUID as the external customer
  id, and webhooks infer tiers from product metadata before product name/id
  fallbacks.
- Research log (2026-05-27): Context7 `/polarsource/polar-js` and local
  `@polar-sh/sdk@0.46.4` types confirm end-of-period cancellation and
  reactivation use `subscriptions.update({ id, subscriptionUpdate:
  { cancelAtPeriodEnd: true|false } })`; `customerCancellationReason` and
  `customerCancellationComment` are accepted only on the cancellation shape.
  `subscriptions.revoke({ id })` is immediate cancellation and is not the
  default user-facing flow. Implementation implication: gateway exposes
  `/v1/billing/cancel` and `/v1/billing/reactivate`, stores
  `cancel_at_period_end` on `v2_entitlements`, and leaves revoked/new-checkout
  behavior to Polar webhooks and checkout.
- Research log (2026-05-27): Context7 `/polarsource/polar-js` and local
  `@polar-sh/sdk@0.46.4` types confirm customer profile updates use
  `customers.update({ id, customerUpdate: { email, name } })`. Implementation
  implication: Clerk `user.updated` stores the latest primary email/name/avatar
  on `v2_users`; if the user already has `polar_customer_id`, the webhooks
  Worker updates the Polar customer email/name so receipts follow Clerk.
- Research log (2026-05-27): Context7 `/polarsource/polar-js` confirms
  immediate subscription cancellation uses `subscriptions.revoke({ id })` and
  refunds use `refunds.create({ orderId, reason, amount })`. Local
  `@polar-sh/sdk@0.46.4` types confirm `orders.list({ externalCustomerId,
  productBillingType: 'recurring', sorting: ['-created_at'] })`; the pinned
  type surface does not expose the newer documented `subscriptionId` list
  filter, so the DSR workflow filters returned recurring orders by
  `order.subscriptionId` before creating the prorated refund.
- Research log (2026-05-27): Context7 `/clerk/javascript` confirms the current
  Backend SDK uses `createClerkClient({ secretKey })` and
  `clerkClient.users.getUser(userId)` for server-side user reads; local
  `@clerk/backend`/shared types expose email-address `verification.status`.
  Implementation implication: gateway checks the current Clerk primary email
  verification state before forwarding sandbox-creating run requests to
  `agent-worker`; unverified users can authenticate but cannot spawn a sandbox
  run.
- Research log (2026-05-27): Context7 Blaxel docs plus Exa over official
  `docs.blaxel.ai` and `blaxel-ai/sdk-typescript` confirm `@blaxel/core`
  current sandbox APIs: `SandboxInstance.createIfNotExists({ name, image,
  memory, region, ports, labels })`, `SandboxInstance.delete(name)`,
  `sandbox.process.exec({ command, workingDir, waitForPorts,
  waitForCompletion, timeout, restartOnFailure, maxRestarts })`,
  `sandbox.process.wait/list/kill`, `sandbox.fs.read/write/writeBinary/ls/grep/rm`,
  and `sandbox.previews.createIfNotExists({ metadata: { name }, spec })` with
  private preview access through `bl_preview_token` or
  `X-Blaxel-Preview-Token`. Implementation implication: ProjectSandbox remains
  the single argv-to-shell serialization boundary, preview creation uses
  `createIfNotExists`, private takeover previews mint short-lived tokens, and
  long-running dev servers must set a keep-alive timeout intentionally rather
  than relying on process-completion behavior.
- Research log (2026-05-28): Context7 `/opennextjs/opennextjs-cloudflare` and
  Context7 `/websites/developers_cloudflare_workers` confirm OpenNext uses
  committed `wrangler.jsonc` bindings for Worker runtime configuration, while
  Cloudflare Workers expose text vars/secrets through `process.env` when
  `nodejs_compat` is active on current compatibility dates. Cloudflare also
  documents build-time variables and Worker runtime variables as separate
  surfaces. Implementation implication: production web deploys must pass
  `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and
  `NEXT_PUBLIC_POLAR_PRO_MONTHLY_PRODUCT_ID` into the OpenNext build, and
  `@cheatcode/env/web` uses static `process.env.NEXT_PUBLIC_*` property reads
  for public values so Next/OpenNext can inline them while Cloudflare runtime
  bindings remain a fallback.
- Product update (2026-06-27): Fal and ElevenLabs are removed from V1. Media
  generation and speech tools are deferred; the active BYOK surface is LLM,
  research/search, parsing, and automation provider keys.

Browser automation remains separate from the main LLM provider selection:
Stagehand LOCAL tools use Anthropic/OpenAI-compatible credentials in V1. If the
main agent run is explicitly routed through OpenRouter, browser tools do not
reuse the OpenRouter model id as a Stagehand model.

V2 does not require an embedding provider. Mastra Memory, `@mastra/memory`,
`@mastra/pg`, pgvector-backed semantic recall, and Google Gemini embeddings are
out of scope for this build. Durable run state lives in AgentRun Durable Objects,
thread/message history lives in V2-prefixed Postgres tables, and longer-term
personalization must be designed against those V2-owned tables before any
future embedding feature is added.

### 4.3 Locked services

- **Frontend hosting:** Cloudflare Workers via OpenNext (`cheatcode-web`)
- **Backend:** Cloudflare Workers + Durable Objects + Workflows
- **Sandboxes:** Blaxel hosted Sandboxes (usage-based; up to $200 starter credits)
- **Database:** Supabase (Free → Pro $25/month at scale)
- **Cache/state:** Durable Objects (no separate Redis)
- **Object storage:** R2 (zero egress)
- **Auth:** Clerk (Free 10k MAUs → Pro $25/month)
- **Billing:** Polar (no fixed cost)
- **Weather (greeting):** **Open-Meteo** — keyless, gateway-only `fetch` (no SDK, no key),
  Cache-API cached (15 min TTL). Powers the time/weather greeting (§10.6, weather **ON
  everywhere**; `weather: null` is the runtime fallback only). Non-commercial licensing
  posture accepted by the product owner.
- **CI:** GitHub Actions (free for public; 2000 min/mo for private)

---

## 5. Monorepo Structure

### 5.1 Folder tree

```
cheatcode/
├── apps/
│   ├── web/                          Next.js 16, Clerk, Polar, AI Elements + Streamdown + useChat
│   ├── gateway-worker/               Public Hono router, Clerk JWT, rate limit, service bindings
│   ├── agent-worker/                 Agent loop + AgentRun DO + ProjectSandbox DO + Blaxel adapter
│   └── webhooks-worker/              Clerk, Polar, Composio webhooks + internal ops workflows
├── packages/
│   ├── agent-core/                   Mastra instance, ToolLoopAgent wrapper, workflows
│   │   └── src/mastra/{agents,tools,workflows,scorers}/
│   ├── tools-code/                   Sandbox shell/file/git/runCode tools
│   ├── tools-browser/                Stagehand v3 LOCAL wrappers + noVNC takeover
│   ├── tools-docs/                   pptxgenjs, docx, exceljs, react-pdf
│   ├── tools-data/                   Arquero, CSV parsing, charts (Recharts SSR in sandbox)
│   ├── tools-research/               Exa + Firecrawl
│   ├── db/                           Drizzle schema (per-domain files), queries, migrations
│   │   ├── src/schema/               users.ts, projects.ts, messages.ts, keys.ts, outputs.ts, usage.ts, audit.ts, index.ts
│   │   ├── src/client.ts             createDb() + withUserContext() helpers
│   │   └── drizzle/                  Generated migrations
│   ├── env/                          t3-env per app
│   ├── types/                        Zod schemas + InferAgentUIMessage exports
│   ├── api-client/                   Hono hc<typeof gateway> typed client
│   ├── auth/                         Clerk verifyToken helpers
│   ├── billing/                      Polar SDK wrappers + entitlement checks
│   ├── observability/                Structured logger + Workers Analytics emitters + error handler + tracing
│   ├── byok/                         Provider key encryption + Vault RPC wrappers
│   ├── skills/                       Build-time skill bundler + runtime loader
│   │   ├── src/index.ts              SKILLS export + buildSystemPromptSection() + getSkillByName()
│   │   ├── src/types.ts              BundledSkill type
│   │   └── src/generated.ts          AUTO — produced by scripts/build-skills.ts
│   ├── ui/                           shared V1-parity UI primitives, icon barrel, AI Elements adapters
│   ├── tsconfig/                     base.json / nextjs.json / worker.json / library.json
│   └── biome-config/                 Shared biome.jsonc
├── skills/                           9 curated in-product skills (Anthropic SKILL.md format)
│   ├── pitch-deck/
│   │   ├── SKILL.md                  YAML frontmatter + markdown body (≤500 lines)
│   │   ├── references/               One-level-deep deeper docs (loaded on demand)
│   │   └── assets/                   Templates, schemas, fonts
│   ├── deep-research/
│   ├── deep-research-fanout/ (merged into deep-research skill)
│   ├── competitor-brief/
│   ├── slide-from-prd/
│   ├── csv-analyst/
│   ├── social-post-pack/
│   ├── landing-page/
│   └── mobile-app/
├── infra/
│   ├── supabase/migrations/          DB migrations (extensions, schemas, roles, RLS, Vault RPCs, partitions)
│   │   ├── pre/0001_extensions.sql
│   │   ├── pre/0002_uuidv7_compat.sql
│   │   ├── pre/0003_audit_log_partitioned.sql
│   │   ├── post/0010_indexes.sql
│   │   ├── post/0011_triggers.sql
│   │   ├── post/0012_rls.sql
│   │   └── post/0013_byok.sql
│   └── containers/sandbox/Dockerfile Blaxel sandbox image
├── scripts/                          Build-time helpers
│   ├── build-skills.ts               Bundles skills/* → packages/skills/src/generated.ts
│   ├── sync-secrets.ts               Push .env to Cloudflare Secrets Store
│   ├── sync-worker-secrets.ts        Push SDK-required standard Worker secrets
│   ├── set-hyperdrive-id.ts          Stamp the prod Hyperdrive id into Worker configs
│   └── deploy-phased.ts              Cross-worker deploy with DO migration safety
├── .github/workflows/                CI pipelines
├── biome.jsonc
├── turbo.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── README.md
└── package.json
```

### 5.2 `pnpm-workspace.yaml`

```yaml
packages:
  - apps/*
  - packages/*
```

### 5.3 `turbo.json`

```json
{
  "$schema": "https://turbo.build/schema.json",
  "remoteCache": { "enabled": true, "signature": true },
  "tasks": {
    "skills:build": {
      "cache": false,
      "inputs": ["skills/**", "scripts/build-skills.ts"],
      "outputs": ["packages/skills/src/generated.ts"]
    },
    "build": {
      "dependsOn": ["^build", "skills:build"],
      "outputs": ["dist/**", ".next/**", ".wrangler/**", ".open-next/**"]
    },
    "dev": { "cache": false, "persistent": true, "dependsOn": ["skills:build"] },
    "lint": { "dependsOn": ["^build"] },
    "typecheck": { "dependsOn": ["^build", "skills:build"] },
    "deploy": {
      "dependsOn": ["build", "typecheck", "lint"],
      "cache": false
    },
    "db:generate": { "cache": false }
  }
}
```

### 5.4 Type sharing

- **Drizzle** generates row types: `import { InferSelectModel } from 'drizzle-orm'`
- **Zod schemas** in `packages/types` for every API + tool I/O
- **AI SDK** `InferAgentUIMessage<typeof generalAgent>` from `apps/agent-worker`, used in `apps/web` for `useChat<CheatcodeMessage>`
- **Hono** `hc<typeof app>` typed REST client from `apps/gateway-worker`
  - Research log (2026-05-25): Context7 `/websites/hono_dev` RPC docs for Hono
    4.11.x confirm exporting the chained route/app type and passing `fetch` +
    `headers` into `hc<AppType>(baseUrl, options)`. Implementation implication:
    `apps/gateway-worker` exports `gatewayRoutes` as the chained Hono route
    value, and `packages/api-client/gateway` builds `hc<GatewayAppType>` from
    that type instead of the untyped mutated base app. Confirms this plan.
- No tRPC

---

## 6. Service Architecture

### 6.1 High-level diagram

```
                    ┌──────────────────────────────────────┐
                    │ Next.js 16 (Cloudflare/OpenNext)      │
                    │  - Clerk auth                        │
                    │  - Polar billing UI                  │
                    │  - useChat<CheatcodeMessage>         │
                    │  - AI Elements + Streamdown          │
                    │  - shadcn / Tailwind 4               │
                    └──────────┬───────────────────────────┘
                               │ HTTPS
                               ▼
                    ┌──────────────────────────────────────┐
                    │ gateway-worker (Hono)                │
                    │  - Clerk JWT verify                  │
                    │  - Rate limit (DO-backed)            │
                    │  - Route → other Workers via SB      │
                    │  - CORS + security headers           │
                    └──────────┬───────────────────────────┘
                               │ Service Bindings (RPC, zero hop)
                ┌──────────────┐
                ▼              ▼
        ┌─────────────┐ ┌─────────────┐
        │agent-worker │ │webhooks-    │
        │             │ │worker       │
        │ + AgentRun  │ │             │
        │   DO        │ │             │
        │ + Project   │ │             │
        │   Sandbox   │ │             │
        │   DO        │ │             │
        └──────┬──────┘ └─────────────┘
               │
               │ HTTPS Blaxel SDK/API
               ▼
        ┌──────────────────────────────────────┐
        │ Per-project Blaxel sandbox           │
        │  - Node 22, Python 3.13, Chromium    │
        │  - User project files                │
        │  - Dev server (5173/8080 exposed)    │
        │  - Stagehand + Playwright            │
        │  - pptxgenjs, docx, exceljs, ...     │
        │  - x11vnc + websockify (takeover)    │
        └──────────────────────────────────────┘

External: Supabase (via Hyperdrive), R2 buckets, Exa, Firecrawl, Clerk,
          Polar, Composio
```

### 6.2 Worker responsibilities

#### `apps/gateway-worker`
Thin public entrypoint.
- Hono router
- Clerk JWT verification (`@clerk/backend`)
- Rate limiting via Durable Object (per-user-per-route token bucket)
- Service Bindings to all other Workers
- CORS + security headers (`hono/secure-headers`)
- No business logic

#### `apps/agent-worker`
Owns the agent loop.
- `AgentRun` Durable Object (per agent run state, streaming buffer, resumability)
- `ProjectSandbox` Durable Object (per project, wraps Blaxel sandbox lifecycle + APIs)
- Mastra instance from `packages/agent-core`
- Tool dispatch
- Streaming SSE responses back through gateway → frontend `useChat`

#### `apps/webhooks-worker`
Isolated to absorb webhook storms.
- Clerk webhooks (user created/updated/deleted)
- Polar webhooks (subscription events)
- Composio webhooks (OAuth callbacks)
- Each public provider handler verifies the raw signature, dedupes by provider
  event id through `WebhookIdempotencyStore`, and enqueues `WebhookWorkflow`
  before returning `200 OK`
- Internal `OpsMaintenanceWorkflow` jobs run non-user-facing maintenance such as
  daily `v2_usage_daily_totals` rollups. These are operational workflows, not
  scheduled agents.

### 6.3 Durable Objects

Six DO classes:

```ts
// apps/agent-worker/src/durable-objects/agent-run.ts
export class AgentRun extends DurableObject {
  // SQLite-backed, holds:
  //   - run status (see §24.2 state machine)
  //   - message_part: append-only, seq-numbered UIMessage parts (resumable SSE buffer)
  //   - budget: { tokens_in, tokens_out, cost_usd }
  //   - in-memory SSE subscribers (ReadableStream controllers — NO WebSocket)
  async start(args: { message, threadId, userId, projectId }): Promise<RunSnapshot>
  async pause(reason: string): Promise<void>
  async resume(): Promise<void>
  async resumeStream(lastSeq: number): Promise<ReadableStream>  // SSE replay + live tail
  async fetch(req: Request): Promise<Response>                  // serves GET .../stream as SSE
}

// apps/agent-worker/src/durable-objects/project-sandbox.ts
export class ProjectSandbox extends DurableObject {
  // Wraps one named Blaxel sandbox per project.
  // Blaxel standby snapshots preserve process + filesystem state between runs.
  // Exposes: exec, runCode, readFile, writeFile, exposePort, terminal, createBackup, restoreBackup
}

// apps/gateway-worker/src/durable-objects/rate-limiter.ts
export class RateLimiter extends DurableObject {
  // Token bucket per (user_id, route)
  async check(userId: string, route: string, limit: number, window: number): Promise<boolean>
}

// apps/gateway-worker/src/durable-objects/idempotency.ts
export class IdempotencyStore extends DurableObject {
  // Per (user_id, idempotency_key) request-body hash + cached response metadata.
  // Streaming run creates are deduped here; stream bytes replay through AgentRun.
  async begin(args: { key: string, bodyHash: string, ttlMs: number }): Promise<IdempotencyDecision>
  async complete(args: { key: string, status: number, headers: [string, string][], body: string | null }): Promise<void>
}

// apps/webhooks-worker/src/webhook-idempotency.ts
export class WebhookIdempotencyStore extends DurableObject {
  // Per (provider, event_id) raw-body hash with 7-day TTL.
  // Different body for the same event id is rejected; duplicate deliveries return 200.
  async begin(args: { provider: string, eventId: string, bodyHash: string }): Promise<IdempotencyDecision>
  async complete(args: { provider: string, eventId: string, workflowId: string }): Promise<void>
  async release(args: { provider: string, eventId: string, bodyHash: string }): Promise<void>
}
```

### 6.4 Service Bindings

```jsonc
// apps/gateway-worker/wrangler.jsonc (excerpt)
{
  "name": "cheatcode-gateway",
  "main": "src/index.ts",
  "compatibility_date": "2026-05-01",
  "compatibility_flags": ["nodejs_compat"],
  "routes": [
    { "pattern": "gateway.trycheatcode.com/*", "zone_name": "trycheatcode.com" }
  ],
  "services": [
    { "binding": "AGENT", "service": "cheatcode-agent" },
    { "binding": "WEBHOOKS", "service": "cheatcode-webhooks" }
  ],
  "durable_objects": {
    "bindings": [
      { "name": "RATE_LIMITER", "class_name": "RateLimiter" }
    ]
  },
  "secrets_store_secrets": [
    { "binding": "CLERK_SECRET", "secret_name": "clerk-secret-key", "store_id": "..." }
  ]
}
```

Service Bindings are RPC with no network hop — both Workers run in the same isolate process when colocated.

**Custom domain routing per Worker:**

| Worker | Route pattern | Purpose |
|---|---|---|
| `cheatcode-gateway` | `gateway.trycheatcode.com/*` | Public API entry |
| `cheatcode-agent` | internal Service Binding only | Agent API stays Service-Binding-internal. Blaxel preview URLs are issued by Blaxel and optionally mapped to verified custom domains (§9.5). |
| `cheatcode-webhooks` | `webhooks.trycheatcode.com/*` | Server-to-server webhooks (Polar / Clerk / Composio) |

**Sandbox preview URLs are Blaxel resources.** `ProjectSandbox.exposePort()` creates or reuses a Blaxel preview for a sandbox port. Public user app previews can use Blaxel's `*.preview.bl.run` URL directly; private previews require either a `bl_preview_token` query param or `X-Blaxel-Preview-Token` header. For branded production previews, register `trycheatcode.com` as a Blaxel custom domain and create previews with `customDomain` / `prefixUrl`.

```ts
import { SandboxInstance } from '@blaxel/core';

const sandbox = await SandboxInstance.get(projectSandboxName);
const preview = await sandbox.previews.createIfNotExists({
  metadata: { name: 'app-preview' },
  spec: { port: 5173, public: false },
});
const token = await preview.tokens.create(new Date(Date.now() + 10 * 60 * 1000));
return `${preview.spec.url}?bl_preview_token=${token.value}`;
```

---

## 7. Data Architecture

> This section is a **V2 redesign** of Cheatcode's Supabase data layer that coexists with the existing Cheatcode database. **Existing V1 tables are preserved in place and are not reset, renamed, or deleted.** Every V2-owned public table uses a `v2_` prefix (`v2_users`, `v2_projects`, `v2_provider_keys`, etc.) so the V2 app can share the same Supabase project without touching legacy rows. Every choice below is opinionated and informed by current (May 2026) Supabase + Drizzle + Cloudflare best practices.

### 7.1 Design principles

Eight rules that govern every table choice below:

1. **Code-level tenancy, selective RLS.** Cloudflare Workers are the trust boundary. Every Drizzle query includes an explicit `where userId = <internal users.id UUID>` via a typed wrapper. RLS is enabled only on `v2_provider_keys` and `v2_audit_log` for defense-in-depth on security-critical tables; everywhere else, code enforces tenancy. (Skipping RLS on hot paths because Supabase benchmarks show 9–170 ms overhead per query, and we never expose PostgREST — Workers query Postgres through Hyperdrive.)
2. **UUID v7 primary keys.** Time-ordered, B-tree-friendly, no page splits. Defaults call `public.uuidv7()`, which is provided by a compatibility function on the existing Supabase PG17 project and can later delegate to native Postgres UUID v7 support after an upgrade. Random v4 (`gen_random_uuid()`) reserved only for opaque security tokens where we don't want creation time to leak.
3. **Denormalize `user_id` onto every tenant-scoped table.** Composite index `(user_id, created_at desc)` is the workhorse. Never rely on multi-hop FK joins for authorization checks.
4. **JSONB for variable-shape payloads, columns for queryable scalars.** `parts`, `tool_io`, `metadata`, `config` → JSONB. `role`, `model`, `cost_usd`, `status` → typed columns. Promote anything you sort, filter, or aggregate on. GIN-index only JSONB you actually query by containment.
5. **No library-managed memory schema.** Mastra Memory is not part of V2, so there is no `mastra` schema, no `@mastra/memory` or `@mastra/pg` dependency, no Mastra memory runtime configuration, no `@mastra/pg` tables, and no pgvector extension. Persistent app state is owned by V2-prefixed public tables.
6. **R2 for bytes, Postgres for metadata.** No Supabase Storage. `generated_outputs` indexes R2 keys with size, mime, sha256.
7. **Vault for BYOK via indirection table + `SECURITY DEFINER` RPC.** RPCs derive the user from `app.user_id` (never a parameter). Decrypt on demand inside the request transaction — no cross-request key cache. Rotate by insert-new-row + soft-delete-old.
8. **Two-tier usage tracking + monthly-partitioned audit log.** Raw `v2_usage_events` (hot, append-only) + nightly `v2_usage_daily_totals` (warm, dashboard-queried). `v2_audit_log` is partitioned by `range (created_at)` monthly, archived to R2 as gzipped NDJSON after 90 days.

### 7.2 Postgres setup

**Version:** the existing hosted Cheatcode Supabase project is Postgres 17.4. V2 shares that project to preserve V1 tables and uses a pre-Drizzle compatibility `uuidv7()` function in `infra/supabase/migrations/pre/0002_uuidv7_compat.sql` plus `0004_uuidv7_extensions_schema.sql`. Drizzle defaults call `public.uuidv7()` explicitly so logical restores and security-definer code never depend on `search_path`; the helper is granted only to `app_worker` because table defaults execute in the inserting role. If the project is later upgraded to a Postgres version with native `uuidv7()`, the V2 table defaults do not change.

**Extensions:**

```sql
-- infra/supabase/migrations/pre/0001_extensions.sql
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;       -- crypto primitives
create extension if not exists pg_trgm with schema extensions;        -- optional skill search
create extension if not exists supabase_vault with schema extensions; -- BYOK secret storage
create extension if not exists moddatetime with schema extensions;    -- updated_at helper
```

**Schemas:**

```sql
create schema if not exists extensions; -- Supabase extension namespace
-- public — all Cheatcode app tables
-- vault  — Supabase Vault internals (managed by Supabase)
-- extensions — enabled Postgres extensions
```

**Postgres roles:**

```sql
-- The role Workers connect as via Hyperdrive
create role app_worker login password 'app_worker' nobypassrls; -- local bootstrap; rotate/set prod URL via Cloudflare Secrets Store
grant usage on schema public, extensions to app_worker;

-- NO blanket function grant. app_worker executes ONLY the BYOK RPCs, granted by
-- explicit signature in post/0013_byok.sql (§7.8). Trigger functions (moddatetime,
-- audit_provider_key_change) fire under the table owner — app_worker needs no
-- direct execute. Harden the default so functions created later are not
-- world-executable, and strip the implicit PUBLIC execute Postgres grants:
alter default privileges in schema public revoke execute on functions from public;
```

`app_worker` is granted `public` table privileges only in `infra/supabase/migrations/post/0014_v2_grants.sql`, after Drizzle has created the V2-prefixed tables. That migration first revokes broad `public` table access, then grants access to `v2_*` app tables and `v2_audit_log` only. Existing V1 public tables stay inaccessible to V2 Workers.

**Never use `service_role` from Workers.** It bypasses RLS and is over-privileged. `app_worker` is scoped to what the app needs and respects the selective RLS policies on `v2_provider_keys` and `v2_audit_log`.

### 7.3 Connection setup from Workers

Cloudflare Workers connect to Supabase via **Hyperdrive** using the `pg` driver (node-postgres). Cloudflare's official Drizzle + Hyperdrive guide recommends `pg` over `postgres.js` for Workers — better connection lifecycle in the Workers isolate model.

```ts
// packages/db/src/client.ts
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export function createDb(env: Env) {
  const pool = new Pool({
    connectionString: env.HYPERDRIVE.connectionString,
    max: 5,
  });
  return {
    db: drizzle(pool, { schema }),
    close: () => pool.end(),
  };
}

export type Database = ReturnType<typeof createDb>['db'];

// Per-request helper. `internalUserId` is the canonical users.id UUID
// (resolved from the Clerk JWT once, in gateway auth middleware — never the Clerk ID).
// Sets app.user_id so RLS policies + BYOK RPCs resolve the user.
export async function withUserContext<T>(
  db: Database,
  internalUserId: string,            // users.id UUID — NOT the Clerk ID
  fn: (tx: Database) => Promise<T>
): Promise<T> {
  return db.transaction(async (tx) => {
    // set_config local=true → scoped to this transaction only
    await tx.execute(sql`select set_config('app.user_id', ${internalUserId}, true)`);
    return fn(tx as Database);
  });
}
```

In a Worker handler:

```ts
export default {
  async fetch(req, env, ctx) {
    const { db, close } = createDb(env);
    try {
      // verifyClerk returns the Clerk subject; resolveInternalUserId looks up
      // users.id by clerk_id (cached in KV, 5-min TTL — id mapping is not secret).
      const clerkSub = await verifyClerk(req);
      const userId = await resolveInternalUserId(db, clerkSub);   // users.id UUID
      const projects = await withUserContext(db, userId, async (tx) => {
        return tx.query.projects.findMany({
          where: (p, { eq, isNull, and }) => and(eq(p.userId, userId), isNull(p.deletedAt)),
        });
      });
      return Response.json(projects);
    } finally {
      ctx.waitUntil(close());
    }
  },
};
```

`resolveInternalUserId` is the single Clerk-ID → internal-UUID boundary. Everything past it — queries, RLS, BYOK RPCs, `runtimeContext.userId` — uses the internal UUID exclusively.

**Required:** `nodejs_compat` compatibility flag in every `wrangler.jsonc` that uses the DB.

### 7.4 Drizzle schema (organized by domain)

Per-domain files under `packages/db/src/schema/`, single barrel `index.ts`:

```
packages/db/src/schema/
├── index.ts         // re-exports all
├── users.ts         // v2_users
├── profiles.ts      // v2_user_profiles
├── billing.ts       // v2_entitlements, v2_billing_events (§28.6)
├── projects.ts      // v2_projects, v2_threads
├── messages.ts      // v2_messages, v2_agent_runs
├── keys.ts          // v2_provider_keys, v2_user_integrations
├── outputs.ts       // v2_generated_outputs
├── usage.ts         // v2_usage_events, v2_usage_daily_totals
└── audit.ts         // v2_audit_log
```

**`profiles.ts` → `v2_user_profiles`** (user-foundation): `user_id` PK FK→`v2_users`
`ON DELETE CASCADE`; `agent_display_name`, `global_memory` (≤8 KB), `appbuilder_default_model`,
`general_default_model`, `appbuilder_default_budget_usd`, `general_default_budget_usd`,
`disabled_models` (jsonb), `onboarding_completed_at`, `onboarding_state` (jsonb). Backs
`GET/PATCH /v1/me/profile` and the system-prompt merge (§8.2). Every column is
optional/nullable so partial onboarding landings are safe.

All `pgTable()` names below are V2-prefixed in shipped code. The unprefixed TypeScript export names (`users`, `projects`, `providerKeys`) are only local ORM aliases; the physical tables are `v2_*`.

#### `users.ts`

```ts
import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const users = pgTable('v2_users', {
  id: uuid('id').primaryKey().default(sql`public.uuidv7()`),
  clerkId: text('clerk_id').notNull().unique(),
  email: text('email').notNull(),
  displayName: text('display_name'),
  avatarUrl: text('avatar_url'),
  polarCustomerId: text('polar_customer_id').unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
```

#### `projects.ts`

```ts
import { pgTable, text, timestamp, uuid, jsonb } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users';

export interface ProjectSettings {
  defaultModel?: string;
  budgetCapUsd?: number;
  importRepoUrl?: string;   // GitHub import (composer Add menu) — public repos only, §8/§23.2
}

export const projects = pgTable('v2_projects', {
  id: uuid('id').primaryKey().default(sql`public.uuidv7()`),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  mode: text('mode').notNull(), // 'app-builder' | 'app-builder-mobile' | 'general'
  masterInstructions: text('master_instructions'),
  // Sandbox state
  sandboxId: text('sandbox_id'),                       // Blaxel sandbox name
  containerBackup: jsonb('container_backup').$type<DirectoryBackup | null>(),  // deprecated V2 compatibility column; Blaxel state lives in sandbox standby/volumes
  // Settings
  settings: jsonb('settings').$type<ProjectSettings>().notNull().default(sql`'{}'::jsonb`),
  // Downgrade lifecycle
  overQuota: boolean('over_quota').notNull().default(false),
  archivedPendingAction: boolean('archived_pending_action').notNull().default(false),
  archiveAfter: timestamp('archive_after', { withTimezone: true }),
  // Lifecycle
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }), // soft delete
});

export const threads = pgTable('v2_threads', {
  id: uuid('id').primaryKey().default(sql`public.uuidv7()`),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }), // denormalized for tenancy
  title: text('title'),
  // Points at the in-flight run, if any. Set when a run starts, cleared on finalize.
  // GET /v1/threads/{id}/runs/stream returns 204 when null. The client calls
  // resumeStream() only while an in-memory run is actively streaming (§23.5).
  // Plain uuid, NO FK: a FK to agent_runs would force a circular
  // import (projects.ts ↔ messages.ts). The agent-worker is the single writer.
  activeRunId: uuid('active_run_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});
```

#### `messages.ts`

```ts
import { pgTable, text, timestamp, uuid, jsonb, integer, numeric } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { UIMessagePart } from '@cheatcode/types';
import { users } from './users';
import { threads } from './projects';

export interface AgentRunConfig {
  agentName: string;
  workflowName?: string;
  budgetCapUsd?: number;
  stepCap?: number;
  source: 'web' | 'api';  // V1 trigger sources — no inbound email/sms/slack/background recurrence (see future.md)
}

export interface AgentRunError {
  type: string;
  message: string;
  stepNumber?: number;
}

export const messages = pgTable('v2_messages', {
  id: uuid('id').primaryKey().default(sql`public.uuidv7()`),
  threadId: uuid('thread_id').notNull().references(() => threads.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }), // denormalized
  role: text('role').notNull(), // 'user' | 'assistant' | 'tool' | 'system'
  parts: jsonb('parts').$type<UIMessagePart[]>().notNull(),
  agentRunId: uuid('agent_run_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const agentRuns = pgTable('v2_agent_runs', {
  id: uuid('id').primaryKey().default(sql`public.uuidv7()`),
  threadId: uuid('thread_id').notNull().references(() => threads.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  status: text('status').notNull(), // RunStatus, canonical set is the §24.2 AgentRun DO state machine: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'canceled'
  modelId: text('model_id'),
  tokensIn: integer('tokens_in').notNull().default(0),
  tokensOut: integer('tokens_out').notNull().default(0),
  tokensCached: integer('tokens_cached').notNull().default(0),
  costUsd: numeric('cost_usd', { precision: 12, scale: 6 }).notNull().default('0'),
  config: jsonb('config').$type<AgentRunConfig>().notNull().default(sql`'{}'::jsonb`),
  error: jsonb('error').$type<AgentRunError | null>(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
});
```

#### `keys.ts`

```ts
import { pgTable, text, timestamp, uuid, primaryKey } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users';

// BYOK provider keys — indirection to vault.secrets (selective RLS)
export const providerKeys = pgTable('v2_provider_keys', {
  id: uuid('id').primaryKey().default(sql`public.uuidv7()`),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  vaultSecretId: uuid('vault_secret_id').notNull(),  // references vault.secrets(id)
  fingerprint: text('fingerprint').notNull(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  disabledAt: timestamp('disabled_at', { withTimezone: true }), // tier overage: key is retained but not usable
  disabledReason: text('disabled_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }), // soft delete on rotate
});

// Composio OAuth connections per user
export const userIntegrations = pgTable('v2_user_integrations', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  integration: text('integration').notNull(),      // 'gmail' | 'slack' | 'notion' | 'linear' | 'github' | ...
  composioConnectionId: text('composio_connection_id').notNull(),
  status: text('status').notNull(),                // 'connected' | 'expired' | 'revoked'
  connectedAt: timestamp('connected_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.userId, t.integration] }),
}));
```

#### `outputs.ts`

```ts
import { pgTable, text, timestamp, uuid, bigint, jsonb } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users';
import { projects } from './projects';
import { agentRuns } from './messages';

// Index over generated artifacts in R2 — never store bytes here
export const generatedOutputs = pgTable('v2_generated_outputs', {
  id: uuid('id').primaryKey().default(sql`public.uuidv7()`),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  agentRunId: uuid('agent_run_id').references(() => agentRuns.id, { onDelete: 'set null' }),
  kind: text('kind').notNull(), // 'slide' | 'pdf' | 'docx' | 'xlsx' | 'image' | 'video' | 'audio'
  filename: text('filename').notNull(),
  r2Bucket: text('r2_bucket').notNull().default('cheatcode-outputs'),
  r2Key: text('r2_key').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
  sha256: text('sha256'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }), // mirrors R2 lifecycle
});
```

#### `usage.ts`

```ts
import { pgTable, text, timestamp, uuid, integer, numeric, date, bigint, primaryKey } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users';

// Raw usage events — high-volume, append-only
export const usageEvents = pgTable('v2_usage_events', {
  id: uuid('id').primaryKey().default(sql`public.uuidv7()`),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  agentRunId: uuid('agent_run_id'),
  eventType: text('event_type').notNull(),   // 'llm.completion' | 'tool.call' | 'media.generation'
  provider: text('provider'),                // 'anthropic' | 'openai' | 'deepseek' | ...
  model: text('model'),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  cachedTokens: integer('cached_tokens').notNull().default(0),
  costUsd: numeric('cost_usd', { precision: 12, scale: 6 }).notNull().default('0'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Pre-aggregated daily totals — populated nightly by Workflows
export const usageDailyTotals = pgTable('v2_usage_daily_totals', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  day: date('day').notNull(),
  totalInputTokens: bigint('total_input_tokens', { mode: 'number' }).notNull().default(0),
  totalOutputTokens: bigint('total_output_tokens', { mode: 'number' }).notNull().default(0),
  totalCachedTokens: bigint('total_cached_tokens', { mode: 'number' }).notNull().default(0),
  totalCostUsd: numeric('total_cost_usd', { precision: 12, scale: 4 }).notNull().default('0'),
  agentRunCount: integer('agent_run_count').notNull().default(0),
}, (t) => ({
  pk: primaryKey({ columns: [t.userId, t.day] }),
}));
```

#### `audit.ts`

```ts
import { pgTable, text, timestamp, uuid, jsonb, inet, primaryKey } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// PARTITIONED BY range (created_at) — monthly partitions created by raw SQL.
// Drizzle cannot author PARTITION BY, so the real table is created ONLY by raw SQL
// in infra/supabase/migrations/pre/0003_audit_log_partitioned.sql. This pgTable
// definition exists purely for query type-safety and is EXCLUDED from drizzle-kit
// generate by pointing drizzle.config.ts at `src/schema/drizzle.ts`, a generation
// barrel that intentionally does not export auditLog — otherwise Drizzle would emit
// a conflicting non-partitioned CREATE TABLE for it.
export const auditLog = pgTable('v2_audit_log', {
  id: uuid('id').notNull().default(sql`public.uuidv7()`),
  userId: uuid('user_id'),                   // null for system events
  action: text('action').notNull(),          // 'provider_key.read' | 'output.download.sign' | ...
  resourceType: text('resource_type'),
  resourceId: text('resource_id'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  ipAddress: inet('ip_address'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.id, t.createdAt] }), // composite for partitioning
}));
```

#### `index.ts` (barrel)

```ts
export * from './users';
export * from './projects';
export * from './messages';
export * from './keys';
export * from './outputs';
export * from './usage';
export * from './audit';
```

### 7.5 Indexes

```sql
-- infra/supabase/migrations/post/0010_indexes.sql  (Phase 3 — runs after drizzle-kit migrate; §7.10)

-- Tenancy hot paths (composite indexes are the workhorse)
create index on projects (user_id, created_at desc) where deleted_at is null;
create index on threads (user_id, project_id, created_at desc) where deleted_at is null;
create index on threads (project_id, created_at desc) where deleted_at is null;
create index on messages (user_id, thread_id, created_at desc);
create index on messages (thread_id, created_at);
create index on agent_runs (user_id, started_at desc);
create index on agent_runs (thread_id, started_at desc);

-- Active runs hot index (partial — small, lookups fast).
-- Status values match the §24.2 AgentRun DO state machine.
create index on agent_runs (user_id, started_at)
  where status in ('pending', 'running', 'paused');

-- Generated outputs
create index on v2_generated_outputs (user_id, created_at desc);
create index on v2_generated_outputs (agent_run_id);
create index on v2_generated_outputs (project_id, created_at desc);

-- Usage events: hot queries by user; BRIN for time-range scans on huge tables
create index on v2_usage_events (user_id, created_at desc);
create index on v2_usage_events using brin (created_at);

-- Provider keys (selective RLS table)
create unique index on v2_provider_keys (user_id, provider) where deleted_at is null;

-- User integrations
create index on v2_user_integrations (composio_connection_id);

-- Audit log
create index on v2_audit_log (user_id, created_at desc);
create index on v2_audit_log (action, created_at desc);
create index on v2_audit_log using brin (created_at);

-- JSONB containment (only where we actually query by it)
create index on v2_agent_runs using gin (config jsonb_path_ops);
```

### 7.6 Triggers + functions

```sql
-- infra/supabase/migrations/post/0011_triggers.sql  (Phase 3 — §7.10)

-- updated_at via moddatetime extension (cheap, standard)
create trigger trg_v2_users_updated before update on v2_users
  for each row execute function extensions.moddatetime(updated_at);
create trigger trg_v2_projects_updated before update on v2_projects
  for each row execute function extensions.moddatetime(updated_at);
create trigger trg_v2_threads_updated before update on v2_threads
  for each row execute function extensions.moddatetime(updated_at);
create trigger trg_v2_user_integrations_updated before update on v2_user_integrations
  for each row execute function extensions.moddatetime(updated_at);
create trigger trg_v2_entitlements_updated before update on v2_entitlements
  for each row execute function extensions.moddatetime(updated_at);

-- Defense-in-depth: auto-insert audit log on provider_key mutations
create or replace function v2_audit_provider_key_change() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into public.v2_audit_log (user_id, action, resource_type, resource_id, metadata)
  values (
    coalesce(NEW.user_id, OLD.user_id),
    case TG_OP
      when 'INSERT' then 'provider_key.create'
      when 'UPDATE' then 'provider_key.update'
      when 'DELETE' then 'provider_key.delete'
    end,
    'provider_key',
    coalesce(NEW.provider, OLD.provider),
    jsonb_build_object('fingerprint', coalesce(NEW.fingerprint, OLD.fingerprint))
  );
  return coalesce(NEW, OLD);
end
$$;

create trigger trg_v2_audit_provider_keys
  after insert or update or delete on v2_provider_keys
  for each row execute function v2_audit_provider_key_change();
```

### 7.7 RLS strategy (selective)

```sql
-- infra/supabase/migrations/post/0012_rls.sql  (Phase 3 — §7.10)

-- Enable RLS on security-critical tables ONLY
alter table v2_provider_keys enable row level security;
alter table v2_audit_log enable row level security;

-- Worker connection sets `app.user_id` via withUserContext() per transaction
-- Policies read it via current_setting()

create policy v2_provider_keys_select_own on v2_provider_keys
  for select using (user_id::text = (select current_setting('app.user_id', true)));
create policy v2_provider_keys_insert_own on v2_provider_keys
  for insert with check (user_id::text = (select current_setting('app.user_id', true)));
create policy v2_provider_keys_update_own on v2_provider_keys
  for update using (user_id::text = (select current_setting('app.user_id', true)));
create policy v2_provider_keys_delete_own on v2_provider_keys
  for delete using (user_id::text = (select current_setting('app.user_id', true)));

create policy v2_audit_log_select_own on v2_audit_log
  for select using (user_id::text = (select current_setting('app.user_id', true)));
create policy v2_audit_log_insert_system on v2_audit_log
  for insert with check (true);  -- triggers + worker code insert; reads are restricted
```

**All other tables: NO RLS.** Code-level tenancy enforced via Drizzle wrappers that always include `where userId = <internal users.id UUID>`. Workers are the trust boundary; PostgREST is never exposed.

### 7.8 BYOK via Vault

Vault stores the actual key bytes encrypted at rest. The `v2_provider_keys` table is an indirection table holding the pointer + metadata. Rotation and deletion keep the metadata rows for audit/fingerprint history, but explicitly delete stale Vault secret rows so user key material does not survive a rotate, provider disconnect, or DSR hard delete.

**Security model — the RPC derives the user, never trusts a parameter.** Earlier drafts passed `p_user_id` into the `SECURITY DEFINER` functions, which meant any caller (or any code bug) could decrypt another user's key by passing a different UUID. The functions now read the user from the transaction-local `app.user_id` GUC — the same value `withUserContext()` (§7.3) sets after Clerk JWT verification. There is no way to ask for someone else's key because the caller never names a user. Every function also pins `search_path` and is granted only to `app_worker`.

```sql
-- infra/supabase/migrations/post/0013_byok.sql  (Phase 3 — §7.10)

-- Helper: the authenticated internal user UUID for this transaction.
-- Raises if app.user_id was never set (fail closed).
create or replace function current_app_user() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v uuid;
begin
  v := nullif(current_setting('app.user_id', true), '')::uuid;
  if v is null then
    raise exception 'app.user_id not set — refusing BYOK operation';
  end if;
  return v;
end $$;

create or replace function set_provider_key(p_provider text, p_key text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := public.current_app_user();
  v_secret_id uuid;
  v_fingerprint text;
  v_row_id uuid;
  v_old_secret_ids uuid[];
begin
  select coalesce(array_agg(vault_secret_id), '{}'::uuid[])
    into v_old_secret_ids
  from public.v2_provider_keys
  where user_id = v_user and provider = p_provider and deleted_at is null;

  -- Non-reversible fingerprint: a SHA-256 hex prefix. NEVER store key material.
  -- Supabase logical restores and SECURITY DEFINER functions use predictable
  -- search_path behavior, so extension functions are schema-qualified.
  v_fingerprint := substring(
    encode(extensions.digest(convert_to(p_key, 'UTF8'), 'sha256'), 'hex')
    for 12
  );
  update public.v2_provider_keys
    set deleted_at = now()
    where user_id = v_user and provider = p_provider and deleted_at is null;
  -- Use Supabase Vault's SECURITY DEFINER API instead of direct
  -- vault.secrets INSERT. Direct inserts can fail when the caller cannot execute
  -- Vault's internal encrypt/nonce functions.
  v_secret_id := vault.create_secret(
    p_key,
    v_user::text || ':' || p_provider || ':' || extract(epoch from now())::text,
    'Cheatcode V2 BYOK provider key'
  );
  insert into public.v2_provider_keys (user_id, provider, vault_secret_id, fingerprint)
    values (v_user, p_provider, v_secret_id, v_fingerprint)
    returning id into v_row_id;

  delete from vault.secrets where id = any(v_old_secret_ids);
  return v_row_id;
end $$;

create or replace function get_provider_key(p_provider text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := public.current_app_user();
  v_key text;
  v_row_id uuid;
begin
  select pk.id, ds.decrypted_secret
    into v_row_id, v_key
  from public.v2_provider_keys pk
  join vault.decrypted_secrets ds on ds.id = pk.vault_secret_id
  where pk.user_id = v_user
    and pk.provider = p_provider
    and pk.deleted_at is null
    and pk.disabled_at is null
  order by pk.created_at desc
  limit 1;
  if v_row_id is not null then
    update public.v2_provider_keys set last_used_at = now() where id = v_row_id;
  end if;
  return v_key;
end $$;

create or replace function delete_provider_key(p_provider text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := public.current_app_user();
  v_secret_ids uuid[];
begin
  select coalesce(array_agg(vault_secret_id), '{}'::uuid[])
    into v_secret_ids
  from public.v2_provider_keys
  where user_id = v_user and provider = p_provider;

  update public.v2_provider_keys
    set deleted_at = coalesce(deleted_at, now())
    where user_id = v_user and provider = p_provider;

  delete from vault.secrets where id = any(v_secret_ids);
end $$;

create or replace function delete_all_provider_keys()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := public.current_app_user();
  v_secret_ids uuid[];
  v_deleted_count integer;
begin
  select coalesce(array_agg(vault_secret_id), '{}'::uuid[]), count(*)::integer
    into v_secret_ids, v_deleted_count
  from public.v2_provider_keys
  where user_id = v_user;

  update public.v2_provider_keys
    set deleted_at = coalesce(deleted_at, now())
    where user_id = v_user;

  delete from vault.secrets where id = any(v_secret_ids);
  return v_deleted_count;
end $$;

-- Fully-qualified signatures — GRANT/REVOKE ON FUNCTION must identify each
-- function unambiguously by its argument types (a bare name is fragile).
revoke all on function
  public.current_app_user(),
  public.set_provider_key(text, text),
  public.get_provider_key(text),
  public.delete_provider_key(text),
  public.delete_all_provider_keys()
from public, app_worker;
grant execute on function
  public.set_provider_key(text, text),
  public.get_provider_key(text),
  public.delete_provider_key(text),
  public.delete_all_provider_keys()
to app_worker;
-- public.current_app_user() is internal-only — invoked by the SECURITY DEFINER
-- RPCs above, never granted to app_worker directly.
```

TS wrapper in `packages/byok/src/index.ts`. **No module-scope key cache** — that would be user-specific global state in a shared isolate (forbidden by §21.11) and a cross-tenant leak risk. Keys are decrypted per use, inside the request's `withUserContext` transaction. If a single agent step calls the same provider repeatedly, pass the resolved key down through `runtimeContext` (request-scoped, dies with the request) — never hoist it to module scope.

Periodic BYOK revalidation needs an all-user inventory pass while Workers still
connect only as `app_worker`. Because `v2_provider_keys` has RLS, the inventory
is a narrow SECURITY DEFINER RPC, `list_provider_key_revalidation_targets(limit)`,
that returns only `user_id`, `provider`, and non-secret fingerprint metadata for
active keys. `OpsMaintenanceWorkflow` then enters `withUserContext()` for each
target before calling `get_provider_key()`. If a provider returns an invalid-key
status during revalidation, the workflow updates that user's active metadata row
to `disabled_at = now()` and `disabled_reason = 'revalidation_invalid'`; it never
logs plaintext keys and does not delete Vault material unless the user rotates,
disconnects, or completes DSR deletion.

```ts
import { sql } from 'drizzle-orm';
import type { Database } from '@cheatcode/db';

export type Provider =
  | 'anthropic' | 'openai' | 'google' | 'openrouter'
  | 'deepseek' | 'exa' | 'firecrawl' | 'llamaparse';

// All calls run inside withUserContext(db, internalUserId, …) so the RPCs
// resolve the user from app.user_id. The caller never names a user.

export async function setProviderKey(
  tx: Database, provider: Provider, key: string
): Promise<void> {
  await tx.execute(sql`select set_provider_key(${provider}, ${key})`);
}

export async function getProviderKey(
  tx: Database, provider: Provider
): Promise<string | null> {
  const result = await tx.execute(sql`select get_provider_key(${provider}) as key`);
  return (result.rows[0] as { key: string | null })?.key ?? null;
}

export async function deleteProviderKey(
  tx: Database, provider: Provider
): Promise<void> {
  await tx.execute(sql`select delete_provider_key(${provider})`);
}

export async function listProviderKeys(
  tx: Database
): Promise<Array<{ provider: Provider; fingerprint: string; lastUsedAt: Date | null }>> {
  // RLS on v2_provider_keys (§7.7) scopes this to the current app.user_id automatically.
  const rows = await tx.query.providerKeys.findMany({
    where: (k, { isNull }) => isNull(k.deletedAt),
    columns: { provider: true, fingerprint: true, lastUsedAt: true },
  });
  return rows as Array<{ provider: Provider; fingerprint: string; lastUsedAt: Date | null }>;
}
```

Keys are decrypted on demand inside the request transaction, **never cached across requests**, never written to Redis/KV/DO state/logs. Within a single agent step, the resolved key travels via `runtimeContext` (request-scoped) and is GC'd when the request ends.

### 7.9 No Mastra Memory in V2

Mastra is used for agent/workflow orchestration only. V2 does **not** use
Mastra Memory, `@mastra/memory`, `@mastra/pg`, a `mastra` Postgres schema,
pgvector, embedding-backed semantic recall, or Agent-level `memory`
configuration. The pnpm lockfile and workspace manifests must not declare
`@mastra/memory` or `@mastra/pg`; stale local installs should be pruned rather
than treated as part of the runtime.

The durable state boundaries are:

- **Run-local stream state:** `AgentRun` Durable Object state and SQLite-backed
  message parts for resumable SSE.
- **Conversation history:** V2-owned Drizzle tables such as `v2_threads`,
  `v2_messages`, and `v2_agent_runs`.
- **Project context:** `v2_projects.master_instructions`, generated output
  metadata, R2 objects, and skill outputs.
- **BYOK provider access:** `v2_provider_keys` plus Supabase Vault RPCs from
  `packages/byok`.

Any future personalization, project memory, or semantic code search feature
must be designed as an explicit V2 data model first. It may not reintroduce
library-managed Mastra tables or pgvector by default without updating this plan.

### 7.10 Migration strategy

**Two migration sources, applied in three ordered phases.** Raw SQL and Drizzle both author DDL, and the order between them is load-bearing: indexes, triggers, RLS policies, and BYOK RPCs all reference ORM-managed tables, so they **must** run *after* `drizzle-kit migrate`. A single runner — `scripts/migrate.ts` — owns the ordering so CI and local never diverge.

1. **Raw SQL** (`infra/supabase/migrations/{pre,post}/*.sql`) — source of truth for: extensions, schemas, roles, grants, RLS policies, triggers, `SECURITY DEFINER` RPC functions, Vault setup, partitioned tables. Split into `pre/` (no dependency on ORM tables) and `post/` (depends on ORM tables existing).
2. **Drizzle migrations** (`packages/db/drizzle/*.sql`, generated by `drizzle-kit generate`) — source of truth for: V2 ORM tables, columns, Drizzle-owned indexes, FK constraints, check constraints. `v2_audit_log` is **excluded** by pointing `drizzle.config.ts` at `packages/db/src/schema/drizzle.ts`, a migration-generation barrel that intentionally omits the runtime `auditLog` export — it is a partitioned table only raw SQL can author.

**The three phases — this is the locked order, enforced by `scripts/migrate.ts`:**

```
Phase 1   infra/supabase/migrations/pre/*.sql        (lexical order)
            0001_extensions.sql            extensions, schemas, app_worker role + grants
            0002_uuidv7_compat.sql         local PG17 uuidv7() compatibility
            0003_audit_log_partitioned.sql partitioned v2_audit_log + native partitions
Phase 2   drizzle-kit migrate                         (packages/db/drizzle/*.sql)
            every ORM-managed V2 table (v2_users, v2_projects, v2_threads,
            v2_messages, v2_agent_runs, v2_provider_keys, …) — NOT v2_audit_log
Phase 3   infra/supabase/migrations/post/*.sql       (lexical order)
            0010_indexes.sql   indexes on ORM tables + v2_audit_log
            0011_triggers.sql  secure updated_at trigger function + provider-key audit triggers
            0012_rls.sql       RLS on v2_provider_keys + v2_audit_log
            0013_byok.sql      current_app_user() + BYOK SECURITY DEFINER RPCs
            0014_v2_grants.sql app_worker grants for V2-prefixed public tables only; idempotently ensures
                                  v2_audit_log exists for existing DBs whose raw pre ledger was already marked
            0015_v2_advisor_fixes.sql V2 FK indexes + RLS/function hardening
            0016_v2_vault_grants.sql Vault-backed BYOK RPC privilege hardening
            0017_v2_billing_triggers.sql entitlement updated_at trigger
            0018_v2_byok_vault_cleanup.sql purge stale Vault secrets on BYOK rotate/delete/DSR
```

`scripts/migrate.ts` connects with the Supabase admin/`postgres` role (DDL needs privileges `app_worker` deliberately lacks — **never** the Worker role), applies each phase in order, and records every raw SQL file it has run in a `_raw_migrations(filename text primary key, applied_at timestamptz)` ledger so re-runs are idempotent (Drizzle keeps its own `__drizzle_migrations` ledger). `scripts/migrate.ts --dry-run` prints the pending plan without executing — used by the PR diff job (§15.5).

Production migration target discipline is mandatory: the git-ignored `.env.migrate` must point at the same Supabase project/ref as the production Hyperdrive config before `scripts/migrate.ts --apply` is used for production. The checked-in `.env.migrate.example` is local-only. If a one-off production DDL repair is applied through Supabase MCP, immediately verify the table/function exists on the production project and manually exercise the deployed Worker route that depends on it.

**Never `drizzle-kit push` in production.** Always `generate` → review-the-SQL → commit → `migrate`.

**Expand/contract for column changes (the 2026 standard):**
1. Add new column nullable
2. Backfill in idempotent batches
3. Dual-write from app
4. Switch reads to new column
5. Drop old column in a separate release

**Audit log partition management via native Postgres range partitions** (Phase 1 — `pre/`, runs before Drizzle). The existing Supabase project does not offer `pg_partman` in `pg_available_extensions`, so V2 pre-creates monthly partitions directly in SQL. Privileged partition maintenance is **not** performed from a Cloudflare Worker, because Workers connect only as `app_worker` and must never hold DDL/export privileges. The checked-in admin script `scripts/archive-audit-log.ts` reads the git-ignored `SUPABASE_MIGRATION_URL`, creates future partitions before the pre-created window expires, exports old partitions as gzipped NDJSON to the locked `cheatcode-audit` R2 bucket, verifies the uploaded object byte-for-byte through Wrangler, and detaches the partition only after verification. Do not add a Parquet exporter without first adding a pinned Section 4 dependency or approved Postgres extension; the current zero-new-dependency archive format is `audit_log.ndjson.gz`. The Worker-side ops workflow may alert when the partition window is nearing expiry, but it must not run `DETACH`, use `service_role`, or export database contents.

```sql
-- infra/supabase/migrations/pre/0003_audit_log_partitioned.sql
create table if not exists v2_audit_log (
  id uuid not null default public.uuidv7(),
  user_id uuid,
  action text not null,
  resource_type text,
  resource_id text,
  metadata jsonb not null default '{}'::jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default now(),
  primary key (id, created_at)
) partition by range (created_at);

do $$
declare
  partition_start date;
  partition_end date;
  partition_name text;
begin
  for month_offset in -1..24 loop
    partition_start := (date_trunc('month', now())::date + (month_offset || ' months')::interval)::date;
    partition_end := (partition_start + interval '1 month')::date;
    partition_name := 'v2_audit_log_' || to_char(partition_start, 'YYYY_MM');

    execute format(
      'create table if not exists public.%I partition of public.v2_audit_log for values from (%L) to (%L)',
      partition_name,
      partition_start::timestamptz,
      partition_end::timestamptz
    );
  end loop;
end
$$;
```

Monthly audit archive maintenance runs from the admin/migration environment only:

```bash
pnpm audit:archive -- --dry-run
pnpm audit:archive -- --apply
```

It exports partitions older than 90 days to R2 (`cheatcode-audit` bucket) as `YYYY-MM/audit_log.ndjson.gz`, verifies the object, then `DETACH`es the archived partition. This stays outside Worker runtime for the same reason migrations do: it needs privileges `app_worker` deliberately lacks.

### 7.11 Anti-patterns we will NOT use

Explicit "don'ts" from research, for clarity in code reviews:

1. **No `service_role` from Workers.** Always `app_worker` with `NOBYPASSRLS`.
2. **No `pgsodium` direct usage.** Vault wraps it; Supabase is moving off it internally anyway.
3. **No `serial` / `bigserial` primary keys.** UUID v7 throughout.
4. **No files stored as `bytea` in Postgres.** R2 with metadata index in `generated_outputs`.
5. **No `select *` in RLS policies without supporting composite indexes.**
6. **No JSONB GIN-index on every JSONB column.** Only those queried by `@>` containment.
7. **No `drizzle-kit push` in production.** `generate` → review → `migrate`.
8. **No Supabase Realtime.** Durable Objects own all streaming. The preview console strip is the one read surface that intentionally uses **cursor-based polling**, not streaming (`GET /v1/threads/:id/sandbox/console`, §23.2 #50) — any future console SSE must live on the ProjectSandbox DO. The dev-server process carries the deterministic id **`app-preview`** (set by `executeStartDevServer` via `processId`, with a same-name kill-guard) so the console reader can target it; console log polls wake a standby sandbox (the read-only guard prevents creation, not wake), so the client backs polling off to 30 s when no dev server is reported.
9. **No multi-hop FK joins for tenancy checks.** `user_id` denormalized everywhere.
10. **No `LISTEN/NOTIFY` for agent event streaming.** Durable Objects + SSE only (§10.6).
11. **No Supabase Storage.** R2 for every byte.
12. **No TCE (Transparent Column Encryption).** Vault for secrets, R2 + signed URLs for files.

### 7.12 R2 buckets

| Bucket | Purpose | Lifecycle |
|---|---|---|
| `cheatcode-outputs` | Generated slides/PDFs/Excel/images/videos (indexed by `generated_outputs`) | 30 days, signed URLs |
| `cheatcode-snapshots` | Deprecated Cloudflare Sandbox backup bucket; retained only for legacy cleanup during migration | 30-day R2 lifecycle expiry |
| `cheatcode-audit` | Audit log gzipped NDJSON archives (after 90-day Postgres retention) | Bucket lock — indefinite |
| `cheatcode-uploads` | User uploads (CSVs, etc. for skill use only) | 7 days |

Generated-output downloads are Worker-signed gateway URLs
(`/v1/outputs/:outputId/download?expires&sig`) verified by `agent-worker` before
streaming from the private `R2_OUTPUTS` binding. Workers do not need long-lived
R2 S3 access keys for output downloads.

R2 key layout for safety and discoverability:

```
cheatcode-outputs/{userId}/{projectId}/{agentRunId}/{outputId}-{filename}
cheatcode-snapshots/…                          (legacy Cloudflare Sandbox backups only)
cheatcode-audit/{YYYY-MM}/audit_log.ndjson.gz
sandbox-exec/{YYYY-MM}/{YYYY-MM-DD}/{sandboxId}/{processName}-{uuid}.json
cheatcode-uploads/{userId}/{uploadId}-{filename}
```

The `userId` prefix in every key path is defense-in-depth even though access is gated by signed URLs.

---

## 8. Agent Architecture

### 8.1 Mastra instance setup

```ts
// packages/agent-core/src/mastra/index.ts
import { Mastra } from '@mastra/core';
import { generalAgent } from './agents/general';
import { deepResearch, wideResearch } from './workflows';

export const mastra = new Mastra({
  agents: { general: generalAgent },
  workflows: { deepResearch, wideResearch },
});
```

### 8.2 Agent definition (general agent)

```ts
// packages/agent-core/src/mastra/agents/general.ts
import { Agent } from '@mastra/core/agent';
import type { RequestContext } from '@mastra/core/request-context';
import { buildSystemPrompt } from '../system-prompt';
import { cheatcodeTools } from '../tools/tool-set';

export const generalAgent = new Agent({
  id: 'general',
  name: 'general',
  instructions: buildSystemPrompt(),
  // resolveGeneralModel(requestContext) selects Anthropic, OpenAI, or
  // OpenRouter from request-scoped BYOK keys. Keys are injected by AgentRun
  // after Vault lookup.
  model: ({ requestContext }: { requestContext: RequestContext }) =>
    resolveGeneralModel({ requestContext }),
  tools: cheatcodeTools,
});
```

The system prompt is built per-run with a fixed **merge order** (`buildSystemPrompt`):
1. Identity + agent display name (from `v2_user_profiles.agent_display_name`, ≤80 chars)
2. Tool guidance (capabilities, principles, style)
3. User Memory (`v2_user_profiles.global_memory`, ≤8 KB)
4. Project Instructions (`v2_projects.master_instructions` from DB)
5. Skill frontmatters (always include all curated skills — they fit in context)

Tools are auto-injected by AI SDK. The master prompt also carries the **`@<path>` →
`/workspace/<path>` resolution line**: composer `@` mentions resolve to absolute sandbox
paths under `/workspace/` so the agent reads the referenced file directly.

### 8.3 Tool definition pattern (one example)

```ts
// packages/tools-docs/src/slides.ts
import { tool } from 'ai';
import { z } from 'zod';

export const generateSlides = tool({
  description: 'Generate a PPTX deck from a structured outline. Returns a download URL.',
  inputSchema: z.object({
    title: z.string(),
    slides: z.array(z.object({
      heading: z.string(),
      bullets: z.array(z.string()).optional(),
      imagePrompt: z.string().optional(),
      layout: z.enum(['title', 'content', 'two-column', 'image-only']).optional(),
    })),
    theme: z.enum(['minimal', 'corporate', 'creative']).default('minimal'),
  }),
  execute: async ({ title, slides, theme }, { runtimeContext }) => {
    const pptxScript = buildPptxScript({ title, slides, theme });
    const result = await runtimeContext.sandbox.runCode({
      language: 'javascript',
      code: pptxScript,
    });
    const file = result.files.find(f => f.name.endsWith('.pptx'));
    if (!file) throw new Error('PPTX generation failed');
    const url = await uploadToR2(runtimeContext.env.R2_OUTPUTS, file.content, `${title}.pptx`);
    return { downloadUrl: url, slideCount: slides.length };
  },
});
```

### 8.4 Streaming pipeline

```
User input (apps/web/components/chat/chat-panel.tsx)
   │ POST {gateway}/v1/threads/{threadId}/runs  { message }   (DefaultChatTransport, SSE)
   ▼
gateway-worker
   │ 1. Verify Clerk JWT
   │ 2. Rate limit check (DO)
   │ 3. Forward via Service Binding → agent-worker.fetch()
   ▼
agent-worker
   │ 4. Resolve AgentRun DO by run ID
   │ 5. DO.start({ message, threadId, userId, projectId })
   │    a. Persist user message to Supabase
   │    b. Resolve user's BYOK provider keys via Vault
   │       - Anthropic default, OpenAI retry only for implicit provider-side failures
   │    c. mastra.getAgent('general').stream(...)
   │       - AI SDK streamText
   │       - Each step:
   │         - Generate next chunk(s)
   │         - If tool call → dispatch to sandbox/external/Mastra workflow
   │         - Append UIMessage part to DO SQLite (message_part, seq-numbered)
   │         - Fan out the part to every live SSE subscriber (in-memory loop)
   │    d. On completion: persist final message + run summary
   ▼
SSE stream → client (apps/web)
   │ useChat consumes typed UIMessage parts
   ▼
AI Elements components render:
   - <Response> (Streamdown for markdown)
   - <Reasoning> (Anthropic thinking traces)
   - <Tool> (tool call lifecycle)
   - <Plan> + <Task> (multi-agent workflow progress)
   - <Source> + <InlineCitation> (research mode)
   - <WebPreview> (sandbox preview URL)
```

Resumability: the UI uses `DefaultChatTransport` with `resume: false` on mount
to avoid AI SDK v6 duplicate 204 reconnect races, then calls `resumeStream()`
only during an active in-memory stream visibility recovery; the DO still owns
buffered replay for active reconnects.

### 8.5 Multi-agent workflows (Deep Research fan-out example)

```ts
// packages/agent-core/src/mastra/workflows/deep-research-fanout.ts
import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { mastra } from '../index';

const planQueries = createStep({
  id: 'plan-queries',
  inputSchema: z.object({ goal: z.string() }),
  outputSchema: z.object({ queries: z.array(z.string()) }),
  execute: async ({ inputData }) => {
    const result = await mastra.getAgent('planner').generate(
      `Decompose this goal into 10-25 parallel research queries:\n${inputData.goal}`,
      { output: z.object({ queries: z.array(z.string()).min(10).max(25) }) }
    );
    return result.object;
  },
});

// One shared shape — reused by the subagent's output and the reduce step's input.
const subagentFinding = z.object({
  findings: z.string(),
  sources: z.array(z.string()),
  costUsd: z.number(),
});

const runSubagent = createStep({
  id: 'subagent',
  inputSchema: z.object({ query: z.string() }),
  outputSchema: subagentFinding,
  execute: async ({ inputData }) => {
    const result = await mastra.getAgent('researcher').generate(inputData.query, {
      stopWhen: ({ stepNumber }) => stepNumber >= 8,
      maxOutputTokens: 2000,
    });
    return parseFindings(result);
  },
});

const reduceFindings = createStep({
  id: 'reduce',
  inputSchema: z.object({ findings: z.array(subagentFinding) }),
  outputSchema: z.object({ report: z.string() }),
  execute: async ({ inputData }) => {
    const result = await mastra.getAgent('generalAgent').generate(
      `Combine these findings into a structured cited report:\n${JSON.stringify(inputData.findings)}`
    );
    return { report: result.text };
  },
});

export const wideResearch = createWorkflow({
  id: 'deep-research-fanout',
  inputSchema: z.object({ goal: z.string() }),
  outputSchema: z.object({ report: z.string() }),
})
  .then(planQueries)
  .foreach(runSubagent, { concurrency: 25 })
  .then(reduceFindings)
  .commit();
```

### 8.6 Sensitive tool scope — in-product approval gates (V2)

V2 **ships** a per-tool-call approval gate. Before a gated tool executes, the agent
loop pauses, emits a `data-approval-request` part, and waits for an explicit
Allow/Deny decision (`POST /v1/runs/{runId}/approvals/{approvalId}`, §23.2) routed back
through request-context to the broker that owns the paused tool call. The run enters the
**`paused`** state while waiting; the SSE stream stays open the whole time.

**Gated-tool policy (decided 2026-06-13):**

| Policy | Tools |
|---|---|
| `"always"` — gate every call | all `composio_execute` (every OAuth-tool action), destructive-shell patterns, and deploy/publish CLIs |
| Destructive-shell pattern list | `rm -rf`, force pushes, and package publishes (`npm publish`, `pnpm publish`, `yarn publish`, `cargo publish`) alongside the deploy CLIs |
| `"never"` — never gate | read-only / sandbox-local file + code tools |

**Defaults:** a **5-minute tool-approval window with default-DENY** (enforced by the
AgentRun DO `alarm()`, multiplexed with the retention alarm); a denied tool **fails the
run** with the standard error (the run is not held open waiting for the user). The gate is
fail-closed: if `withApprovalGate` sees no broker registered, the `"always"` tools refuse to
run. Per-project `settings.toolApprovals` overrides are plumbed but **deferred** to a later
round (not wired this round).

V2 still has no Vercel deployment provider. Generated app deploys, when exposed, target the
Cloudflare-hosted product surface through an explicit Cloudflare deploy command and audit
event (itself a gated deploy/publish tool), not a third-party deploy shortcut.

### 8.7 Budget caps

Per-run config:

```ts
const result = await mastra.getAgent('general').stream(messages, {
  stopWhen: [
    stepCountIs(50),
    totalCostUsdExceeds(2.00), // custom condition
    tokenLimitExceeded(100_000),
  ],
});
```

When stop fires, agent emits a `budget-exhausted` part; UI prompts user to extend.
V2 implements the stop as a `budget_cap_reached` stream part plus terminal
`finishReason: "stop"` so the SSE stream closes cleanly and the assistant message is
persisted before the run exits.

**Budget-cap menu (design 14b):** the run-control budget dropdown offers **No cap / $2 /
$5 / $10 / Custom (max $50)**. "No cap" is genuinely unbounded (`resolveRunBudgetCap`
returns `number | null`, `null` = uncapped); the numeric options and Custom map straight to
`budgetCapUsd`. Cost accrual that the cap is measured against uses the **gateway-reported
USD** (OpenRouter's per-generation cost) falling back to the cached OpenRouter `/models`
price map (§4.2) — there is no hard-coded price table.

Project-level caps are persisted in `v2_projects.settings.budgetCapUsd`. The web
composer sends the current cap for normal runs, and `createAgentRunForThread()`
also applies the project cap server-side when a client omits `budgetCapUsd`, so
API callers cannot bypass a project default by leaving the field out.
If no project/user cap is present, `createAgentRunForThread()` applies the V2
hard default of `$5` so every run has a budget ceiling. AgentRun also receives
the user's UTC-day spend and tier daily cap before streaming; crossing that cap
emits `daily_cost_cap_reached` plus `silent_failure_detected` with
`detector=cost_spike`.

Project-level default models are persisted in `v2_projects.settings.defaultModel`.
The web model picker (the design-5 popover, §4.2) stores the user's last-used local
preference; when that preference is `Auto`, the client omits `model`. Server-side resolution
then follows the per-surface chain `explicit → project default → user per-surface default →
production default` with disable-aware skipping (§4.2), keyed by `surfaceOf(projectMode)`,
before the AgentRun Durable Object starts.

---

## 9. Sandbox Strategy (Daytona)

> **⚠️ MIGRATED Blaxel → Daytona (2026-06-14).** The sandbox backend is now **Daytona**, called via a REST-over-fetch client (`packages/tools-code/src/daytona-client.ts`) from the `ProjectSandbox` DO — no SDK in Workers. Key differences from the Blaxel design described in the subsections below (which is retained for historical context): the **sandbox disk is the durable store** (no Volumes; `autoDeleteInterval=-1`, auto-archive for cold storage); previews go through a self-hosted **`apps/preview-proxy`** worker on signed `*.trycheatcode.com` sandbox hosts that injects the Daytona preview token + skip-warning headers (the browser only sees a Cheatcode HMAC token); `exec` merges stderr into stdout and timeouts are in seconds; long-running processes use **toolbox sessions** with DO-persisted records; active runs hold a **run-lease** (`beginRun`/`endRun`) that pins `autoStopInterval=0` + a keepalive alarm; metering accrues only during run-leases. The Computer Files surface starts a pinned in-sandbox `code-server` process on port **13340** and exposes it through the same signed preview-token path as app previews; generated PPTX/DOCX/XLSX/PDF deliverables stay in `/workspace` and are opened from the IDE. **Authoritative implementation docs:** [`docs/plans/blaxel-to-daytona-migration.md`](./docs/plans/blaxel-to-daytona-migration.md), [`docs/plans/daytona-rest-reference.md`](./docs/plans/daytona-rest-reference.md), [`docs/plans/daytona-egress-broker.md`](./docs/plans/daytona-egress-broker.md). The Blaxel `@blaxel/core` SDK, `BL_*` env vars, and `blaxel.toml` are removed from code; `BL_*` secrets are retained until post-QA for rollback.

### 9.1 Sandbox image (`infra/containers/sandbox/Dockerfile`)

```dockerfile
FROM node:22-bookworm-slim

# Blaxel custom sandbox images must include the sandbox API binary. This is
# what makes process, filesystem, preview, and MCP APIs work for SDK-created
# sandboxes.
COPY --from=ghcr.io/blaxel-ai/sandbox:latest /sandbox-api /usr/local/bin/sandbox-api
RUN chmod a+rx /usr/local/bin/sandbox-api

# System packages: Python (code interpreter), browser shared libs, X11 + VNC.
RUN apt-get update && apt-get install -y --no-install-recommends \
  file python3 python3-pip python3-venv git curl ca-certificates wget gnupg netcat-openbsd \
  procps xvfb x11vnc websockify novnc \
  libnss3 libatk-bridge2.0-0 libdrm2 libxkbcommon0 libgbm1 libasound2 \
  fonts-liberation libappindicator3-1 libnspr4 libxcomposite1 libxdamage1 \
  libxrandr2 xdg-utils x11-utils \
  && rm -rf /var/lib/apt/lists/*

# Global node tooling + doc/data-generation libs — every version pinned.
RUN npm install -g \
  pnpm@10.33.2 \
  pptxgenjs@3.12.0 docx@9.5.1 exceljs@4.4.0 \
  react@19.2.6 react-dom@19.2.6 recharts@3.2.1 arquero@8.0.3

# Python data libs — pinned via a committed requirements file, no loose installs.
COPY infra/containers/sandbox/requirements.txt /tmp/requirements.txt
RUN pip3 install --break-system-packages -r /tmp/requirements.txt

# Browser driver — Stagehand + Playwright, pinned via a committed package.json +
# package-lock.json (npm ci = bit-exact). Playwright's Chromium installs into a
# fixed, world-readable path and is symlinked to CHROME_PATH because Stagehand
# v3 LOCAL mode requires a Chrome/Chromium executable path.
ENV DISPLAY=:99
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers
ENV CHROME_PATH=/usr/local/bin/cheatcode-chromium
COPY infra/containers/sandbox/browser-driver /opt/cheatcode-browser-driver
RUN cd /opt/cheatcode-browser-driver \
  && npm ci --omit=dev \
  && node_modules/.bin/playwright install chromium \
  && ln -sf "$(find /opt/pw-browsers -path '*/chrome-linux*/chrome' -print -quit)" /usr/local/bin/cheatcode-chromium \
  && chmod -R a+rX /opt/cheatcode-browser-driver /opt/pw-browsers
ENV PATH="/opt/cheatcode-browser-driver/node_modules/.bin:${PATH}"

# Static helper scripts (browser + VNC startup) — argv-invoked only, never
# built from interpolated shell strings (§9.4 / §9.5 / §14.5).
COPY infra/containers/sandbox/scripts/ /opt/cheatcode/
RUN chmod -R a+rx /opt/cheatcode

COPY infra/containers/sandbox/entrypoint.sh /entrypoint.sh
RUN chmod a+rx /entrypoint.sh

# /workspace is the user project root. Blaxel persists the writable layer while
# the sandbox exists; durable project files may also live on an attached volume.
RUN mkdir -p /workspace && chown -R node:node /workspace
WORKDIR /workspace
USER node

RUN npx create-next-app@16.2.6 /home/node/cheatcode-next-template --yes --ts --tailwind --eslint --app --src-dir --use-pnpm --skip-install --disable-git \
  && npx --yes create-expo-app@latest /home/node/cheatcode-expo-template --template default --no-install \
  && rm -rf /home/node/cheatcode-next-template/.next /home/node/cheatcode-next-template/node_modules

EXPOSE 5173 8000 6080 8081 13340

ENTRYPOINT ["/entrypoint.sh"]
```

`infra/containers/sandbox/` is committed: **`blaxel.toml`** (`type = "sandbox"`, `name = "cheatcode-sandbox"`, `runtime.generation = "mk3"`, memory and port metadata), **`entrypoint.sh`** (starts `/usr/local/bin/sandbox-api`, waits for it on 127.0.0.1:8080, then keeps the sandbox process alive), **`browser-driver/`** (`package.json` pinning `@browserbasehq/stagehand` 3.2.0 + its `playwright`; `package-lock.json` so `npm ci` is bit-exact; `server.js` — the only browser-driver entrypoint, a persistent in-sandbox Stagehand driver bound only to 127.0.0.1:9323), **`scripts/`** (`start-browser.sh`, `start-vnc.sh`, `start-code-server.sh` — static argv-invoked runtime startup helpers used by browser tools, takeover, and IDE preview, not test drivers), and **`requirements.txt`** (pinned Python libs — `pandas`, `numpy`, `matplotlib`, `openpyxl`, `pillow`, `ipython`, etc., each at an exact version). The Node doc/data runtime under `/opt/cheatcode-doc-runtime` includes the pinned document libraries plus `react`, `react-dom`, `recharts`, and `arquero`, so `packages/tools-data` can render fixed-size Recharts SVG through sandbox SSR without bundling Recharts into Workers. The image also bakes `code-server@4.117.0` plus OpenVSX viewers for PPTX/PPSX/POTX, PDF, DOCX/DOTX/Office files, XLS/XLSX, CSV/TSV/TAB, ODS, SQLite/GeoPackage databases, archives, tables, Parquet, notebooks, Draw.io diagrams, XMind maps, font files, PSD/HEIC/TIFF/ICNS assets, Java class files, and Mermaid-flavored Markdown so generated deliverables can open inside the Files tab without pushing them through R2 download URLs; the Code Server startup script pins default editor associations for those formats. Playwright's Chromium lives at the fixed `PLAYWRIGHT_BROWSERS_PATH` and Stagehand launches it through the Playwright API — there is no fixed CDP port to expose (§9.4). Browser-driver behavior is validated only in the final direct `agent-browser` product QA gate by exercising browser tools and takeover through the real UI and checking logs; no one-shot browser driver, build-time browser smoke script, or custom browser QA wrapper is part of V2.

Blaxel reserved ports **80**, **443**, and **8080** for system/sandbox API behavior; Daytona keeps the same product rule: Cheatcode must never expose 8080 as a user preview. Cheatcode-generated dev servers bind to **5173** for frontend previews or **8000** for API/static servers. Mobile (`app-builder-mobile`) projects scaffold from the baked Expo template and run `expo start` on **8081** (Metro). The IDE binds to **13340** and is exposed only through a signed Cheatcode preview URL minted by `ProjectSandbox.exposeCodeServer()`. Preview ports are dynamically opened as needed.

### 9.2 Sandbox lifecycle

```ts
// apps/agent-worker/src/sandbox/lifecycle.ts
import { SandboxInstance, VolumeInstance, initialize } from '@blaxel/core';
import { logger } from '@cheatcode/observability';
import { projects } from '@cheatcode/db/schema';
import { eq } from 'drizzle-orm';
import type { Database } from '@cheatcode/db';

// @blaxel/core API (verified against docs, May 2026):
//   initialize({ workspace, apiKey, disableH2 }) configures credentials from
//     Worker bindings instead of process.env or local CLI config.
//   SandboxInstance.createIfNotExists({ name, image, memory, region, ports, volumes, lifecycle, network })
//     is the idempotent creation path.
//   sandbox.process.exec({ command, workingDir, waitForCompletion, timeout })
//     returns stdout/stderr/logs when waitForCompletion is true.
//   sandbox.fs.read/write/ls/find/grep manage files.
//   sandbox.previews.createIfNotExists(...) creates preview URLs and private preview tokens.

export async function getOrCreateSandbox(env: Env, db: Database, projectId: string) {
  initialize({ workspace: env.BL_WORKSPACE, apiKey: env.BL_API_KEY, disableH2: true });
  const project = await db.query.projects.findFirst({
    where: eq(projects.id, projectId),
    columns: { sandboxId: true },
  });

  const sandboxName = project?.sandboxId ?? `cc-${projectId.replaceAll('-', '').slice(0, 40)}`;
  const volumeName = `ccv-${sandboxName}`;
  await VolumeInstance.createIfNotExists({
    name: volumeName,
    region: env.BL_REGION,
    size: 2048,
    labels: { app: 'cheatcode', projectId, sandboxId: sandboxName },
  });
  return SandboxInstance.createIfNotExists({
    name: sandboxName,
    image: env.BLAXEL_SANDBOX_IMAGE,
    memory: Number(env.BLAXEL_SANDBOX_MEMORY_MB ?? 4096),
    region: env.BL_REGION,
    ports: [{ target: 5173, protocol: 'HTTP' }],
    volumes: [{ name: volumeName, mountPath: '/workspace', readOnly: false }],
    labels: { app: 'cheatcode', projectId },
  });
}

export async function persistSandboxName(db: Database, projectId: string, sandboxName: string) {
  await db.update(projects).set({ sandboxId: sandboxName }).where(eq(projects.id, projectId));
}
```

Blaxel sandboxes are persistent computers. They automatically transition to standby after roughly 15 seconds of inactivity and resume from standby in under 25 ms while preserving process and filesystem state. Project sandboxes also attach exactly one Blaxel persistent volume, named `ccv-${sandboxName}`, mounted read-write at `/workspace`, and created in `BL_REGION` with a locked 2,048 MB size. Current Blaxel volume limits reject the earlier 10,240 MB plan value, and live Blaxel validation rejects names longer than 49 characters; `ccv-${sandboxName}` stays below that limit for V2 sandbox IDs. The official volume docs use 2,048 MB examples, so V2 uses 2 GB per project unless the plan is explicitly revised after quota verification. This makes project files recoverable if a sandbox is deleted and later recreated from the image.

Cleanup triggers:
- Idle sandboxes are allowed to enter Blaxel standby automatically.
- Expiration policies retire abandoned sandboxes after 30 days.
- User/project deletion calls `SandboxInstance.delete(sandboxName)`, deletes `ccv-${sandboxName}`, and deletes generated R2 artifacts.

### 9.3 Tool surface against sandbox

| Tool | Sandbox method |
|---|---|
| `bash` (shell exec) | Cheatcode `ProjectSandbox.exec({ command: string[], ... })` → Blaxel `sandbox.process.exec({ command: shellString, workingDir, waitForCompletion: true })` |
| `fs_read` / `fs_write` | `sandbox.fs.read()` / `sandbox.fs.write()` under `/workspace` only |
| `fs_list` / `fs_search` / `fs_delete` | `sandbox.fs.ls()` / `sandbox.fs.grep()` / `sandbox.fs.rm()` through the ProjectSandbox wrapper |
| `run_python` (data work) | `ProjectSandbox.runCode()` executes `python3 -c <code>` through Blaxel process API so stdout/stderr come from the completed process response |
| `run_node` | `ProjectSandbox.runCode()` executes `node --input-type=module -e <code>` through Blaxel process API so stdout/stderr come from the completed process response |
| `start_dev_server` | `sandbox.process.exec({ command: 'pnpm dev --hostname 0.0.0.0 --port 5173', keepAlive: true, waitForPorts: [5173], timeout: 3600, restartOnFailure: true, maxRestarts: 3 }); sandbox.previews.createIfNotExists(...)` |
| `docs_generate_slides` / `docs_generate_pdf` / `docs_generate_xlsx` | `runCode` with respective TS libs |
| `browser_open` / `browser_act` / `browser_observe` / `browser_extract` | Stagehand v3 LOCAL → Playwright inside Blaxel sandbox |
| `browser_screenshot` | Stagehand-owned Playwright `page.screenshot({ type: 'png', fullPage })` inside the same sandbox browser, returned as base64 PNG |
| `git` (clone/commit/push) | `ProjectSandbox.exec({ command: ['git', ...] })` |
| `start_takeover_session` | x11vnc + websockify → Blaxel private preview on 6080 → noVNC URL |

### 9.4 Stagehand in LOCAL mode

**Stagehand owns the browser; nothing browser-related is ever exposed.** Stagehand runs *inside* the Blaxel sandbox in LOCAL mode and launches its own Playwright-managed Chromium — there is no separate `chromium` process, no fixed `--remote-debugging-port`, and no CDP port to leak. Playwright drives Chromium over its own internal localhost CDP channel on a random port; the agent-worker never opens a CDP socket and never exposes one. The browser renders onto the Xvfb display (`:99`) so the §9.5 VNC takeover can mirror it. Product browser tools use a persistent local-only driver process (`/opt/cheatcode-browser-driver/server.js`) so `browser_open`, `browser_act`, `browser_observe`, `browser_extract`, and `browser_screenshot` share the same Stagehand context and page state across tool calls. The driver binds only to `127.0.0.1:9323` inside the sandbox and is started through `ProjectSandbox.startProcess()` with a stable `processId`; it is never exposed as a Blaxel preview.

```js
// infra/containers/sandbox/browser-driver/server.js
// Lives in the container IMAGE (§9.1), NOT the linted pnpm workspace — so it
// legitimately reads process.env (the container is a plain Node runtime).
// Started by the agent-worker as a long-lived sandbox process. Product QA
// validates this path through the real UI and app logs, not a local test script.
import { Stagehand } from '@browserbasehq/stagehand';

let stagehandPromise;

async function stagehandInstance() {
  stagehandPromise ??= initializeStagehand();
  return stagehandPromise;
}

async function initializeStagehand() {
  const stagehand = new Stagehand({
    env: 'LOCAL',
    model: process.env.STAGEHAND_MODEL ?? 'anthropic/claude-sonnet-4-6',
    localBrowserLaunchOptions: {
      headless: false,            // headed — so x11vnc can mirror it for takeover
      chromiumSandbox: false,
      executablePath: process.env.CHROME_PATH,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      env: { DISPLAY: ':99' },    // render onto the Xvfb display from start-browser.sh
      connectTimeoutMs: 30000,
    },
    verbose: 0,
  });
  await stagehand.init();
  return stagehand;
}

export async function runBrowserActions(actions) {
  const stagehand = await stagehandInstance();
  const page = stagehand.context.pages()[0] || await stagehand.context.newPage();
  // Stagehand v3 exposes act() / extract() / observe() on the Stagehand instance.
  return results;
}
```

```ts
// packages/tools-browser/src/index.ts — the agent-worker side (linted workspace)
export async function browserTool(sandbox: ProjectSandboxStub, input: BrowserInput, anthropicKey: string) {
  // Bring up the Xvfb display via a STATIC, argv-invoked script — never an
  // interpolated `sh -c` string (§14.5). start-browser.sh is baked into the
  // image (§9.1) and idempotent (pgrep-guards Xvfb). It does NOT start Chromium —
  // Stagehand/Playwright launch the browser themselves.
  await sandbox.exec(['/opt/cheatcode/start-browser.sh']);
  // Start or reuse the local-only persistent driver; the BYOK provider key is
  // passed only as the process env for that sandbox driver, never logged (§7.8).
  await sandbox.startProcess({
    processId: 'cheatcode-browser-driver',
    command: ['node', '/opt/cheatcode-browser-driver/server.js'],
    env: {
      STAGEHAND_MODEL: 'anthropic/claude-sonnet-4-6',
      STAGEHAND_MODEL_API_KEY: anthropicKey,
    },
  });
  return sandbox.runCode({
    language: 'javascript',
    code: buildBrowserServerRequest(input, '/actions'),
  });
}
```

Stagehand v3 LOCAL mode gives us full `act()` / `extract()` / `observe()` semantic methods against the Blaxel sandbox's own Chromium — no Browserbase, no per-minute cost. The driver health endpoint returns the configured model plus a non-secret SHA-256 BYOK fingerprint prefix; if either changes, `packages/tools-browser` kills and restarts the local driver before the next action so a stale plaintext key is not reused. The **only** browser-related port ever exposed is the VNC display (6080) for user takeover, and that is gated (§9.5).

### 9.5 User takeover (authenticated)

User takeover hands raw browser control to the user. The VNC port must **never** be a public unauthenticated endpoint — `x11vnc -nopw` on an open port = anyone with the URL drives the user's logged-in browser session. The plan gates it three ways:

1. **VNC password** — `x11vnc` runs with a per-session random password (not `-nopw`), passed via `-passwd`.
2. **Short-lived private Blaxel preview token.** noVNC is served through a Blaxel private preview on port 6080. The preview requires `bl_preview_token` or `X-Blaxel-Preview-Token`; the token expires with the 15-minute takeover window and is never logged.
3. **Preview deleted on session end** — the private preview is deleted on resume, on the 15-min TTL alarm, or on run completion — whichever fires first. The port does not linger.

noVNC opens a separate WebSocket to websockify. The embed URL must carry the Blaxel preview token on both the initial `vnc.html` request and the noVNC `path=websockify?...` parameter so the private preview gate applies to the WebSocket handshake too.

```ts
// apps/agent-worker/src/takeover.ts
async function startTakeoverSession(env: Env, sandbox: ProjectSandboxStub, runId: string, userId: string) {
  const agentRun = env.AGENT_RUN.get(env.AGENT_RUN.idFromName(runId));
  await agentRun.pause('user_takeover');

  // Per-session VNC password — generated fresh, NOT -nopw. Handed to the static
  // start-vnc.sh via env — NEVER interpolated into a shell string (§14.5).
  // start-vnc.sh (baked into the image, §9.1) reads $VNC_PASSWORD and runs
  // `x11vnc -passwd "$VNC_PASSWORD" -bg`, then websockify on 6080.
  const vncPassword = crypto.randomUUID();
  await sandbox.exec(['/opt/cheatcode/start-vnc.sh'], { env: { VNC_PASSWORD: vncPassword } });

  const { url, token } = await sandbox.exposePort({
    port: 6080,
    name: `takeover-${runId}`,
    tokenTtlMs: 15 * 60_000,
  });
  const resumeToken = await signResumeToken(env, { runId, userId, ttlMs: 15 * 60_000 });

  // TTL alarm: auto-unexpose + resume if the user walks away.
  await agentRun.scheduleTakeoverExpiry(15 * 60_000);
  const websocketPath = `websockify?bl_preview_token=${token}`;

  return {
    embedUrl: `${url}/vnc.html?autoconnect=1&resize=scale&password=${vncPassword}&path=${encodeURIComponent(websocketPath)}&bl_preview_token=${token}`,
    resumeToken,
  };
}

async function resumeFromTakeover(env: Env, sandbox: ProjectSandboxStub, runId: string, userId: string, resumeToken: string) {
  await verifyResumeToken(env, resumeToken, { runId, userId });   // throws on invalid/expired
  await sandbox.unexposePort({ port: 6080 });                      // private preview removed immediately
  const agentRun = env.AGENT_RUN.get(env.AGENT_RUN.idFromName(runId));
  await agentRun.resume();
}
```

`redactSecrets()` (§13.3) strips `password=` and `bl_preview_token=` query params before any `embedUrl` string reaches logs. Frontend embeds `<iframe src={embedUrl}>` and shows "I'm done — resume agent."

### 9.6 Sandbox network egress

Blaxel supports sandbox network configuration at creation time, including domain filtering and proxy-based secret injection. That proxy feature is marked public preview in current docs and is not the only V1 safety boundary. V1 configures conservative `allowedDomains` where the chosen region supports it, but production abuse containment still relies on:

- **Resource caps** — CPU cap per tier (1 vCPU free / 2 paid), 60-min idle kill, 24-h hard wall-clock kill (§29.10).
- **Behavioural detection** — a process sustaining >90% CPU for 30 min is terminated and the user flagged (§29.10).
- **No inbound** — only explicitly created Blaxel previews are reachable; everything else is unreachable.
- **Audit** — every `sandbox.exec` stores non-secret execution metadata (`argv0`, argc, process name, status, exit code, duration) through the `R2_AUDIT` binding to the immutable `cheatcode-audit` R2 bucket. Raw command strings, user code, stdout, stderr, env values, and decrypted BYOK values are never written to audit objects.

If Blaxel changes the proxy feature from public preview to production-recommended, make domain filtering and secrets injection mandatory for all newly created project sandboxes.

---

## 10. Frontend Architecture

> Next.js 16.2.6 + React 19.2.6 + Tailwind 4.3 + AI Elements + Streamdown on Cloudflare Workers via OpenNext. The frontend talks to `gateway-worker` over HTTPS — REST plus SSE for agent streaming (§10.6). This section is the locked spec for `apps/web/`.

### 10.1 Frontend design principles

1. **Server Components by default; `'use client'` at the leaf.** Push the client boundary as deep as possible to minimize bundle.
2. **Streaming-first UI.** Every dynamic page uses Suspense + RSC streaming so users see a shell within TTFB and content streams in.
3. **No `useEffect` for data fetching.** TanStack Query (client) or Server Components (server). Period.
4. **Cache Components enabled, used only where safe.** `cacheComponents: true` stays on in `next.config.ts`, but authenticated V1-parity app surfaces fetch user-scoped gateway data with TanStack Query instead of public RSC cache tags.
5. **Typed end-to-end.** `CheatcodeUIMessage` generic threads through `useChat`, AI Elements, and our `data-*` part renderers. Hono `hc<typeof gatewayApp>` types REST.
6. **State separated by ownership.** Server state → TanStack Query. Ephemeral UI → Zustand. URL state → `nuqs`. Form state → `useActionState` (simple) or RHF+Zod (complex). Never mix.
7. **INP <200 ms target.** `<Activity>` for hidden panels, `startTransition` for derived state, granular Suspense boundaries, throttled streams.
8. **Accessible streaming.** `aria-live="polite"` throttled at 500 ms (raw token-by-token announcements cause screen-reader fatigue).
9. **Responsive web app only.** No PWA, service worker, offline fallback, web push, or app install surface in V2.

### 10.2 Stack lockfile (frontend-relevant)

The §4.1 pnpm catalog is the authoritative pin source; this table is the frontend-relevant slice of it, kept as a reading aid.

| Package | Version | Purpose |
|---|---|---|
| `next` | 16.2.6 | Framework — Turbopack default, Cache Components stable |
| `react` / `react-dom` | 19.2.6 | Actions, `useOptimistic`, `useActionState`, `<Activity>`, View Transitions |
| `tailwindcss` | 4.3.0 | CSS-first config via `@theme`; Oxide engine |
| `@tailwindcss/postcss` | 4.3.0 | Tailwind v4 PostCSS plugin required by Next.js to process `@import "tailwindcss"` |
| `tw-animate-css` / `tailwind-scrollbar` / `tailwind-scrollbar-hide` | 1.4.0 / 4.0.2 / 4.0.0 | V1 UI parity helpers used by the reused Cheatcode frontend stylesheet |
| `@biomejs/biome` | 2.4.14 | Lint + format |
| `shadcn` (CLI) | 4.6.0 | Component registry; v4 supports `--preset next --base radix` |
| `ai-elements` | 1.9.0 | 29 prebuilt AI chat UI components (shadcn-style, copy into repo) |
| `streamdown` | 2.5.0 | Streaming-aware markdown renderer |
| `remend` | 1.3.0 | Streamdown's unterminated-block healing |
| `ai` / `@ai-sdk/react` / `@ai-sdk/google` | 6.0.182 / 3.0.184 / 3.0.80 | `useChat<CheatcodeUIMessage>` plus BYOK Gemini model routing |
| `@tanstack/react-query` | 5.100.11 | Server state |
| `zustand` | 5.0.13 | Client state |
| `nuqs` | 2.8.9 | URL state |
| `react-hook-form` / `@hookform/resolvers` / `zod` | 7.76.0 / 5.2.2 / 3.25.76 | Complex forms (resolvers 5.2.2 validates via Standard Schema — works with zod 3.25.x) |
| `@clerk/nextjs` | 7.3.4 | Auth |
| `@polar-sh/sdk` | 0.46.4 | Billing |
| `next-themes` | 0.4.6 | Dark mode (localStorage-persisted; `defaultTheme="system"`, no `forcedTheme` — §10.11) |
| `cmdk` | 1.1.1 | ⌘K command palette (search results + nav, §10.6) |
| `next-intl` | 4.12.0 | i18n (English-only V1, architected for future locales) |
| `@opennextjs/cloudflare` | 1.19.11 | Converts the Next.js build into a Cloudflare Worker and provides local `workerd` preview/deploy commands |
| `web-vitals` | 5.2.0 | RUM |
| `@tanstack/react-virtual` | 3.13.24 | Virtual scrolling for long threads |
| `sonner` | 2.0.7 | Toasts |
| `geist` | 1.7.0 | Font |
| `lucide-react` | 1.16.0 | V1 icon set, imported only via `@/components/ui/icons` |
| `@vercel/og` | 0.11.1 | Default OG images for public marketing routes |

### 10.3 Folder structure (`apps/web/`)

```
apps/web/
├── middleware.ts                      Clerk gate; kept as Edge Middleware because OpenNext 1.19.11 rejects Next 16 proxy.ts
├── next.config.ts                     cacheComponents: true, output: "standalone", OpenNext dev init, images.qualities: [75]
├── open-next.config.ts                R2 incremental cache + DO queue/tag cache
├── wrangler.jsonc                     cheatcode-web Worker, routes, assets, R2 cache, DO cache classes
├── postcss.config.mjs                 Tailwind v4 PostCSS plugin
├── eslint.config.mjs                  Next.js plugin compatibility only; Biome remains primary lint
├── package.json
├── public/
│   ├── cheatcode-symbol.png
│   ├── logo.png
│   └── logo-white.png
└── src/
    ├── middleware.ts                  Next middleware entry
    ├── app/
    │   ├── layout.tsx                 ClerkProvider, fonts (Geist), theme, QueryClientProvider, Toaster
    │   ├── globals.css                Tailwind v4 @import, @theme tokens, @source ai-elements + streamdown
    │   ├── page.tsx                   V1-parity home composer, no separate marketing route group
    │   ├── opengraph-image.tsx        Default OG for root
    │   ├── not-found.tsx
    │   ├── global-error.tsx           Includes <html> + <body> — replaces root on uncaught
    │   ├── (app)/                     Authenticated route group
    │   │   ├── layout.tsx             V1-parity app chrome + sidebar
    │   │   ├── projects/page.tsx      Project list + selected thread surface via query state
    │   │   ├── settings/[[...section]]/page.tsx
    │   │   └── skills/page.tsx        Bundled skills catalog listing
    │   ├── sign-in/[[...sign-in]]/page.tsx
    │   └── sign-up/[[...sign-up]]/page.tsx
    ├── components/
    │   ├── ui/icons.ts                V1 icon barrel re-exporting @cheatcode/ui icons
    │   ├── ai-elements/response.tsx   Streamdown response adapter re-export
    │   ├── chat/                      Chat panel, messages, composer, status pill
    │   ├── home/home-composer.tsx     V1 home prompt and launch-template cards
    │   ├── preview/                   Preview / Browser / Terminal / Code tabs
    │   ├── projects/projects-shell.tsx
    │   ├── settings/                  Account, integrations, agents, API keys, billing panels
    │   ├── shell/                     App chrome, sidebar, thread header
    │   ├── auth/client-user-button.tsx
    │   └── observability/client-observability.tsx
    └── lib/
        ├── api/                       authorized-fetch + project/thread bootstrap
        ├── agent-models.ts            Local model picker options
        ├── store/app-store.ts         Zustand UI/chat state
        ├── stream/stream-seq.ts       DO resume cursor extraction
        ├── intl/                      next-intl request config + en messages
        ├── rum.ts                     Web Vitals attribution → gateway /v1/vitals beacon
        ├── error-reporter.ts          Client error reporting
        └── ui/cn.ts                   Re-export of @cheatcode/ui cn
```

### 10.4 Next.js 16 + React 19 patterns

#### Cloudflare-compatible Next config

```ts
// next.config.ts
import type { NextConfig } from 'next';

export default {
  cacheComponents: true,
  images: { qualities: [75], minimumCacheTTL: 60 * 60 * 4 },
  output: 'standalone',
} satisfies NextConfig;
```

V1 keeps Cache Components enabled because the Cloudflare/OpenNext app uses the
Next 16 app runtime, but the authenticated project surface is deliberately
client-owned: Clerk token retrieval happens in the browser and gateway reads use
TanStack Query. Do not put bearer-token-backed project/thread requests behind
`'use cache'`, `cacheLife`, or `cacheTag`. Public/static surfaces may use RSC
cache primitives later only when they have no user-scoped authorization input.

```tsx
// app/(app)/projects/page.tsx
import { Suspense } from 'react';
import { ProjectsShell } from '@/components/projects/projects-shell';

export default function ProjectsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-thread-panel" />}>
      <ProjectsShell />
    </Suspense>
  );
}
```

`ProjectsShell` owns `nuqs` URL state (`thread`, `prompt`, `surface`,
`template`, `budget`), bootstraps the project/thread through the gateway,
hydrates initial messages with TanStack Query, and renders the chat plus preview
panel in the V1 layout.

```tsx
// components/preview/preview-side-panel.tsx
import { Activity } from 'react';

function PanelBody({ activePreviewTab, threadId, previewUrl, sandboxStatus }) {
  return (
    <div className="h-full min-h-[520px]">
      <Activity mode={activePreviewTab === 'app' ? 'visible' : 'hidden'}>
        <AppTab previewUrl={previewUrl} sandboxStatus={sandboxStatus} />
      </Activity>
      <Activity mode={activePreviewTab === 'browser' ? 'visible' : 'hidden'}>
        <BrowserTakeoverTab sandboxStatus={sandboxStatus} threadId={threadId} />
      </Activity>
      <Activity mode={activePreviewTab === 'terminal' ? 'visible' : 'hidden'}>
        <SandboxTerminalTab sandboxStatus={sandboxStatus} threadId={threadId} />
      </Activity>
      <Activity mode={activePreviewTab === 'files' ? 'visible' : 'hidden'}>
        <SandboxFilesTab sandboxStatus={sandboxStatus} threadId={threadId} />
      </Activity>
    </div>
  );
}
```

This is the only hidden-panel preservation pattern in V1. There are no
`projects/[projectId]` parallel route slots in the reused frontend.

#### `middleware.ts` (OpenNext Cloudflare compatibility)

```ts
// middleware.ts (legacy Edge Middleware until OpenNext Cloudflare supports Next 16 proxy.ts)
import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

const isProtected = createRouteMatcher(['/projects(.*)', '/settings(.*)', '/skills(.*)']);

const middleware = clerkMiddleware(async (auth, req) => {
  if (isProtected(req)) await auth.protect();
});

export default middleware;

export const config = { matcher: ['/((?!_next|.*\\..*).*)'] };
```

Next.js 16.2 deprecates the `middleware.ts` file convention in favor of
`proxy.ts`, but OpenNext Cloudflare 1.19.11 currently rejects that Node proxy
output with `Node.js middleware is not currently supported. Consider switching
to Edge Middleware.` V1 intentionally keeps `middleware.ts` until OpenNext
Cloudflare ships compatible Next 16 proxy support.

#### React 19.2 features in active use

- **`useDeferredValue`** — chat messages decouple stream updates from markdown/tool rendering.
- **`<Activity mode>`** — preview panel tabs keep iframe, browser takeover, terminal command history, and file-editor state mounted across Preview / Browser / Terminal / Code tab switches.
- **ref-as-prop** — no new `forwardRef` wrappers unless a third-party component requires the legacy shape.

`useActionState`, `useOptimistic`, and View Transitions are allowed when they
fit a future V1 form or navigation change, but they are not required for the
current reused frontend. Keep additions visually aligned with the V1 UI before
introducing new React patterns.

### 10.5 State architecture

| Domain | Tool | When |
|---|---|---|
| Server data (REST) | **TanStack Query 5** | Projects, threads, billing, models list, integrations, BYOK summaries |
| Agent streaming | **`useChat<CheatcodeUIMessage>`** | The thread itself |
| UI ephemeral | **Zustand 5 (slices)** | Sidebar collapsed, active tab, draft text, connection state (theme is **not** here — owned by next-themes) |
| URL state | **`nuqs`** | Filters, modal open/close, tab selection, search params |
| Simple forms | **`useActionState` + `useFormStatus`** | Rename project, toggle settings |
| Complex forms | **React Hook Form + Zod + shadcn `<Form>`** | BYOK keys, project setup |
| Local storage | **`zustand/middleware/persist`** | Last-used model, sidebar state. **Never auth.** (Theme persistence is owned by **next-themes** localStorage, not zustand persist — §10.11.) |
| Server Components | **None** | Pass props down. No client store reaches here. |

**The rule:** any piece of state exists in exactly one of these places. Cross-place duplication is a refactor candidate.

#### TanStack Query setup

```tsx
// lib/api/queries.ts
import { queryOptions } from '@tanstack/react-query';
import { api } from './client';

export const projectsQuery = (userId: string) => queryOptions({
  queryKey: ['projects', userId] as const,
  queryFn: async () => (await api.v1.projects.$get()).json(),
  staleTime: 60_000,
});

export const threadMessagesQuery = (threadId: string) => queryOptions({
  queryKey: ['threads', threadId, 'messages'] as const,
  queryFn: async ({ pageParam }) =>
    (await api.v1.threads[':threadId'].messages.$get({
      param: { threadId },
      query: { cursor: pageParam },
    })).json(),
  getNextPageParam: (last) => last.next_cursor,
  initialPageParam: null,
});
```

```tsx
// app/(app)/projects/page.tsx — Server Component prefetch
import { dehydrate, HydrationBoundary, QueryClient } from '@tanstack/react-query';

export default async function Page() {
  const queryClient = new QueryClient();
  await queryClient.prefetchQuery(projectsQuery(userId));
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <ProjectsClientView />
    </HydrationBoundary>
  );
}
```

Hierarchical query keys (`['threads', threadId, 'messages']`) so `invalidateQueries({ queryKey: ['threads', threadId] })` cascades.

#### Zustand slices

```ts
// lib/store/ui-slice.ts
import type { StateCreator } from 'zustand';

export interface UISlice {
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  activeTab: 'chat' | 'preview';
  setActiveTab: (tab: 'chat' | 'preview') => void;
}

export const createUISlice: StateCreator<UISlice> = (set) => ({
  sidebarCollapsed: false,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  activeTab: 'chat',
  setActiveTab: (tab) => set({ activeTab: tab }),
});

// lib/store/index.ts
import { create } from 'zustand';
import { persist, subscribeWithSelector } from 'zustand/middleware';
import { createUISlice, type UISlice } from './ui-slice';
import { createChatSlice, type ChatSlice } from './chat-slice';

export const useStore = create<UISlice & ChatSlice>()(
  subscribeWithSelector(
    persist(
      (...a) => ({ ...createUISlice(...a), ...createChatSlice(...a) }),
      { name: 'cheatcode-ui', partialize: (s) => ({ sidebarCollapsed: s.sidebarCollapsed }) }
    )
  )
);
```

### 10.6 AI chat UI architecture

#### One transport: SSE / HTTP UIMessage streams

**The agent stream is SSE end to end.** AI SDK v6's `useChat` + resumable-streams are built around HTTP `UIMessage` streams (`toUIMessageStreamResponse()` + `DefaultChatTransport`). The plan uses exactly that — no custom WebSocket bridge. WebSocket is reserved only for noVNC takeover, which connects through a Blaxel private preview, not to a chat DO. The V1 preview terminal is a command executor over `POST /v1/threads/{threadId}/sandbox/terminal`; it does not ship xterm.js or a persistent shell WebSocket.

Flow: `useChat` → `POST gateway/v1/threads/{id}/runs` (SSE response) → gateway forwards via Service Binding to `agent-worker` → `AgentRun` DO runs the agent, appends each part to its SQLite `message_part` table, and returns a `ReadableStream` → gateway pipes it back as `toUIMessageStreamResponse()`. Resume: `GET gateway/v1/threads/{id}/runs/stream?lastSeq=N` replays stored parts past `seq=N` then continues live, or `204` if no active run.

```ts
// packages/types/src/ui-message.ts — full definition in §25.5
export type CheatcodeUIMessage = UIMessage<
  { runId: AgentRunId; modelId: string; userId: UserId },
  { /* 15 custom data parts; see §25.5 */ },
  InferUITools<typeof cheatcodeTools>
>;
```

```tsx
// components/chat/chat-panel.tsx
'use client';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useAuth } from '@clerk/nextjs';
import { env } from '@cheatcode/env';
import type { CheatcodeUIMessage } from '@cheatcode/types';
import { mapErrorToMessage } from '@/lib/stream/error-mapping';
import { toast } from 'sonner';

// Absolute gateway origin, validated by @cheatcode/env (never raw process.env — §21).
const GATEWAY = env.NEXT_PUBLIC_GATEWAY_URL; // https://gateway.trycheatcode.com

export function ChatPanel({
  initialMessages,
  threadId,
}: {
  initialMessages: CheatcodeUIMessage[];
  threadId: string;
}) {
  const { getToken } = useAuth();
  const {
    messages, sendMessage, status, error, regenerate, stop,
    resumeStream,
  } = useChat<CheatcodeUIMessage>({
    id: threadId,
    resume: false,
    experimental_throttle: 50,
    transport: new DefaultChatTransport({
      // Absolute gateway URL — the product API is intentionally a separate Worker.
      api: `${GATEWAY}/v1/threads/${threadId}/runs`,
      headers: async () => ({ Authorization: `Bearer ${await getToken()}` }),
      // Map useChat's default payload to the gateway's CreateRun contract (§23.2 #12).
      // Without this the transport POSTs { id, messages, trigger, ... } and the route 422s.
      prepareSendMessagesRequest: ({ messages, body }) => ({
        body: {
          message: messages[messages.length - 1],
          model: body?.model,
          agentName: body?.agentName,
          budgetCapUsd: body?.budgetCapUsd,
        },
      }),
      // Resume: GET the stream endpoint with the last seq this client received.
      // 204 = no active run. lastSeq comes from sessionStorage (written in onData).
      // The app calls resumeStream() only for active in-memory streams.
      prepareReconnectToStreamRequest: () => {
        const lastSeq = sessionStorage.getItem(`cc:lastSeq:${threadId}`) ?? '0';
        return {
          api: `${GATEWAY}/v1/threads/${threadId}/runs/stream?lastSeq=${lastSeq}`,
          headers: async () => ({ Authorization: `Bearer ${await getToken()}` }),
        };
      },
    }),
    onError: (err) => toast.error(mapErrorToMessage(err)),
    onData: (part) => {
      // The DO emits a transient `data-seq` part carrying the latest message_part
      // seq; persist it so a reconnect resumes from exactly there (§23.5, §24.2).
      if (part.type === 'data-seq') {
        sessionStorage.setItem(`cc:lastSeq:${threadId}`, String(part.data.seq));
      }
      // ...mirror other data-* parts into Zustand for cross-component reads
    },
  });

  // Visibility-change resume for active in-memory streams only.
  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === 'visible' && status === 'streaming') resumeStream();
    };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, [status, resumeStream]);

  return <ConversationWithInput {...{ messages, sendMessage, status, error, regenerate, stop }} />;
}
```

No custom transport class. `DefaultChatTransport` handles SSE + reconnect. The only place WebSocket appears in the frontend is `browser-tab.tsx` (noVNC → sandbox VNC port), via a sandbox preview URL gated per §9.5. `terminal-tab.tsx` posts one command at a time to the authenticated gateway route and renders stdout/stderr in the existing V1 visual style.

Reconnection of the SSE stream is handled by `DefaultChatTransport` + the resume endpoint. A `ConnectionStatusPill` (`online | reconnecting | offline`) is driven off `useChat`'s `status` + the browser `online`/`offline` events; toast only after >5 s outage.

#### Message parts rendering

```tsx
// components/chat/message-parts.tsx
'use client';
import { isToolUIPart } from 'ai';
import { Response } from '@/components/ai-elements/response';
import { Reasoning } from '@/components/ai-elements/reasoning';
import { ToolCall } from './tool-call';
import type { CheatcodeUIMessage } from '@cheatcode/types';

export const MessageParts = React.memo(function MessageParts({
  message, isStreaming,
}: { message: CheatcodeUIMessage; isStreaming: boolean }) {
  return message.parts.map((part, i) => {
    const key = `${message.id}-${i}`;
    switch (part.type) {
      case 'text':
        return <Response key={key} isStreaming={part.state === 'streaming'}>{part.text}</Response>;
      case 'reasoning':
        return <Reasoning key={key} content={part.text} streaming={part.state === 'streaming'} />;
      case 'source-url':
        return <SourceUrl key={key} url={part.url} title={part.title} />;
      case 'file':
        return <FileArtifact key={key} part={part} />;
      case 'step-start':
        return <StepDivider key={key} />;
      case 'data-plan':         return <PlanRender key={key} data={part.data} />;
      case 'data-task-status':  return <TaskStatusBadge key={key} data={part.data} />;
      case 'data-budget':       return <BudgetMeter key={key} data={part.data} />;
      case 'data-sandbox-status':   return <SandboxStatus key={key} data={part.data} />;
      case 'data-takeover':     return <TakeoverButton key={key} data={part.data} />;
      case 'data-artifact':     return <Artifact key={key} data={part.data} />;
      case 'data-quota':        return <QuotaPill key={key} data={part.data} />;
      case 'data-error':        return <ErrorCard key={key} data={part.data} />;
      default:
        // isToolUIPart() narrows to ToolUIPart — no `as any` cast needed.
        if (isToolUIPart(part)) return <ToolCall key={key} part={part} />;
        return null;
    }
  });
}, (a, b) =>
  a.message.id === b.message.id &&
  a.message.parts.length === b.message.parts.length &&
  a.isStreaming === b.isStreaming &&
  JSON.stringify(a.message.parts.at(-1)) === JSON.stringify(b.message.parts.at(-1))
);
```

#### Streamdown configuration

```tsx
// components/ai-elements/response.tsx (fork of AI Elements default)
import { useEffect, useState, type ComponentProps } from 'react';
import { Streamdown } from 'streamdown';
import { code } from '@streamdown/code';
import 'katex/dist/katex.min.css';

type Plugins = NonNullable<ComponentProps<typeof Streamdown>['plugins']>;
const BASE_PLUGINS: Plugins = { code };

export function Response({
  children, isStreaming,
}: { children: string; isStreaming?: boolean }) {
  // Code-split: KaTeX (math) + Mermaid are heavy — import() them only when the
  // content uses them. import(), never require() (Biome bans require); typed
  // via ComponentProps, never `any`.
  const [plugins, setPlugins] = useState<Plugins>(BASE_PLUGINS);
  useEffect(() => {
    const needsMath = !plugins.math && /\$\$|\\\(/.test(children);
    const needsMermaid = !plugins.mermaid && /```mermaid/.test(children);
    if (!needsMath && !needsMermaid) return;
    void (async () => {
      const next: Plugins = { ...plugins };
      if (needsMath) next.math = (await import('@streamdown/math')).math;
      if (needsMermaid) next.mermaid = (await import('@streamdown/mermaid')).mermaid;
      setPlugins(next);
    })();
  }, [children, plugins]);

  return (
    <Streamdown
      plugins={plugins}
      shikiTheme={['github-light', 'github-dark']}
      animated={isStreaming ? { animation: 'blurIn', stagger: 40 } : false}
      isAnimating={isStreaming}
      controls={{
        code: { copy: true, download: true },
        table: { copy: true, fullscreen: true },
      }}
    >
      {children}
    </Streamdown>
  );
}
```

#### Tool call rendering

```tsx
// components/chat/tool-call.tsx
import { Tool, ToolHeader, ToolInput, ToolOutput } from '@/components/ai-elements/tool';

export function ToolCall({ part }: { part: ToolUIPart }) {
  const toolName = part.type.replace('tool-', '');
  return (
    <Tool>
      <ToolHeader name={toolName} state={part.state} />
      {(part.state === 'input-streaming' || part.state === 'input-available') && (
        <ToolInput input={part.input} streaming={part.state === 'input-streaming'} />
      )}
      {part.state === 'output-available' && <ToolOutput output={part.output} />}
      {part.state === 'output-error' && <ErrorWithRetry text={part.errorText} />}
    </Tool>
  );
}
```

Tool state machine: `input-streaming → input-available → output-available | output-error`. Never collapse to one spinner — render all four states distinctly.

#### Multi-agent progress

`AgentRun` emits `data-plan` once per run and `data-task-status` as the run
advances. `apps/web/src/components/chat/message-parts.tsx` folds later task
status chunks back into the matching plan block so progress updates in place
instead of creating a noisy stack of status cards. The same data-part contract
is used by future subagent fanout work: `parallelGroups` declares grouping and
`tasks[]` carries stable task ids, titles, and statuses.

#### Prompt input

```tsx
import {
  PromptInput, PromptInputBody, PromptInputFooter, PromptInputTextarea,
  PromptInputTools, PromptInputSubmit, PromptInputActionMenu,
  PromptInputActionAddAttachments, PromptInputActionAddScreenshot,
} from '@/components/ai-elements/prompt-input';

<PromptInput onSubmit={handleSubmit} globalDrop multiple>
  <PromptInputBody>
    <PromptInputTextarea value={text} onChange={(e) => setText(e.target.value)} />
  </PromptInputBody>
  <PromptInputFooter>
    <PromptInputTools>
      <PromptInputActionMenu>
        <PromptInputActionAddAttachments />
        <PromptInputActionAddScreenshot />   {/* getDisplayMedia, new in ai-elements 1.9 */}
      </PromptInputActionMenu>
      <ModelPicker value={model} onChange={setModel} />
    </PromptInputTools>
    <PromptInputSubmit status={status === 'streaming' ? 'streaming' : 'ready'} disabled={!text.trim()} />
  </PromptInputFooter>
</PromptInput>
```

Draft persistence: debounced write of `text` to Zustand `chatSlice.draftByThread[threadId]` (300 ms). `Cmd+Enter` submit, `Esc` stop, `↑` to edit last user message.

#### Composer interaction layer (design 09b/11b/4V2-0)

Both the home composer and the thread composer share one caret-token trigger parser and a
shared popover:

- **`/` menu (skills)** — leading-`/` opens a skill autocomplete driven by the build-time
  **`generated-manifest.ts`** (name+description only; skill bodies never ship to the client).
  Selecting a skill inserts `/<skill-name> `. Reuses the `?skill=` deep-link vocabulary from
  discovery-misc (synthetic chip semantics).
- **`@` mentions (files)** — an inline `@` opens a file picker over the thread sandbox files
  route; selecting a path inserts `@<path>`, which the system prompt resolves to
  `/workspace/<path>` (§8.2). The `@` trigger registers **only when the thread sandbox is
  `ready`** (`sandboxStatus === "ready"`) — the files route lazily wakes a metered sandbox
  and has no concurrency check.
- **Model popover** — the design-5 picker (§4.2); writes the user's local model preference
  (zustand) and sends it as the per-run `model` param. It reads `useProfileQuery().disabledModels`
  to reflect disabled state; "Configure" deep-links to `/settings/agents`.
- **Project picker (home)** — routes the typed prompt into the selected project's **newest
  thread**, with an `activeRunId` busy preflight so a busy thread never loses the prompt.
- **Add menu** — Local upload + **GitHub import**. Import writes `settings.importRepoUrl`;
  the app-builder bootstrap git-clones it (public repos only, depth-1, no auto dev server,
  failure code `repo_import_failed`), with one-shot semantics gated by a
  `/workspace/app/.cheatcode-imported` marker (`.git` backstop) so follow-up runs never
  re-clone. URLs containing userinfo are rejected; private-repo support via Composio GitHub
  OAuth is the documented v1.5 upgrade path.

#### Long-thread virtualization

```tsx
// components/chat/message-list.tsx
import { useVirtualizer } from '@tanstack/react-virtual';

export function MessageList({ messages, isStreaming }: Props) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 200,                 // average message height
    overscan: 5,
  });
  return (
    <div ref={parentRef} className="h-full overflow-auto">
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((vi) => (
          <div key={messages[vi.index].id}
               style={{ position: 'absolute', top: 0, left: 0, transform: `translateY(${vi.start}px)`, width: '100%' }}>
            <Message message={messages[vi.index]} isStreaming={isStreaming && vi.index === messages.length - 1} />
          </div>
        ))}
      </div>
    </div>
  );
}
```

### 10.7 Preview panel (Activity-wrapped)

`apps/web/src/components/preview/preview-side-panel.tsx` owns the desktop preview
surface. It exposes the Bud-style tab set in this order: **Files**, **Browser**.
Each tab body is wrapped in React `<Activity>` so the app iframe and sandbox IDE
state survive tab switches. The panel opens only when the current thread has a
preview URL or a non-cold sandbox status; the close/open rail state and active
tab live in Zustand.

The Files tab requests `GET /v1/threads/{threadId}/sandbox/ide`, which starts
the per-project `code-server` toolbox process and embeds the signed preview URL
in an iframe. The legacy in-app file tree remains a fallback for old sandbox
snapshots or IDE startup failures; terminal commands still run through the
authenticated POST route and the console strip remains cursor-polled.

**Browser URL bar + console strip + phone bezel (design 22/23).** The preview URL bar shows
the **entry URL only** — cross-origin iframes hide SPA navigation, so back/refresh operate on
client-side assignment history + a reload token; **no `postMessage` navigation reporter is
injected into scaffolded user templates** (decision #11 — don't touch user code). A console
strip surfaces dev-server logs via the cursor-polling console route (§23.2 #50, never
streaming). `DeviceFrame` renders a **phone bezel** keyed by `project.mode`
(`app-builder-mobile → phone`, with the `expoUrl` fallback); other modes render flush.

### 10.8 PWA and web push are out of V2

V2 is a Cloudflare-hosted responsive web app, not an installable PWA. Do not add
Serwist, service workers, manifest routes, offline fallbacks, Web Push, VAPID
keys, push subscription tables, app-badge code, background sync, or PWA install
prompts unless `plan.md` is explicitly updated by the user.

Cheatcode-owned user notifications are out of V2. Keep transient UI feedback
local to the current screen (`sonner`, inline banners, and stream parts only);
do not add notification routes, tables, polling bridges, web push, or background
delivery unless `plan.md` is explicitly updated by the user.

### 10.9 Performance budgets

| Metric | Target | Real-user p75 measured via `web-vitals/attribution` |
|---|---|---|
| **INP** | <200 ms | Chat input, send button, scroll-to-bottom |
| **LCP** | <1.8 s | Hero / first message render |
| **CLS** | <0.05 | Skeleton-sized loaders, reserved heights |
| **TTFB** | <400 ms | Cloudflare Workers/OpenNext target |
| **FCP** | <1.5 s | Static shell via Cache Components |
| **Initial JS bundle (gz)** | ≤100 KB | Route `/` |
| **Per-route JS (gz)** | ≤80 KB | On top of shared chunk |
| **Total parsed JS on chat route** | ≤350 KB | Including AI Elements + Streamdown |
| **First message render after submit** | <300 ms | useOptimistic + SSE first chunk |
| **Stream resume latency (1000 buffered parts)** | <300 ms | From §24.7 DO target |

**INP optimization techniques actively applied:**

1. **`<Activity mode="hidden">`** on preview tabs and sidebar panels — deprioritizes hidden updates, removes useEffect work when invisible
2. **`startTransition`** wrapping non-critical state setters (e.g., `setActiveTab` inside a click handler runs synchronously; the derived UI updates are transitioned)
3. **`useDeferredValue`** on chat input → derived markdown renders (typing stays responsive)
4. **`scheduler.yield()` polyfill** (or React's `unstable_yieldValue`) inside long event handlers
5. **CSS `:active`/`:focus` states** for visual feedback instead of JS-driven `setState`
6. **Granular `<Suspense>` boundaries** per logical section (sidebar, message list, prompt input)
7. **`experimental_throttle: 50`** on `useChat` — caps stream re-renders at 20/sec
8. **`React.memo` on Message components** with custom equality (id + parts length + last part text)
9. **Virtual scrolling** with TanStack Virtual when threads exceed ~50 messages

**Bundle hygiene:**

- `@next/bundle-analyzer` runs in CI on PR; fail build if any route grows >10% over `main`
- Named imports only (no barrel re-exports in our own code — they kill tree-shaking)
- `lucide-react` icons imported via `@/components/ui/icons` re-export of only what we use
- Lazy-load heavy deps: PDF.js, Mermaid (via Streamdown plugin), Recharts, react-pdf, and any future pinned preview/editor dependency

**RUM setup:**

```ts
// lib/rum.ts
'use client';
import { onCLS, onINP, onLCP, onFCP, onTTFB } from 'web-vitals/attribution';
import type { Metric } from 'web-vitals';
import { env } from '@cheatcode/env';

const queue = new Set<Metric>();

function flush() {
  if (queue.size === 0) return;
  navigator.sendBeacon(`${env.NEXT_PUBLIC_GATEWAY_URL}/v1/vitals`, JSON.stringify([...queue]));
  queue.clear();
}

const report = (metric: Metric) => { queue.add(metric); };

// Called once from <ClientObservability /> (§13.8) — exported as a function so
// the module has no top-level side effects (Biome noTopLevelSideEffects).
export function initWebVitals() {
  onCLS(report); onINP(report); onLCP(report); onFCP(report); onTTFB(report);
  addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
}
```

`web-vitals/attribution` gives DOM element selectors for the worst INP interactions — invaluable for diagnosing Streamdown re-render culprits. Metrics are `Metric`-typed (no `any`) and beacon to the gateway `/v1/vitals` route (§23.2 #36).

### 10.10 Accessibility (WCAG 2.2 AA)

| Concern | Implementation |
|---|---|
| Streaming text + screen readers | `<div role="log" aria-live="polite" aria-atomic="false">` wrapping message body. **Throttle announcements to 500 ms** — raw token-by-token causes screen-reader fatigue |
| Status changes ("Agent thinking", "Tool calling", "Done") | Separate small `aria-live="polite"` region; never `assertive` |
| "Skip to final answer" link | Visible to screen readers once stream completes |
| Keyboard shortcuts | `Cmd+Enter` send, `Esc` abort, `/` focus prompt, `Cmd+K` command palette, `↑` recall last message |
| Focus management on modals | Radix Dialog auto-traps focus + returns on close |
| Focus on new message | **Do NOT steal focus** — user may be reading mid-stream |
| Icon buttons | All require `aria-label`; enforced via Biome custom rule + manual review |
| Code blocks (Shiki) | Default `github-light` / `github-dark` themes — both ≥4.5:1 contrast. Custom themes audited before adoption |
| Reduced motion | All framer-motion animations wrap in `useReducedMotion()`; Streamdown's blur-in disabled when `prefers-reduced-motion: reduce` |
| Skip links | `<a href="#main" className="sr-only focus:not-sr-only">Skip to main</a>` in root layout |
| Form labels | shadcn `<FormLabel>` wires `htmlFor`; errors via `aria-describedby` (FormMessage) |
| Color contrast | Both light + dark mode tested ≥4.5:1 (AA) for body text, ≥3:1 for large text |

**Testing approach:**
- Final product QA uses direct `agent-browser` UI operation, keyboard traversal,
  snapshots, screenshots, console/resource inspection, and app-log review.
- Manual VoiceOver (Mac/iOS) + NVDA (Windows) before every major release.
- Streaming text live region throttled at 500 ms — validated with real screen readers.

### 10.11 Theming + dark mode

```css
/* app/globals.css */
@import "tailwindcss";
@source "../node_modules/streamdown/dist/*.js";
@source "../node_modules/ai-elements/dist/*.js";

@theme {
  --color-brand-50:  oklch(0.97 0.02 280);
  --color-brand-500: oklch(0.65 0.18 280);
  --font-display: var(--font-geist-sans);
  --font-mono: var(--font-geist-mono);
  --radius-card: 0.75rem;
}

@variant dark (&:where(.dark, .dark *));

:root {
  --background: 0 0% 100%;
  --foreground: 222 47% 11%;
  --card: 0 0% 100%;
  --card-foreground: 222 47% 11%;
  --primary: 222 47% 11%;
  --primary-foreground: 210 40% 98%;
  --muted: 210 40% 96%;
  --muted-foreground: 215 16% 47%;
  --border: 214 32% 91%;
  --input: 214 32% 91%;
  --ring: 222 84% 5%;
  --destructive: 0 84% 60%;
  --success: 142 76% 36%;            /* added — not in default shadcn */
}

.dark {
  --background: 226 58% 4%;          /* not pure black — eliminates OLED halation */
  --foreground: 210 40% 98%;
  --card: 224 71% 5%;
  --primary: 210 40% 98%;
  --muted: 217 33% 17%;
  --border: 217 33% 17%;
  /* ... rest of 12-slot semantic palette */
}
```

```tsx
// app/layout.tsx
import { ThemeProvider } from 'next-themes';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';

<html lang="en" suppressHydrationWarning className={`${GeistSans.variable} ${GeistMono.variable}`}>
  <body>
    <ClerkProvider>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
        <QueryClientProvider client={queryClient}>
          {children}
          <Toaster />
        </QueryClientProvider>
      </ThemeProvider>
    </ClerkProvider>
  </body>
</html>
```

`disableTransitionOnChange` prevents the flash when toggling themes.

**Theme ownership + unlock.** Theme is owned entirely by **next-themes** (localStorage key
`theme`), not zustand persist (§10.5). The previously hard-coded `forcedTheme` is
**removed**, and `defaultTheme="system"` with `enableSystem` lets the OS preference win until
the user picks Light/Dark/System in the theme switcher. The switcher writes through
next-themes' `setTheme`; no other store mirrors it.

**Light-theme readiness audit (restyle deferred).** The semantic-token rule is binding:
components must use semantic tokens (`bg-background`, `text-foreground`, `border-border`, …),
**never raw palette classes** (e.g. `bg-zinc-900`), so the unlocked light theme renders
correctly. A migration inventory of **17 files / 196 raw-palette occurrences** is recorded as
readiness work; a review rule rejects new raw palette classes in components. The visual
light-theme pass itself is deferred to the Bud UI round — this round only unlocks the toggle
and lands the audit.

### 10.12 Internationalization (V1: English-only, architected for future)

We ship V1 in English only but use `next-intl` from day one with a single `en.json`. Retrofitting i18n later is 10× harder than starting with it.

```ts
// lib/intl/request.ts
import { getRequestConfig } from 'next-intl/server';

export default getRequestConfig(async () => {
  return {
    locale: 'en',
    messages: (await import('./messages/en.json')).default,
  };
});

// Tailwind: use logical properties (`ms-4` not `ml-4`, `start-0` not `left-0`)
// so RTL flips automatically when we add Arabic/Hebrew
```

Numbers/dates/currency via `Intl.NumberFormat`, `Intl.DateTimeFormat`, `Intl.RelativeTimeFormat` — never hand-format. Pluralization via ICU MessageFormat (next-intl built-in).

**Defer second locale until ≥5k MAU justifies it.**

### 10.13 Error handling

```tsx
// app/(app)/error.tsx — route-segment error boundary (must be Client)
'use client';
import { Button } from '@/components/ui/button';
import { useEffect } from 'react';

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => { reportError(error); }, [error]);
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4">
      <h2>Something went wrong</h2>
      <p className="text-muted-foreground">{mapErrorToFriendly(error)}</p>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
```

```tsx
// app/global-error.tsx — must include <html> + <body>
'use client';
export default function GlobalError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <html>
      <body>
        <div>Critical error: {error.message}</div>
        <button onClick={reset}>Reset</button>
      </body>
    </html>
  );
}
```

**Error sources mapping:**
- Mid-stream `data-error` part → inline `<ErrorCard onRetry={regenerate} />`
- `useChat` `onError` callback → `toast.error(mapErrorToMessage(err))`
- Uncaught component error → segment `error.tsx`
- Network disconnect → `ConnectionStatusPill` in chat panel header
- Offline state → `window.addEventListener('online'/'offline')` → Zustand `connectionSlice.online` → banner "You're offline. Past threads available; new runs paused."

```ts
// lib/stream/error-mapping.ts
export function mapErrorToMessage(err: Error): string {
  const msg = err.message;
  if (msg.includes('quota_exhausted')) return 'You\'ve hit your monthly limit. Upgrade or wait until reset.';
  if (msg.includes('rate_limit')) return 'Slow down a bit — try again in a moment.';
  if (msg.includes('sandbox')) return 'Your sandbox is rebooting. Hold tight.';
  if (msg.includes('byok')) return 'Your provider key is invalid. Update it in Settings.';
  return 'Something went wrong. Try again.';
}
```

### 10.14 QA strategy

This section overrides every older test/QA reference in this document and in
preserved V1 notes: no product-flow validation script is allowed even if a
milestone, checklist, or inherited note mentions tests, smoke checks, harnesses,
or E2E.

Product/acceptance testing is real browser operation only. After Weeks 1-8 are
implemented in code, use `agent-browser --auto-connect --session cheatcode-debug`
directly against the final local/preview stack: open the app, snapshot
interactive refs, click/fill/type through auth, project chat, streaming,
preview/files/data/env tabs, settings, billing, BYOK, integrations, and mobile
layouts, then re-snapshot after each navigation or DOM mutation. Capture
screenshots for meaningful milestones, inspect console and visible
network/resource behavior, and review the running Next/Wrangler/Worker/Blaxel
logs. Do not use `pnpm run`, package scripts, files under `scripts/`, `/tmp`
helpers, generated Node/Python/TypeScript files, copied shell snippets, command
loops, or aliases as product tests. No custom script may drive prompts, clicks,
auth flows, acceptance flows, accessibility passes, load checks, browser
sessions, or final E2E. Do not make a throwaway shell, TypeScript, Node,
Python, Playwright, Stagehand, or `agent-browser` wrapper for QA; operate the UI
directly and read logs.
For product QA, the only permitted automation surface is the direct
`agent-browser` CLI invocation itself. Never use a script, wrapper, generated
runner, prompt driver, curl loop, Playwright/Stagehand harness, or package
command to test product behavior. If validating behavior requires user-like
interaction, click and type through the UI and inspect console/network/app logs.
Service-start commands may only bring up the app and Workers; they do not count
as testing and must not contain product assertions, prompt submission, browser
driving, or hidden flow automation.

Typecheck, lint, and build remain code-health gates, not product tests. V2 intentionally has no
source-level Vitest specs, checked-in browser test specs, package `test` scripts, Turbo `test` task, smoke
scripts, E2E scripts, prompt-submission harnesses, load drivers, accessibility
drivers, or scripted browser QA. Do not add a script that performs validation
by simulating product flows unless the user explicitly restores scripted
testing in this plan. If any validation script, throwaway prompt driver,
browser wrapper, generated QA runner, or scripted acceptance helper appears in
V2, delete it immediately instead of running it. The deletion requirement is not
optional cleanup: no product testing script may remain checked in, hidden under
a package alias, kept in `/tmp`, or recreated out-of-tree. Do not create
temporary scripts in `scripts/`, package folders, `/tmp`, or any out-of-tree
location to test the product. The testing workflow is direct UI operation and
log review only; do not write scripts outside the repo to bypass this rule.
Do not use shell loops, chained prompt drivers, copied command snippets, local
browser driver files, or one-off curl runners as a substitute for UI clicks.
Product testing is the transcript-visible UI operation itself. Operational
build/deploy/migration/secret-sync helpers may remain, but they are never
acceptance evidence and must not click, submit prompts, perform auth, inspect
accessibility, run load, or simulate user flows. Stale QA artifact folders and
root screenshot artifacts from earlier runs, including `.qa/` and `qa-*.png`,
must be deleted; final screenshots belong only to the direct browser QA evidence
collected at the end of the all-weeks build, not checked into the V2 source
tree.
This is a hard user override, not a preference: never use scripts for product
testing. If a product QA task cannot be proven by direct UI interaction plus
console/network/app-log review, it is not accepted for V2.
Latest user directive from May 28, 2026: implement the all-weeks V2 code surface
first, then run the final product QA only by clicking/filling/typing through the
real UI with direct `agent-browser --auto-connect --session cheatcode-debug`
commands and by reading console/network/app logs. Do not create interim scripts
to submit prompts, automate flows, wrap `agent-browser`, run curl requests, or
collect acceptance evidence; delete any such script on sight.
May 28, 2026 testing override: product testing is never performed through a
script, package command, wrapper, helper file, curl flow, shell loop, generated
browser driver, or out-of-tree shortcut. Use the UI directly with
`agent-browser`, click/fill/type every flow, take screenshots directly, inspect
console/network output directly, and read app logs directly. Delete product
testing scripts instead of running them. Operational scripts may exist only for
non-QA implementation chores such as starting services, building artifacts,
migrations, secret sync, Docker cleanup, and guarded deploy/admin work.
Every future use of the word "test", "testing", "smoke", "E2E", "QA",
"validation", or "acceptance" for product behavior in this plan means this
direct UI/log workflow only. Do not interpret any milestone checklist, package
README, CI note, or inherited V1 habit as permission to create a shortcut
script. If repetition would be faster with a helper, repeat the visible
`agent-browser` actions instead so the transcript remains the evidence.
Legacy V1 tests under `cheatcode/` are not part of V2 validation. They remain
only because V1 is preserved by explicit user instruction; they must not be run
or copied forward while implementing V2.

### 10.15 Frontend anti-patterns we explicitly avoid

1. **`useEffect` for data fetching** — TanStack Query or Server Components
2. **One mega Zustand store** — slices, each ≤200 LOC
3. **Context for frequently-changing values** — Zustand or TanStack Query (Context re-renders all consumers)
4. **Premature `React.memo` / `useMemo` everywhere** — measure first with React 19.2 Performance Tracks (React Compiler handles most for free now)
5. **`'use client'` at the top of every file** — push as deep as possible
6. **Fetching at layout level** when only one child needs it — move to leaves
7. **Trusting client-passed `userId` / `orgId`** — always re-derive from `auth()` in Server Actions
8. **In-memory rate limiting on serverless** — breaks across replicas (we use DO-backed)
9. **Introducing parallel route slots without `default.tsx`** — Next 16 builds fail
10. **Manual `EventSource`** — `useChat` with custom transport handles it
11. **Lifting state into Server Components** — always pass props down; RSC has no client state
12. **Hand-rolled date/number formatting** — always `Intl.*` (i18n-ready)
13. **Pure-black `#000` background in dark mode** — causes OLED halation; use `oklch(0.10 0.02 226)`
14. **Stealing focus on new message** — kills screen-reader UX
15. **Live-region announcements at token-by-token rate** — throttle to 500 ms minimum

### 10.16 Locked frontend decisions for V1

1. **Cache Components ON in `next.config.ts`**, but user-scoped project/thread data stays in authenticated gateway calls through TanStack Query; no bearer-token data behind public RSC cache tags
2. **`middleware.ts`** gates `/projects/*`, `/settings/*`, `/skills/*` via `clerkMiddleware`; keep it as Edge Middleware until OpenNext Cloudflare supports Next 16 `proxy.ts`.
3. **Single `/projects` surface** owns query-state bootstrap and renders the V1 split chat + preview layout; preview sub-tabs stay mounted via `<Activity mode>` inside `PreviewSidePanel`
4. **State separation**: TanStack Query 5 (server) + Zustand 5 slices (client) + `nuqs` (URL) + RHF+Zod (complex forms) / `useActionState` (simple). Persist theme + UI prefs only
5. **`useChat<CheatcodeUIMessage>`** with `DefaultChatTransport` (SSE, absolute gateway URL), `resume: false` on mount to avoid AI SDK v6 duplicate 204 reconnect races, `experimental_throttle: 50`, mandatory `visibilitychange` listener calling `resumeStream()` during active in-memory streams
6. **Render messages via `message.parts`** discriminated switch — never `message.content`
7. **Streamdown 2.5** for streaming text with lazy-loaded math/mermaid plugins (string-detect before mounting)
8. **AI Elements** for `Conversation`, `Message`, `Response`, `Tool`, `Plan` + `Task`, `Sandbox` + `SandboxTabs`, `Artifact`, `PromptInput` + `PromptInputActionAddScreenshot`
9. **Tool lifecycle** rendered for all four states (`input-streaming`, `input-available`, `output-available`, `output-error`)
10. **Virtual scrolling** with TanStack Virtual for threads >50 messages; `React.memo` on Message with custom equality
11. **Responsive web app only** — no PWA, service worker, offline fallback, web push, app badge, or install prompt in V2
12. **INP target ≤200 ms** — `<Activity>` for hidden panels, `startTransition` for derived state, `useDeferredValue` on input → markdown, granular Suspense
13. **RUM**: `web-vitals/attribution` → gateway `/v1/vitals` via `sendBeacon` on visibility hidden
14. **A11y**: WCAG 2.2 AA. `aria-live="polite"` throttled at 500 ms. Final direct `agent-browser` keyboard/snapshot pass plus manual VoiceOver pass per release
15. **i18n**: `next-intl` from day one, single `en.json`. Logical Tailwind properties (`ms-`/`me-`). Defer second locale until ≥5k MAU
16. **Theming**: next-themes + shadcn 12-slot semantic CSS variables in raw HSL + `disableTransitionOnChange` + custom `--success` slot
17. **Errors**: route-level `error.tsx` + `global-error.tsx` with `<html>`/`<body>` + Sentry-free Workers Logs reporting + offline banner driven by Zustand `connectionSlice.online`
18. **Bundles**: ≤100 KB gzipped initial, ≤350 KB total parsed JS on chat route. `@next/bundle-analyzer` blocks CI if route grows >10% PR-over-PR
19. **Testing**: final product QA is direct `agent-browser` UI operation plus console/network/app-log review. Stagehand is only for in-sandbox browser-tool behavior. Visual evidence comes from `agent-browser screenshot`; no checked-in custom scripts or package `test` scripts drive prompts, clicks, auth flows, acceptance flows, load flows, accessibility passes, browser sessions, or final E2E.
20. **Pin exact**: `ai@6.0.182`, `@ai-sdk/react@3.0.184`, `@ai-sdk/google@3.0.80`, `ai-elements@1.9.0`, `streamdown@2.5.0`, `remend@1.3.0`, `next@16.2.6`, `react@19.2.6` — to avoid known resume/duplicate/Shiki crash bugs

---

## 11. Feature → Architecture Mapping

All V1 features mapped to packages/services:

| Feature | Where it lives |
|---|---|
| **A1–A4 slides/PDF/DOCX/Excel** | `packages/tools-docs` → `sandbox.runCode` w/ pptxgenjs/docx/exceljs/react-pdf → R2 |
| **A5 LaTeX** | Deferred out of V1; no `skills/latex-doc` ships unless this plan is explicitly expanded |
| **A6–A8 newsletter/resume/pitch-deck** | Skills invoking A1-A4 (`skills/pitch-deck` is V1) |
| **B1, B5, B6 CSV/stats/charts** | `packages/tools-data` → Arquero + sandbox Python + Recharts SSR |
| **B2 dashboards** | Recharts components rendered in sandbox dev server, hosted at preview URL |
| **B3 DB connector** | Cut from V1; listed in `future.md` as a v1.5 candidate. V1 ships CSV/stat/chart data tools only. |
| **B7 web-scrape→CSV** | `packages/tools-research` Firecrawl + Arquero |
| **B8 PDF extraction** | Deferred out of V1. V1 keeps LlamaParse as a validated BYOK provider slot only; no `skills/pdf-analyze` runtime ships |
| **B9 A/B test analyzer** | Deferred out of V1 unless implemented through the existing CSV/deep-research tools by prompt |
| **C1 deep research** | `packages/agent-core/workflows/deep-research.ts` Mastra Workflow |
| **C2 deep research fan-out** | `packages/agent-core/workflows/deep-research-fanout.ts` (fanout 25) |
| **C3 company intel** | Skill (`skills/competitor-brief`) using Exa company category + Firecrawl |
| **C6/C7/C8 fact-check/trends/multi-lang** | Skills |
| **D1, D3, D4 writing variants** | Composable with C1/C2 — agent picks length/tone via prompt |
| **D2/D5/D6/D7 tech-docs/outreach/book/script** | Skills |
| **D8 translation** | Free with model — no special infra |
| **E1 image gen** | Deferred out of V1; no Fal vendor/API ships |
| **E2 image edit** | Deferred out of V1; no Fal vendor/API ships |
| **E3 video gen** | Deferred out of V1; no Fal vendor/API ships |
| **E4 voice TTS** | Deferred out of V1; no ElevenLabs vendor/API ships |
| **E5 music** | Deferred out of V1; no Suno vendor/API ships |
| **E6 transcription** | Deferred out of V1; no ElevenLabs vendor/API ships |
| **E7-E9 logo/carousel/thumbnail** | Skills |
| **E10 avatar video** | Deferred out of V1; no HeyGen vendor/API ships |
| **F1 browser tool** | `packages/tools-browser` Stagehand v3 LOCAL |
| **F2 user takeover** | x11vnc + websockify + noVNC iframe |
| **F3 auth scraping** | Covered by F2 (session persists in container) |
| **F4 form fill at scale** | F1 + iterator pattern |
| **F5-F7 booking/leads/ecom** | F1 use cases via templates |
| **F8 visual QA of own app** | F1 against `sandbox.exposePort()` URL |
| **K2 personal facts** | Future explicit V2 personalization table; not Mastra Memory |
| **K4 codebase wiki** | Manual Workflow indexes `sandbox.list()` → R2 markdown |
| **K7 skills/AGENTS.md** | `skills/` folder + `packages/skills` loader |
| **M2 deep research fan-out** | Same workflow as C2 |
| **M3 live VM view** | `apps/web/src/components/preview/preview-side-panel.tsx` tabs: Preview, Code, Terminal, Browser |
| **M12 budget caps** | Mastra `stopWhen` + per-run cost check + UI to set per-project (menu: No cap/$2/$5/$10/Custom≤$50, §8.7) |
| **Onboarding (5-screen)** | `v2_user_profiles` + middleware gate + Clerk `metadata` claim (§29.2) |
| **Account plan card + sandbox-hours meter** | `GET /v1/me/usage` + `GET /v1/billing/catalog` + per-run Activity punchcard (§28.10) |
| **Model picker (design-5) + per-surface defaults** | `packages/types/src/models.ts` catalog + composer popover + profile defaults (§4.2) |
| **Tool approval gate + interactive fallback + reconnect banner** | `withApprovalGate` + AgentRun DO paused state + `data-approval-*`/`data-model-fallback` (§8.6, §23.5) |
| **Composer `/` + `@` menus / project picker / Add menu + GitHub import** | shared caret-token parser + `settings.importRepoUrl` clone (§10.6) |
| **Search / ⌘K palette** | `GET /v1/search` + `cmdk` palette over `WORKSPACE_NAV` (§23.2 #51) |
| **Time/weather greeting** | `GET /v1/greeting` + Open-Meteo (gateway-only, Cache-API, §10.6) |
| **Skills catalog (search/tabs/Use) + `/101` docs + ASCII 404 + confirm dialog + sidebar IA** | `generated-manifest.ts` + `?skill=` deep-link + in-app content route + `packages/ui` `ConfirmDialog` + `WORKSPACE_NAV` registry (discovery-misc) |
| **Theme switcher** | next-themes localStorage, `defaultTheme="system"`, no `forcedTheme` (§10.11) |
| **Preview console strip + URL bar + phone bezel** | `GET /v1/threads/:id/sandbox/console` (cursor-poll), entry-URL-only bar, `DeviceFrame` by `project.mode` (§23.2 #50) |

---

## 12. Skills System

Skills are filesystem-based agent extensibility — folders containing `SKILL.md` (YAML frontmatter + markdown body) plus optional `references/` and `assets/`. They follow the open Anthropic format (`agentskills.io` spec) so the content stays portable, but V2 ships them only as an in-product bundled catalog. V2 deliberately does **not** bundle skill scripts, local skill eval fixtures, public registry exports, or external skills.sh publishing flows.

**Why skills (vs tools or pure prompts):**
- **Tools** are single deterministic operations with structured I/O — generated by `tool()` in code.
- **Skills** are multi-step procedures with judgment, defaults, and gotchas — written as markdown.
- **Always-on prompts** (system prompt + AGENTS.md) cost tokens on every turn — skills only load when relevant.

This section is the playbook for writing high-quality skills, not generic stubs. Every V1 skill ships with focused instructions, references, assets when needed, and counter-examples inside the markdown body.

### 12.1 Anatomy + file layout

```
skills/<skill-name>/
├── SKILL.md              # required: YAML frontmatter + markdown body
├── references/           # optional: deeper docs loaded on demand
│   ├── pptxgenjs.md
│   └── market-sizing.md
├── assets/               # optional: templates, fonts, schemas
│   └── templates/
│       └── seed.json
└── LICENSE
```

**Naming:** directory name === `name` in frontmatter, lowercase + digits + hyphens, 1–64 chars, no leading/trailing/consecutive hyphens, no `anthropic` or `claude` prefixes.

**Size budgets (Anthropic's explicit targets):**
- `description` in frontmatter: **~100 tokens, hard cap 1024 chars**. Critical activation field.
- `SKILL.md` body: **under 500 lines / ~5,000 tokens**. The whole body enters context on activation and stays there.
- `references/*.md`: unlimited individually; keep ≤300 lines each, add TOC if >100 lines.
- `assets/`: effectively unbounded (don't consume context until read).

### 12.2 Frontmatter spec (the open `agentskills.io` standard)

```yaml
---
name: pitch-deck                    # required, must match dir
description: |                       # required, ≤1024 chars; THE activation field
  Generates investor-ready pitch decks (.pptx) from a one-line idea or written brief.
  Performs market sizing, competitor scan, and TAM/SAM/SOM with citations, then produces
  10–14 designed slides. Use when the user asks for a pitch deck, investor deck,
  fundraising deck, demo day deck, seed deck, or says "turn this idea into a deck".
  Do NOT trigger for internal product updates (use slide-from-prd) or non-investor
  presentations.
category: build                      # required (3-value enum: build | research | create) — drives /skills tabs
tags: [slides, pitch, fundraising]  # required — string[], powers /skills search
license: MIT                         # optional, free-form
compatibility: Requires Node 22+ (pptxgenjs), Python 3.11+ (pandas), and Exa + Firecrawl tools.
metadata:                            # optional, arbitrary k/v
  author: cheatcode
  version: "1.0.0"
---
```

**Stay on the open spec.** Claude-Code-only extensions (`when_to_use`, `allowed-tools`, `paths`, `arguments`, `shell`) won't portably work in Mastra. Stick to `name`, `description`, `license`, `compatibility`, `metadata`, plus the Cheatcode-required `category` (3-value enum) and `tags` (which feed the `/skills` catalog tabs + search, discovery-misc).

### 12.3 Writing the description (the activation field)

The description is the **only thing in the system prompt at startup** — it's how the agent decides whether to load a skill. If it's weak, the skill never fires.

**Format that works (proven across all of Anthropic's official skills):**

```
[What it does — 1-2 sentences in third person, listing verbs and outputs]
Use when [the user phrases or intents that should trigger this — 4-8 trigger words].
Do NOT trigger [adjacent intents that belong to other skills].
```

**Six rules:**

1. **Third person, never first/second.** "Generates…" / "Extracts…" not "I help with…" or "You can use this to…".
2. **Two halves: what + when.** What the skill produces, then when to invoke it.
3. **List trigger surface words.** "deck", "slides", "presentation", ".pptx" — the actual nouns/verbs users say.
4. **Front-load the dominant use case** in the first ~120 chars. Truncation happens.
5. **Negative-scope adjacent skills** when ambiguity exists. "Do NOT trigger when the deliverable is X (use the Y skill instead)."
6. **Be pushy, not subtle.** Anthropic's own skill-creator recommends *"Make sure to use this skill whenever the user mentions…"* — don't undersell.

**Calibration — real Anthropic descriptions:**

| Skill | Length | What works |
|---|---|---|
| `pptx` (Anthropic) | ~700 chars | Aggressive triggers, "if a .pptx file needs to be opened, created, or touched, use this skill" |
| `pdf` (Anthropic) | ~500 chars | Enumerates every verb (read/merge/split/rotate/watermark/fill/encrypt/OCR) |
| `xlsx` (Anthropic) | ~1000 chars | Longest — has explicit negative-scope clauses |
| `skill-creator` | ~340 chars | Lists triggers explicitly ("create a skill", "edit a skill", "improve a skill description") |

**Anti-patterns:**
- "Helps with documents" — never triggers
- "Processes data" — too vague
- "Does stuff with files" — useless

**Description review loop** (manual, no local runner): inspect the description
against representative user phrasing in the PR/review notes and verify real
skill routing only through the final Cheatcode UI QA gate. V1 has no
`evals/evals.json`, `run_loop.py`, local skill-eval scripts, prompt harnesses,
or package test scripts for skill validation.

### 12.4 Body structure conventions

Once activated, the entire body enters context. Every token competes with conversation state. Conventions distilled from the 10+ canonical Anthropic skills:

**Standard section order:**

```markdown
# Skill Name

[One-paragraph overview — what success looks like.]

## Quick Start

[1-paragraph recipe + 1 code block. Model should see a working path within first 30 lines.]

## [Procedure / Workflow / Process]

[Numbered steps with checklists. Include defaults so model doesn't design from scratch.]

## [Domain-specific sections]

[Design Standards / Reference Tables / Gotchas / Common Mistakes — content unique to this skill.]

## QA / Validation

[How to verify the output is good. Often includes a visual-inspection subagent loop.]

## Deliverables

[Explicit outputs: filenames + locations.]

## References

[Table of bundled files and WHEN to read each.]

## Dependencies

[Tools, libraries, runtime requirements.]
```

**Tone rules:**

- **Imperative, terse, directive.** "Run X." "Compute Y." "Use Z."
- **`why` over `MUST`.** Brief explanations of intent outperform rigid commands. Reserve ALL-CAPS (`CRITICAL`, `NEVER`, `ALWAYS`) for genuine cliffs only.
- **Tables and counter-examples beat prose.** "Don't do X because Y" prevents predictable failure modes more reliably than 5 paragraphs of guidance.
- **One level deep on references.** Never `SKILL.md → A.md → B.md`. Always `SKILL.md → A.md` direct.

**The Gotchas section is the highest-value content per the open spec.** Concrete environmental facts that defy assumptions:
- "Unicode subscripts render as black boxes in pdf — use ASCII or LaTeX"
- "Many startup categories have no clean TAM data — do bottoms-up and show your work"
- "Never use accent lines under titles — hallmark of AI slop"

**Counter-examples ("don't do this") are gold.** The `pptx` skill has a whole "Avoid (Common Mistakes)" section; the `docx` skill marks pitfalls with ✅/❌. These pre-empt failure modes the model otherwise hits.

**Examples pattern** (from skill-creator):
```
**Example 1:**
Input: <user phrasing>
Output: <expected text/code/structure>
```

### 12.5 No bundled skill scripts or local evals

V2 skills are markdown instructions plus optional references/assets only. There
is no `skills/*/scripts/` directory, no `skills/*/evals/` directory, no
`skill_run_script` Mastra tool, and no local skill-eval runner. If deterministic
work is needed, the agent uses first-class tools (`runCode`, `data_analyze_csv`,
`docs_generate_*`, `research_*`, `browser_*`, etc.) or writes request-specific
code in the project sandbox through normal sandbox tools.

This keeps product behavior visible in the conversation and prevents hidden
validation paths. Product QA and skill routing are verified only in the final
direct `agent-browser --auto-connect --session cheatcode-debug` UI pass, with
browser console/resource review and app/platform log review. Any checked-in or
temporary skill script, prompt harness, browser wrapper, local skill eval, or
acceptance helper that appears in V2 must be deleted rather than run.

### 12.6 Activation + loading mechanics

```
Session start:
  Loader builds system prompt with frontmatter of all 9 skills (~900 tokens)
  Format: "- pitch-deck: [description]\n- deep-research: [description]\n..."

User: "Build me an investor deck for my AI startup"
  Agent matches intent against descriptions → decides to use `pitch-deck`
  Agent calls tool: skill_invoke({ skillName: 'pitch-deck' })
  Skill body returned → enters context for rest of turn
  Body says: "Step 1: create an outline" → agent drafts it in conversation
  Body says: "Step 2: read references/pptxgenjs.md if customizing" → conditional read

Subsequent user turns in same conversation:
  Body stays in context (no re-fetch needed)
```

**Token budget at scale:** With 9 skills × ~100 tokens each in the system prompt = ~900 tokens. We can scale to 100 skills before description bloat becomes meaningful. Anthropic's truncation cap is 1,536 chars combined `description` + `when_to_use` per skill.

**Activation gate.** Per Anthropic's skill-creator: *"Claude only consults skills for tasks it can't easily handle on its own — simple, one-step queries like 'read this PDF' may not trigger a skill even if the description matches perfectly. Complex, multi-step, or specialized queries reliably trigger skills."*

### 12.7 Skill loader for Cloudflare Workers (build-time bundling)

**Cloudflare Workers have no filesystem at runtime** — we can't use `node:fs` to read `SKILL.md` files. Solution: **bundle all skills at build time** into a generated TypeScript module.

**Build script** (`scripts/build-skills.ts`):

```ts
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';

interface BundledSkill {
  name: string;
  description: string;
  category: 'build' | 'research' | 'create';   // required — /skills tabs
  tags: string[];                               // required — /skills search
  license?: string;
  compatibility?: string;
  metadata: Record<string, unknown>;
  body: string;
  references: Record<string, string>;
  assets: Record<string, string>;       // assets get base64 if binary
}

function readDir(dir: string): Record<string, string> {
  try {
    return Object.fromEntries(
      readdirSync(dir).map(f => [f, readFileSync(join(dir, f), 'utf-8')])
    );
  } catch {
    return {};
  }
}

const SKILLS_DIR = './skills';
const OUT = './packages/skills/src/generated.ts';

const skills: BundledSkill[] = readdirSync(SKILLS_DIR)
  .filter(s => statSync(join(SKILLS_DIR, s)).isDirectory())
  .map(slug => {
    const raw = readFileSync(join(SKILLS_DIR, slug, 'SKILL.md'), 'utf-8');
    const { data, content } = matter(raw);
    return {
      name: data.name,
      description: data.description,
      license: data.license,
      category: data.category,
      tags: data.tags ?? [],
      compatibility: data.compatibility,
      metadata: data.metadata ?? {},
      body: content,
      references: readDir(join(SKILLS_DIR, slug, 'references')),
      assets: readDir(join(SKILLS_DIR, slug, 'assets')),
    };
  });

writeFileSync(
  OUT,
  `// AUTO-GENERATED by scripts/build-skills.ts — do not edit\n` +
  `import type { BundledSkill } from './types';\n\n` +
  `export const SKILLS: BundledSkill[] = ${JSON.stringify(skills, null, 2)};\n`
);

// Second artifact: a client-safe manifest (name/description/category/tags only — NO body).
// Exported as `@cheatcode/skills/manifest`; the composer `/` menu and the /skills catalog
// import this so skill bodies never ship in client bundles (composer-interactions).
const manifest = skills.map(({ name, description, category, tags }) =>
  ({ name, description, category, tags }));
writeFileSync(
  './packages/skills/src/generated-manifest.ts',
  `// AUTO-GENERATED by scripts/build-skills.ts — do not edit\n` +
  `import type { SkillManifestEntry } from './types';\n\n` +
  `export const SKILL_MANIFEST: SkillManifestEntry[] = ${JSON.stringify(manifest, null, 2)};\n`
);

console.log(`Bundled ${skills.length} skills → ${OUT} (+ generated-manifest.ts)`);
```

**`/skills` catalog (discovery-misc):** the catalog page reads `SKILL_MANIFEST`, offering
**search** (over name/description/tags), **category tabs** (build/research/create), and a
**Use** action that deep-links to `/?skill=<bundled-skill-name>`. Home validates the
`?skill=` param against bundled names and primes the composer (activate the matching intent
pill, else show a synthetic removable skill chip). This `?skill=` contract is the same
vocabulary the composer-interactions `/` autocomplete consumes — no second param.

Run at build time:
```bash
pnpm skills:build
```

Wire into Turborepo `build` task — depends on `skills:build`. Do not cache this task:
deleted or renamed skills must regenerate `generated.ts` deterministically on every build.

**Runtime loader** (`packages/skills/src/index.ts`):

```ts
import { SKILLS } from './generated';
import type { BundledSkill } from './types';

export type { BundledSkill };
export { SKILLS };

export function buildSystemPromptSection(skills: BundledSkill[] = SKILLS): string {
  return [
    '## Available Skills',
    '',
    'You have access to the following skills. Match user requests to these descriptions, then invoke `skill_invoke` with the matching name to load detailed instructions.',
    '',
    ...skills.map(s => `- **${s.name}**: ${s.description}`),
  ].join('\n');
}

export function getSkillByName(name: string): BundledSkill | undefined {
  return SKILLS.find(s => s.name === name);
}
```

**`skill_invoke` tool** (`packages/agent-core/src/mastra/tools/skill-invoke.ts`):

```ts
import { tool } from 'ai';
import { z } from 'zod';
import { SKILLS, getSkillByName } from '@cheatcode/skills';

const skillNames = SKILLS.map(s => s.name) as [string, ...string[]];

export const skillInvoke = tool({
  description: 'Load the full body of a skill to follow its detailed instructions. Use when the user request matches a skill description.',
  inputSchema: z.object({
    skillName: z.enum(skillNames),
  }),
  execute: async ({ skillName }) => {
    const skill = getSkillByName(skillName);
    if (!skill) throw new Error(`Skill not found: ${skillName}`);
    return {
      instructions: skill.body,
      compatibility: skill.compatibility,
      // references + assets remain accessible via separate tools
      // (skill_read_reference, skill_read_asset)
    };
  },
});
```

**Companion tool** for reading references (gated by skill activation):

```ts
export const skillReadReference = tool({
  description: 'Read a reference file from a skill. Only call this if the active skill\'s body told you to.',
  inputSchema: z.object({
    skillName: z.enum(skillNames),
    filename: z.string(),
  }),
  execute: async ({ skillName, filename }) => {
    const skill = getSkillByName(skillName);
    return skill?.references[filename] ?? null;
  },
});
```

**This works on Cloudflare Workers because everything is bundled into the Worker module at build time** — no filesystem access at runtime.

### 12.8 The 9 V1 curated skills

Full draft descriptions + tool requirements + body budgets:

| # | Skill | Body budget | Tools required | Draft description (≤1024 chars) |
|---|---|---|---|---|
| 1 | **pitch-deck** | 350–450 lines | `research_deep`, `research_fanout`, `docs_generate_slides`, `firecrawl_scrape` | "Generates investor-ready pitch decks (.pptx) from a one-line idea or written brief. Performs market sizing, competitor scan, and TAM/SAM/SOM with citations, then produces 10–14 designed slides using a curated template. Use when the user asks for a pitch deck, investor deck, fundraising deck, demo day deck, seed deck, Series A deck, or says 'turn this idea into a deck'. Do NOT trigger for internal product update decks (use slide-from-prd)." |
| 2 | **deep-research** | 300–400 lines | `research_deep`, `search_web_advanced`, `firecrawl_scrape` | "Conducts multi-step research with structured planning, source-tracking, and citation. Returns a synthesized brief with [[N]] inline citations and a sources list. Use when the user asks to 'research', 'deep dive', 'investigate', 'find out everything about', or wants a literature review, market analysis, or policy explainer requiring more than a single search." |
| 3 | **deep-research** (fan-out mode) | 200–300 lines | `research_fanout`, `search_web`, `search_company`, `firecrawl_scrape` | "Runs parallel fan-out research across N entities or topics simultaneously, producing a comparison matrix or batch brief. Use when the user supplies a list of items to investigate (10 competitors, 20 companies, every Fortune 500 in a sector) or asks for parallel coverage at breadth rather than depth." |
| 4 | **competitor-brief** | 250–350 lines | `firecrawl_scrape`, `search_company`, `research_competitor` | "Analyzes a company URL or name and outputs structured competitive intel: product, pricing, positioning, recent news, traction signals, hiring patterns, and SWOT. Use when the user provides a company website or asks 'tell me about [Company]', 'analyze this competitor', 'what does [URL] do', or wants a competitor teardown." |
| 5 | **slide-from-prd** | 250–350 lines | `fs_read`, `docs_generate_pdf`, `docs_generate_slides` | "Converts a PRD, design doc, or spec document into a presentation deck preserving structure (goals, problem, solution, milestones). Use when the user has an existing PRD/RFC/spec and asks to 'make slides from this', 'turn this into a deck', or 'present this PRD'." |
| 6 | **csv-analyst** | 300–400 lines | `fs_read`, `runCode`, `data_analyze_csv`, `data_chart` | "Analyzes uploaded CSV files: cleans, profiles, computes summary stats, generates charts, and writes a structured insights report. Use when the user uploads a .csv/.tsv or pastes tabular data and asks for analysis, visualization, trends, anomalies, or 'what does this data tell me'. Do NOT trigger when the deliverable is an .xlsx financial model or a standalone Python script." |
| 7 | **social-post-pack** | 200–280 lines | `firecrawl_scrape`, `search_web` | "Takes one topic, idea, or article URL and produces platform-tailored variants: LinkedIn long-form, X thread, Reddit post (with subreddit-aware tone), and Instagram caption. Use when the user asks for 'social posts', 'tweet thread', 'LinkedIn post', 'cross-post this', or 'social media variants' for a single topic." |
| 8 | **landing-page** | 350–450 lines | `shell_exec`, `fs_write`, `start_dev_server` | "Builds a complete marketing landing page or product page in the existing sandbox web app, with hero, features, proof, CTA, and pricing/FAQ sections when relevant. Use when the user describes a product or app idea and asks for a 'landing page', 'marketing site', 'product page', or 'splash page'. Outputs deployable web code in the project sandbox, not a design mock, and reviews the result through the real preview UI and logs." |
| 9 | **mobile-app** | 400–500 lines | `shell_exec`, `fs_write`, `start_dev_server` | "Builds a mobile-first responsive web app surface in the existing Next.js project, with thumb-friendly navigation, primary screens, empty/loading/error states, and responsive layouts. Use when the user asks for a 'mobile app', 'iPhone-like app', 'mobile-first builder', or phone-first product. Outputs runnable code in the project workspace - Expo Router screens in app-builder-mobile projects, mobile-first responsive web surfaces in web projects - and reviews the result through the real preview UI and logs." |

Each skill ships with at least:
- `SKILL.md` (≤500 lines)
- `references/` for content too long to inline

### 12.9 Annotated example — `pitch-deck/SKILL.md`

The pitch-deck skill demonstrates the V2 pattern: the markdown body gives a
clear workflow, default slide structure, design rules, gotchas, deliverables,
and references. It does not tell the agent to run bundled scripts or local eval
fixtures. Research uses `research_deep` / `research_fanout` / Firecrawl tools,
deck generation uses `docs_generate_slides`, and final product validation still
happens only through the direct UI/log QA gate.

**Good body shape:**
- Quick Start: clarify inputs, draft a 10-12 slide outline, research claims,
  generate the deck through `docs_generate_slides`, inspect the artifact.
- Slide Structure: title, problem, solution, why now, market, product,
  traction, business model, competition, GTM, team, ask.
- Design Standards: concrete palette/type/layout rules and explicit AI-tell
  anti-patterns.
- References: `reference.md` only when deeper market sizing or deck structure
  guidance is needed.

The body remains under 500 lines. Description is explicit about trigger phrases
and negative scope. First-class tools handle deterministic work. References are
gated by use case. Counter-examples capture real-world failure modes.

### 12.10 Skill routing review

V2 has no checked-in `evals/evals.json` files and no local skill-eval runner.
Skill routing is reviewed by reading each `description` against representative
user phrases during code review, then verifying real routing through the final
direct `agent-browser` UI QA gate. If future hosted eval work is restored, this
section and Section 4 must first add the exact files, commands, dependency pins,
and acceptance role.

### 12.11 Anti-patterns we will avoid

1. **Vague descriptions.** "Helps with documents" — never triggers.
2. **First-person voice in description.** "I help…" causes mismatching.
3. **No "when to use" clause.** Only describing what, never when.
4. **Generic LLM-sounding body** ("handle errors appropriately", "follow best practices") — adds nothing the model doesn't already know.
5. **Body over 500 lines** without splitting into `references/`.
6. **Deep reference chains.** `SKILL.md → A.md → B.md` — the agent often skims and misses. Keep references **one level deep**.
7. **Time-sensitive language** ("after August 2025, use the new API") — wrap legacy info in `<details>` "Old patterns" sections instead.
8. **Inconsistent terminology** — alternating "field" / "box" / "element" makes the agent guess.
9. **Windows-style paths** (`scripts\foo.py`). Always forward slashes.
10. **Too many options without a default.** Pick a default + escape hatch.
11. **Over-prescription with MUSTs.** Wall-to-wall commands constrain the LLM and produce brittle behavior. Explain *why* instead.
12. **Skills that should be tools (or vice versa).** Single deterministic call with structured I/O → tool. Multi-step procedure with judgment → skill.
13. **Missing example invocations.** Examples pattern-match better than prose.
14. **Listing unverified dependencies.** Don't claim a package is available when it isn't.

### 12.12 10 opinionated principles for Cheatcode-quality skills

1. **Description = product spec.** Treat as the load-bearing piece. Review representative trigger phrases manually before launch.
2. **Ship with examples in the body, not local eval files.** V1 skill behavior is reviewed through reading and final UI QA, not bundled eval fixtures or prompt runners.
3. **Bodies under 500 lines, full stop.** If at 400, split into `references/`.
4. **Lead with a Quick Start.** Working path visible within first 30 lines.
5. **Use first-class tools for deterministic work.** Do not bundle skill scripts; route repeatable operations through typed tools or request-specific sandbox code.
6. **`why` over `MUST`.** Explanations of intent outperform rigid commands.
7. **Tables and counter-examples beat prose.** "Don't do X because Y" pre-empts predictable failures.
8. **One level deep on references.** Never multi-hop.
9. **Negative scope for ambiguous skills.** Tell the model explicitly which adjacent intents *don't* belong.
10. **Iterate against transcripts.** When a skill underperforms, read the full execution trace. Update SKILL.md and bump `metadata.version`.

### 12.13 External skill publishing is out of V2

The nine skills ship only inside Cheatcode V2. Do not add a public
`cheatcode-skills` repository export, skills.sh link, install command, registry
metadata generator, or package script for publishing skills unless the user
explicitly re-expands the plan. The in-product Skills page may list the bundled
catalog and explain that skills are loaded at build time, but it must not expose
external installation or launch-prep copy.

**Versioning:** semver in `metadata.version`. Never break `name` because it is
the activation key. Bump major on description rewrites that change activation
behavior.

**License:** skills remain internal product content for V2. External licensing
and distribution decisions belong to the owner-managed launch plan, not this
engineering plan.

### 12.14 Folder layout in the monorepo

```
skills/                                  Source of truth — checked into main repo
├── pitch-deck/
│   ├── SKILL.md
│   ├── references/
│   │   ├── pptxgenjs.md
│   │   └── market-sizing.md
│   └── assets/templates/
├── deep-research/
├── deep-research-fanout/ (merged into deep-research skill)
├── competitor-brief/
├── slide-from-prd/
├── csv-analyst/
├── social-post-pack/
├── landing-page/
└── mobile-app/

packages/skills/
├── src/
│   ├── index.ts                         Runtime loader (imports generated.ts)
│   ├── types.ts                         BundledSkill type
│   └── generated.ts                     AUTO — bundled by scripts/build-skills.ts
└── package.json

scripts/build-skills.ts                  Pre-build step: reads skills/* → generated.ts
```

A CI step (`pnpm skills:build`) runs before every build, so `generated.ts` is always current.

---

## 13. Observability

**No Sentry, no Langfuse, no third-party APM.** Fully Cloudflare-native. Total cost: $0. Log retention is 3 days (Workers Logs default) — this is the V1 limit, not a launching pad for "we'll add Axiom later."

### 13.1 Error tracking via Workers Logs

Errors caught at every Worker boundary, logged as structured JSON to Workers Logs (3-day retention, queryable from CF dashboard).

```ts
// packages/observability/src/error-handler.ts
import { log } from './logger';

export function withErrorHandler(handler: ExportedHandler<Env>): ExportedHandler<Env> {
  return {
    async fetch(req, env, ctx) {
      try {
        return await handler.fetch!(req, env, ctx);
      } catch (err) {
        const error = err as Error;
        log('error', error.message, {
          worker: env.WORKER_NAME,
          path: new URL(req.url).pathname,
          method: req.method,
          stack: error.stack,
          release: env.GIT_COMMIT_SHA,
        });
        return new Response(
          JSON.stringify({ error: 'Internal server error', requestId: req.headers.get('cf-ray') }),
          { status: 500, headers: { 'content-type': 'application/json' } }
        );
      }
    },
    async tail(events, env, ctx) {
      return handler.tail?.(events, env, ctx);
    },
  };
}
```

Each Worker wraps its export:

```ts
// apps/agent-worker/src/index.ts
export default withErrorHandler({
  async fetch(req, env, ctx) {
    // ...
  },
});
```

### 13.2 Frontend error tracking

Lightweight global handler in `apps/web` — no SDK, just `fetch` to the gateway:

```ts
// apps/web/lib/error-reporter.ts
'use client';
import { env } from '@cheatcode/env';

const ENDPOINT = `${env.NEXT_PUBLIC_GATEWAY_URL}/v1/client-error`;

function post(body: Record<string, unknown>) {
  void fetch(ENDPOINT, {
    method: 'POST',
    keepalive: true,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => {/* swallow — never error-loop */});
}

// Exported as a function — no top-level side effects (Biome noTopLevelSideEffects).
// Called once from <ClientObservability /> (§13.8).
export function initErrorReporter() {
  window.addEventListener('error', (e) => {
    post({
      message: e.message, stack: e.error?.stack, url: location.href,
      userAgent: navigator.userAgent, timestamp: Date.now(),
    });
  });
  window.addEventListener('unhandledrejection', (e) => {
    post({
      message: e.reason?.message ?? String(e.reason), stack: e.reason?.stack,
      url: location.href, timestamp: Date.now(), type: 'unhandled-rejection',
    });
  });
}
```

Gateway route forwards to Workers Logs (with PII redaction):

```ts
// apps/gateway-worker/src/routes/client-error.ts
app.post('/v1/client-error', async (c) => {
  const body = await c.req.json();
  log('error', 'client_error', {
    type: 'frontend',
    userId: c.get('userId') ?? 'anonymous',
    ...redactPII(body),
  });
  return c.json({ ok: true });
});
```

### 13.3 PII / secret redaction in logs

A `redactSecrets()` helper is always wrapped around log payloads at the boundary, so we never store BYOK keys, bearer tokens, or emails in Workers Logs:

```ts
// packages/observability/src/redact.ts
// Sensitive URL query params — covers VNC takeover URLs (?password=…&access=…),
// signed download URLs, OAuth callbacks, etc. Without this, a logged URL string
// leaks live credentials.
const SENSITIVE_QS = /([?&](?:password|access|token|auth|secret|key|sig|signature)=)[^&\s"']+/gi;

export function redactSecrets(obj: unknown): unknown {
  const json = JSON.stringify(obj);
  return JSON.parse(
    json
      .replace(/sk-[a-zA-Z0-9-_]{20,}/g, '[REDACTED-KEY]')
      .replace(/Bearer [a-zA-Z0-9-_.]+/g, 'Bearer [REDACTED]')
      .replace(SENSITIVE_QS, '$1[REDACTED]')
      .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[EMAIL]')
  );
}
```

Used inside `log()` automatically — see Section 13.5. The `SENSITIVE_QS` pass is what keeps single-use VNC takeover tokens (§9.5) out of Workers Logs even when a full `embedUrl` is logged.

### 13.4 Alerting (Cloudflare-native, no third-party APM)

V1 ships **automated alerting**, built entirely from Cloudflare-native primitives — zero new vendors, zero cost beyond Workers Paid. This is **not** a staging environment and **not** preview deploys (those stay out — §15.3, §27.9); alerting and environment count are separate concerns, and once billing + user sandboxes are live, silent failures are unacceptable. Three layers:

**Layer 1 — Cloudflare account alerts (account-level, push-based).** Configured once in the CF dashboard:
- *Workers error rate* — fires when any Worker's error rate spikes above baseline.
- *Durable Objects* / *R2* / *Workers KV* health + usage anomalies.
- *Usage-Based Billing* thresholds — early signal for runaway container/DO spend.
Destinations: team email + a webhook → `webhooks-worker` `/internal/alert` (HMAC-gated with `x-cheatcode-alert-timestamp` + `x-cheatcode-alert-signature`, signing `${timestamp}.${rawBody}` with `INTERNAL_ALERT_WEBHOOK_SECRET`). The route records a redacted structured alert in Workers Logs and `cc_error_events`; team email remains the human notification path in V1, so no third-party chat/notification vendor is introduced.

**Layer 2 — Health Checks.** A Cloudflare Health Check pings `gateway.trycheatcode.com/health` from multiple regions; sustained failure emails on-call immediately.

**Layer 3 — Analytics Engine watchdog.** A lightweight Worker cron-triggered workflow step runs Workers Analytics Engine SQL over the §30.4 datasets via Cloudflare's REST SQL endpoint and evaluates the §30.2 burn-rate thresholds — the things native account alerts cannot express:
- Gateway 5xx ratio over 1h / 6h windows (SLO 99.9%).
- Agent-run failure rate vs. 2× expected (SLO burn).
- Webhook `401`/failure count per provider over 15 min.
- Cost-per-run regression > 150% of the 7-day median.
- Per-user quota anomalies — sudden spend or sandbox-hour spikes.
A breach posts a structured alert to the same `/internal/alert` route. This watchdog is operational monitoring only; it is not a user-facing recurrence feature.

**Still manual:** Workers Logs live-tail for ad-hoc debugging. Log retention stays 3 days (V1 limit) — alerting does **not** depend on it, because Layer 3 reads Analytics Engine, which has its own retention. No external log sink in V1.

Critical user-facing events (budget exhausted, BYOK key invalid) additionally surface directly in the user's UI via Durable Object state — independent of this operator alerting.

### 13.5 Workers Tracing (native OpenTelemetry)

Cloudflare Workers Tracing (open beta) auto-emits OTel spans for fetch, KV, DOs, and AI bindings. Blaxel sandbox latency is recorded as explicit outbound fetch/tool spans. Enable per-Worker:

```jsonc
{
  "observability": {
    "enabled": true,
    "head_sampling_rate": 0.1
  }
}
```

Cloudflare Durable Objects apply CPU limits at the object level and discard/recreate an object that exceeds its configured CPU budget. V2 keeps the Week 1 agent path lean by avoiding Mastra Memory and any embedding/vector initialization inside the AgentRun DO.

The normal chat route uses the Mastra agent loop by default. A deterministic
Blaxel `runCode` fallback exists only for first-visible-chunk model timeouts so a
run can still prove sandbox execution without a hidden diagnostic thread or
prompt. The fallback executes the real `runCode` tool handler and streams the
Blaxel result immediately, but it is not the default product path and must not
replace the normal model loop.

For agent-specific spans, emit manually:

```ts
// packages/observability/src/tracing.ts
export async function span<T>(
  name: string,
  attrs: Record<string, string | number>,
  fn: () => Promise<T>
): Promise<T> {
  const start = performance.now();
  try {
    const result = await fn();
    log('info', `span.${name}`, {
      span: name,
      duration_ms: performance.now() - start,
      status: 'ok',
      ...attrs,
    });
    return result;
  } catch (err) {
    log('error', `span.${name}.failed`, {
      span: name,
      duration_ms: performance.now() - start,
      status: 'error',
      error: (err as Error).message,
      ...attrs,
    });
    throw err;
  }
}

// Usage in agent loop:
await span('tool.docs_generate_slides', { tool: 'docs_generate_slides', userId }, async () => {
  return await generateSlides.execute(input, ctx);
});
```

### 13.6 AI metrics via Workers Analytics Engine

Custom dataset for agent metrics — token usage, cost per run, latency, status — queryable via Workers Analytics SQL. The column order is the locked §30.4 `cc_agent_metrics` contract:

```ts
// packages/observability/src/analytics.ts
export function emitAgentMetric(env: AnalyticsBindings, metric: {
  runId: string;
  agentName: string;
  model: string;
  stepType: string;
  status: 'success' | 'error';
  errorCode?: string;
  workerName: string;
  envTag?: string;
  versionTag?: string;
  durationMs?: number;
  promptTokens?: number;
  completionTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  usdCostMicros?: number;
  stepIdx?: number;
  toolCallCount?: number;
  userId: string;
}) {
  env.AGENT_METRICS.writeDataPoint({
    indexes: [metric.userId],
    blobs: [metric.runId, metric.agentName, metric.model, metric.stepType, metric.status, metric.errorCode, metric.workerName, metric.envTag, metric.versionTag],
    doubles: [metric.durationMs, metric.promptTokens, metric.completionTokens, metric.cacheReadTokens, metric.cacheWriteTokens, metric.usdCostMicros, metric.stepIdx, metric.toolCallCount],
  });
}
```

Query via Workers Analytics SQL:

```sql
SELECT blob3 AS model, SUM(double6) AS total_cost_micros, COUNT(*) AS runs
FROM cc_agent_metrics
WHERE timestamp > NOW() - INTERVAL '7' DAY
GROUP BY blob3
ORDER BY total_cost_micros DESC;
```

Free tier covers 10M writes/mo on Workers Paid. At 5 metrics per agent step × 50 steps per run × 100 runs/day = 25k/day = 750k/mo — well within free.

AgentRun also emits a first-visible-chunk TTFT point to `cc_performance_metrics.double1` so the Analytics Engine watchdog can evaluate `ttft_p95_10m`.

### 13.7 Structured logging

```ts
// packages/observability/src/logger.ts
type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  userId?: string;
  runId?: string;
  threadId?: string;
  projectId?: string;
  toolName?: string;
  modelId?: string;
}

export function log(level: LogLevel, msg: string, context: LogContext = {}, extra?: Record<string, unknown>) {
  emitToWorkersLogs(level, JSON.stringify({
    level,
    msg,
    timestamp: new Date().toISOString(),
    ...context,
    ...extra,
  }));
}
```

Workers Logs parses structured JSON emitted through the logger into queryable fields in the CF dashboard. Default retention: 3 days. Sufficient for V1. Application code must not call `console.log` directly; the logger uses level-appropriate Workers Logs methods after redaction.

The `log()` helper passes payloads through `redactSecrets()` automatically before emitting:

```ts
// packages/observability/src/logger.ts
import { redactSecrets } from './redact';

export function log(level: LogLevel, msg: string, context: LogContext = {}, extra?: Record<string, unknown>) {
  emitToWorkersLogs(level, JSON.stringify(redactSecrets({
    level,
    msg,
    timestamp: new Date().toISOString(),
    ...context,
    ...extra,
  })));
}
```

### 13.8 RUM for frontend

Web Vitals to Workers Analytics Engine:

```tsx
// apps/web/components/observability/client-observability.tsx
'use client';
import { useEffect } from 'react';
import { initWebVitals } from '@/lib/rum';
import { initErrorReporter } from '@/lib/error-reporter';

// Mounted once in app/layout.tsx as <ClientObservability />. Registering inside
// useEffect keeps lib/rum.ts and lib/error-reporter.ts free of top-level side
// effects (Biome noTopLevelSideEffects) and runs both only in the browser.
export function ClientObservability() {
  useEffect(() => {
    initWebVitals();      // §10.9 — web-vitals/attribution → gateway /v1/vitals
    initErrorReporter();  // §13.2 — window error/rejection → gateway /v1/client-error
  }, []);
  return null;
}
```

Both `/v1/vitals` and `/v1/client-error` are gateway routes (§23.2 #35–36) — the browser beacons them directly (CORS allows the web origin on `/v1/*`, §14.6). The gateway forwards Web Vitals to Analytics Engine and client errors to Workers Logs.

---

## 14. Security

### 14.1 Authentication flow

```
User → Clerk OAuth/email login → Clerk JWT issued
        │
        │ Frontend stores in Clerk cookie
        ▼
User action → apps/web → fetch() with Bearer token
        │
        ▼
gateway-worker:
  const auth = await verifyToken(req.headers.get('Authorization')!, {
    secretKey: env.CLERK_SECRET_KEY,
    // Optional: jwtKey: env.CLERK_JWT_KEY for networkless PEM verification
    // when the Clerk Dashboard JWT public key has been provisioned.
  });
  // auth.sub is the Clerk user ID
  // Look up internal user ID via mapping in DB
  ctx.userId = await getInternalUserId(auth.sub);
```

`@clerk/backend` can verify with `CLERK_SECRET_KEY` by fetching JWKS, or with
optional `CLERK_JWT_KEY` for networkless PEM verification.

### 14.2 BYOK key safety

- **Storage:** Supabase Vault (libsodium-backed TCE), keys never plaintext at rest
- **Transport:** decrypted on demand per LLM call via `get_provider_key` RPC, never persisted to DO state
- **Fingerprint:** the only key-derived value stored or shown is a **non-reversible SHA-256 hex prefix** (`set_provider_key`, §7.8) — no characters of the real key are ever persisted, logged, or displayed
- **Logging:** only `provider` + fingerprint hash + timestamps ever logged
- **Log redaction:** `redactSecrets()` regex filter strips key-like strings (`sk-*`, `Bearer *`), sensitive URL query params (`password`/`access`/`token`/`auth`/`secret`/`sig`), and emails inside the `log()` helper before emitting to Workers Logs
- **UI:** show only provider + fingerprint hash + created date in settings; allow rotate/delete but never display the key after entry

### 14.3 Cloudflare Secrets Store

App-level secrets (not user-scoped). `cheatcode-agent` uses standard Worker
secrets for Blaxel and output URL signing (`BL_API_KEY`, `BL_WORKSPACE`,
`BL_REGION`, `OUTPUT_DOWNLOAD_SIGNING_SECRET`) because those bindings are read
as plain strings by Worker env validation and synced with `wrangler versions
secret put`. Do not add those four to `cheatcode-agent`'s
`secrets_store_secrets`; deployment and runtime checks must inspect them through
the standard Worker secret surface without adding a standalone validation script.
Workers that only need fallback lifecycle cleanup, such as `cheatcode-webhooks`, may bind Blaxel credentials from
Cloudflare Secrets Store and resolve them through `resolveWorkerSecret()`.

```jsonc
// per-worker wrangler.jsonc
{
  "secrets_store_secrets": [
    { "binding": "CLERK_SECRET_KEY", "secret_name": "clerk-secret-key", "store_id": "..." },
    { "binding": "CLERK_WEBHOOK_SIGNING_SECRET", "secret_name": "clerk-webhook-signing-secret", "store_id": "..." },
    { "binding": "POLAR_ACCESS_TOKEN", "secret_name": "polar-access-token", "store_id": "..." },
    { "binding": "POLAR_WEBHOOK_SECRET", "secret_name": "polar-webhook-secret", "store_id": "..." },
    { "binding": "COMPOSIO_API_KEY", "secret_name": "composio-api-key", "store_id": "..." },
    { "binding": "COMPOSIO_AUTH_CONFIGS", "secret_name": "composio-auth-configs", "store_id": "..." },
    { "binding": "COMPOSIO_WEBHOOK_SECRET", "secret_name": "composio-webhook-secret", "store_id": "..." },
    { "binding": "CLOUDFLARE_ANALYTICS_API_TOKEN", "secret_name": "cloudflare-analytics-api-token", "store_id": "..." },
    { "binding": "INTERNAL_ALERT_WEBHOOK_SECRET", "secret_name": "internal-alert-webhook-secret", "store_id": "..." },
    { "binding": "INTERNAL_MAINTENANCE_SECRET", "secret_name": "internal-maintenance-secret", "store_id": "..." }
  ]
}
```

Set once per env:

```bash
wrangler secrets-store store list --remote
wrangler secrets-store secret create <STORE_ID> --name clerk-secret-key --scopes workers --remote
# Repeat for blaxel-api-key, blaxel-region, blaxel-workspace,
# clerk-jwt-key, polar-access-token, clerk-webhook-signing-secret,
# polar-webhook-secret, composio-api-key, composio-auth-configs,
# composio-webhook-secret, cloudflare-analytics-api-token, and
# internal-alert-webhook-secret plus internal-maintenance-secret.
# Omit --value so Wrangler prompts securely instead of
# leaving secret material in shell history.

# Blaxel sandbox credentials are standard Worker secrets on agent-worker.
pnpm sync:worker-secrets -- --apply
```

`pnpm sync:worker-secrets` scans `.env.local`, `.env.development`,
`docker.dev`, and per-Worker `.dev.vars` files by default, then fails if any
required standard Worker secret is absent. `--allow-partial` is only for
targeted debugging. `--apply` uses `wrangler versions secret put` for
Workers-Version-safe secret updates and does not run `wrangler deploy`.

### 14.4 Rate limiting

**Zone-level (free, blanket):**
- Cloudflare Rate Limiting Rule: 1000 req/min/IP on `gateway.trycheatcode.com/v1/*`
- Cloudflare Bot Management on Free tier (basic)

**Per-user-per-route (DO-backed)** — canonical implementation is the token-bucket `RateLimiter` DO in §24.4; the policy below is keyed by the real `/v1/*` routes (§23.2). Daily caps on expensive features such as deep-research fan-out are **quotas** via the `QuotaTracker` DO (§24.5) against §28.1 plan limits — not rate limits:

Gateway routes fail open when the `RateLimiter` DO is unavailable because of
Cloudflare platform, account-tier, timeout, or malformed-response errors. The
gateway emits a structured `rate_limiter_unavailable` warning and continues the
request. Explicit `allowed: false` limiter responses still return HTTP 429, and
quota checks for expensive features are not fail-open.

```ts
// apps/gateway-worker/src/durable-objects/rate-limiter.ts
const LIMITS: Record<string, { limit: number; windowSec: number }> = {
  'POST /v1/threads/:threadId/runs': { limit: 60,  windowSec: 60 },    // 60 runs/min
  'POST /v1/projects':               { limit: 100, windowSec: 86400 },
};

export class RateLimiter extends DurableObject {
  async check(userId: string, route: string): Promise<{ allowed: boolean; resetAt: number }> {
    const config = LIMITS[route] ?? { limit: 1000, windowSec: 3600 };
    const now = Date.now();
    const windowStart = now - config.windowSec * 1000;
    const key = `${userId}:${route}`;

    const recent = await this.ctx.storage.sql.exec(
      `SELECT timestamp FROM hits WHERE key = ? AND timestamp > ?`,
      key, windowStart,
    ).toArray();

    if (recent.length >= config.limit) {
      return { allowed: false, resetAt: recent[0].timestamp + config.windowSec * 1000 };
    }

    await this.ctx.storage.sql.exec(
      `INSERT INTO hits (key, timestamp) VALUES (?, ?)`,
      key, now,
    );
    return { allowed: true, resetAt: now + config.windowSec * 1000 };
  }
}
```

### 14.5 Sandbox safety

- All app/tool shell execution calls go through `ProjectSandbox.exec({ command: string[] })` argv form. Blaxel's process API accepts shell command strings, so `ProjectSandbox` performs the only allowed argv-to-shell serialization with shell-safe quoting at the SDK boundary. Compound startup logic (browser, VNC) lives in **static scripts baked into the image** (`/opt/cheatcode/*.sh`, §9.1) and is invoked by argv; secrets reach those scripts via `env`, never interpolated into a command string
- Only explicitly created Blaxel previews are reachable; the takeover (VNC) port is gated by a per-session password + short-lived private Blaxel preview token + preview deletion (§9.5)
- Blaxel network domain filtering is configured at sandbox creation when region support is available, but because proxy routing is public preview, V1 still treats resource caps + behavioural detection + audit as mandatory safety boundaries (§9.6).
- CDP is **never** exposed — Stagehand launches a Playwright-managed Chromium inside the Blaxel sandbox with no stable public CDP port (§9.4)
- Audit only non-secret shell execution metadata to the `R2_AUDIT` Worker binding backed by the `cheatcode-audit` R2 bucket: `argv0`, argc, process name, status, exit code, duration, sandbox id, and timestamp. Raw command strings, user code, stdout, stderr, env values, and decrypted BYOK values are forbidden in audit JSON. Metadata lands under `sandbox-exec/{YYYY-MM}/{YYYY-MM-DD}/...`; monthly partition archival writes Postgres audit archives under `cheatcode-audit/{YYYY-MM}/audit_log.ndjson.gz`.
- Sandbox image has no privileged operations; `USER node` in Dockerfile

### 14.6 CORS + security headers

```ts
// apps/gateway-worker/src/middleware/security.ts
import { secureHeaders } from 'hono/secure-headers';
import { cors } from 'hono/cors';

app.use('*', secureHeaders({
  contentSecurityPolicy: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", "'wasm-unsafe-eval'", 'https://clerk.trycheatcode.com'],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", 'data:', 'https:'],
    // Gateway is HTTPS only (REST + SSE — no WSS). WSS is only the sandbox
    // terminal/noVNC on the preview wildcard domain.
    connectSrc: ["'self'", 'https://gateway.trycheatcode.com', 'wss://*.trycheatcode.com'],
    frameAncestors: ["'none'"],
  },
  strictTransportSecurity: 'max-age=31536000; includeSubDomains; preload',
  referrerPolicy: 'strict-origin-when-cross-origin',
}));

// CORS on the ACTUAL public route prefix — gateway routes are /v1/*, not /api/*.
// Hono's cors() does exact-string origin matching, so a literal
// 'https://*.trycheatcode.com' would never match — use an origin function.
// V1 has no preview deploys, so the allowlist is exactly the two web origins.
const ALLOWED_ORIGIN = /^https:\/\/(www\.)?trycheatcode\.com$/;
app.use('/v1/*', cors({
  origin: (origin) => (origin && ALLOWED_ORIGIN.test(origin) ? origin : null),
  credentials: true,
  allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key'],
}));
```

### 14.7 Turnstile (free CAPTCHA)

On signup form and future public form surfaces — Cloudflare Turnstile free.

**Replay/share pages are intentionally removed.** V2 has no public replay routes,
no homepage replay cards, no user-published replay shares, and no replay-share
table. The only remaining “replay” terminology in the codebase refers to
internal stream/idempotency replay used for reconnect safety.

### 14.8 Audit log

```ts
// Every BYOK key access, every destructive tool call:
await db.insert(auditLog).values({
  userId,
  action: 'tool_executed',
  details: {
    tool: 'send_email',
    fingerprint: keyFingerprint,
    initiated_by: userId,
  },
  ipAddress: req.headers.get('cf-connecting-ip'),
});
// Also append to R2 audit bucket (immutable)
```

---

## 15. CI/CD

### 15.1 `.github/workflows/static-checks.yml`

```yaml
name: Static Checks
on:
  pull_request:
  push:
    branches: [main]

jobs:
  static-checks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 10.33.2 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck:scripts
      - run: pnpm turbo lint typecheck build
        env:
          TURBO_TOKEN: ${{ secrets.TURBO_TOKEN }}
          TURBO_TEAM: cheatcode
```

### 15.2 `.github/workflows/deploy-workers.yml`

```yaml
name: Deploy Workers
on:
  workflow_dispatch:
    inputs:
      confirm_production_deploy:
        description: Type "deploy Cheatcode V2 to production" to approve production deployment.
        required: true
        type: string

permissions:
  contents: read

concurrency:
  group: production-workers
  cancel-in-progress: false

jobs:
  prepare-production:
    if: github.event.inputs.confirm_production_deploy == 'deploy Cheatcode V2 to production'
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 10.33.2 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck:scripts

  deploy-agent:
    runs-on: ubuntu-latest
    needs: prepare-production
    environment: production
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 10.33.2 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm turbo build --filter=@cheatcode/agent-worker
      - uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          workingDirectory: apps/agent-worker
          command: deploy

  deploy-gateway:
    runs-on: ubuntu-latest
    needs: deploy-agent
    environment: production
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 10.33.2 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm turbo build --filter=@cheatcode/gateway-worker
      - uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          workingDirectory: apps/gateway-worker
          command: deploy

  deploy-web:
    runs-on: ubuntu-latest
    needs: deploy-gateway
    environment: production
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 10.33.2 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @cheatcode/web deploy
        env:
          CHEATCODE_PROD_DEPLOY_APPROVED: "true"
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}

  deploy-webhooks:
    runs-on: ubuntu-latest
    needs: deploy-web
    environment: production
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 10.33.2 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm turbo build --filter=@cheatcode/webhooks-worker
      - uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          workingDirectory: apps/webhooks-worker
          command: deploy
```

Production Worker deploys are manual-only. A push to `main` must never deploy
Cloudflare resources by itself; the deploy workflow is started with
`workflow_dispatch` only, then additionally gated by a required typed
confirmation (`deploy Cheatcode V2 to production`) and the GitHub `production`
environment. The production deploy jobs are intentionally serialized as
`deploy-agent -> deploy-gateway -> deploy-web -> deploy-webhooks`, matching the
first-time setup order so Service Bindings resolve before the web surface is
published. Local production deploy commands must also refuse to run unless
`CHEATCODE_PROD_DEPLOY_APPROVED=true` is set after explicit approval. The
prepare job runs `pnpm typecheck:scripts` first, so operational-script type
errors fail before deployment. Product correctness and deployed-resource
behavior are proven only through the final direct `agent-browser` UI/log QA
gate; no standalone deploy-validation script is part of V2.

### 15.3 No preview / PR deploys

V1 ships with no preview deployments. PRs are verified via `pnpm turbo lint typecheck build` in CI plus final direct `agent-browser` UI QA against the local/preview stack when the all-weeks code surface is complete. Production deploys are explicit manual operations, not a side effect of merging to `main`. Re-add Worker `versions upload --tag` previews in v1.5 if PR review needs them.

### 15.4 Frontend (Cloudflare Workers / OpenNext)

`apps/web` deploys as `cheatcode-web` through `@opennextjs/cloudflare`.

- `pnpm --filter @cheatcode/web build` runs `next build --webpack` and converts the output into `.open-next/worker.js`.
- `pnpm --filter @cheatcode/web preview` runs the converted app in the local Workers runtime on port 3001 so `gateway-worker` can keep port 8787.
- `CHEATCODE_PROD_DEPLOY_APPROVED=true pnpm --filter @cheatcode/web deploy` deploys to Cloudflare Workers after explicit approval.
- Runtime config lives in `apps/web/wrangler.jsonc`.
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `NEXT_PUBLIC_GATEWAY_URL`, `NEXT_PUBLIC_POLAR_PRO_MONTHLY_PRODUCT_ID`, and `CLERK_SECRET_KEY` must be present in Cloudflare Workers Builds / deploy environment. `scripts/deploy-phased.ts` injects the public web vars into OpenNext build/deploy and fails before deployment if the Clerk publishable key or Polar product ID is missing. The GitHub production environment must expose `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `NEXT_PUBLIC_POLAR_PRO_MONTHLY_PRODUCT_ID` as environment variables for the manual web deploy job; `NEXT_PUBLIC_GATEWAY_URL` is pinned to `https://gateway.trycheatcode.com` by the deploy command. `NEXT_PUBLIC_POLAR_PRO_MONTHLY_PRODUCT_ID` must point at a V2 Polar product whose metadata includes `tier=pro` (the four paid tiers are `pro|premium|ultra|max`, §28.3; product ids are configured server-side as `POLAR_PRODUCT_ID_*`); the web Billing panel disables checkout instead of falling back to a dummy product ID when it is absent. `CLERK_SECRET_KEY` is also bound from Cloudflare Secrets Store at runtime.
- R2 bucket `cheatcode-next-cache` backs the OpenNext incremental cache. Durable Object classes `DOQueueHandler`, `DOShardedTagCache`, and `BucketCachePurge` back revalidation queue/tag-cache/purge behavior.

### 15.5 Database migrations

One workflow, two jobs. `diff` runs **only on PRs** (validate + comment, never apply). `apply` runs **only through manual `workflow_dispatch`** (apply all three phases of §7.10). Production database mutations are never triggered by a push to `main`; they require explicit human approval through the GitHub `production` environment. The two jobs trigger on disjoint events, so `apply` does **not** `needs: diff` — a cross-event `needs` would permanently skip `apply`. Both jobs go through `scripts/migrate.ts`, the single migration runner, so CI applies the exact pre-SQL → Drizzle → post-SQL order from §7.10.

```yaml
# .github/workflows/db-migrate.yml
name: DB Migrate
on:
  pull_request:
    paths: ['infra/supabase/migrations/**', 'packages/db/src/schema/**', 'packages/db/drizzle/**']
  workflow_dispatch:

# Never let two migrations race against the same database.
concurrency: { group: db-migrate, cancel-in-progress: false }

jobs:
  # PR: regenerate Drizzle SQL, fail if it drifted from committed migrations,
  # post the pending plan. Applies nothing.
  diff:
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @cheatcode/db drizzle-kit generate
      - name: Fail if schema/ drifted from committed Drizzle migrations
        run: git diff --exit-code packages/db/drizzle
      - name: Compute pending migration plan
        run: pnpm tsx scripts/migrate.ts --dry-run | tee migration-plan.txt
        env:
          DATABASE_URL: ${{ secrets.SUPABASE_MIGRATION_URL }}
      - uses: marocchino/sticky-pull-request-comment@v2
        with:
          header: db-migration-plan
          path: migration-plan.txt

  # Manual dispatch: apply pre SQL → drizzle-kit migrate → post SQL, in order.
  # Gated by the GitHub `production` environment (manual approval).
  apply:
    if: github.event_name == 'workflow_dispatch'
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - name: Apply migrations — pre SQL → drizzle-kit migrate → post SQL (§7.10)
        run: pnpm tsx scripts/migrate.ts --apply
        env:
          # Direct Supabase Postgres URL, admin/postgres role — DDL needs privileges
          # app_worker deliberately lacks. NOT Hyperdrive, NOT the Worker role.
          DATABASE_URL: ${{ secrets.SUPABASE_MIGRATION_URL }}
```

CI runs `pnpm turbo lint typecheck build` on every PR. Migration application
is an explicit database operation through `.github/workflows/db-migrate.yml`;
the static-check workflow does not run migration product probes, source-level
test runners, package test scripts, browser scripts, or other product-flow
drivers.

---

## 16. Cost Projection

### 16.1 Free tier breakdown

| Service | Free tier | First paid threshold |
|---|---|---|
| Cloudflare Workers/DOs/Workflows | Workers Free/Paid depending on Workflows/DO usage | Workers Paid is required for reliable production AgentRun DO QA once Free daily duration is exhausted |
| Blaxel Sandboxes | Up to **$200 starter credits**, 10 free-tier concurrent sandboxes | XS 2 GB: $0.000023/s, S 4 GB: $0.000046/s, snapshot/volume storage billed separately |
| Durable Objects | 1M req/mo + 1 GB | $0.15/M req + $0.20/GB-mo |
| Workflows | Tied to Workers Paid | $0.30/M reqs |
| R2 | 10 GB + 1M ops + zero egress | $0.015/GB-mo |
| Hyperdrive | Free on Paid | — |
| Supabase Free | 500 MB DB + 50k MAUs + 1 GB storage | Pro $25/mo |
| Clerk Free | **10,000 MAUs** | Pro $25/mo |
| Polar | No fixed cost | 4% rev-share |
| GitHub Actions | 2,000 min/mo private | $0.008/min |
| All BYOK (LLM/search/parsing/automation) | User pays providers | $0 to us |

### 16.2 Cost projections

| Stage | Monthly cost |
|---|---|
| Pre-launch development | **$0–5/mo** before Blaxel starter credits are exhausted |
| Soft launch (≤50 users casual) | **$5–50/mo** depending on active sandbox seconds + snapshot storage |
| Real traction (500 users) | **$80–250/mo** (+ maybe Supabase Pro + Clerk Pro) |
| Serious scale (10k MAUs) | **$300–1,000/mo** depending on active sandbox seconds and retained snapshots/volumes |

### 16.3 Free-tier optimization tips

1. **Let Blaxel auto-standby after idle** — no memory runtime billing while idle; standby snapshot storage remains billable
2. **Use Blaxel standby/volumes intentionally** instead of keeping processes alive indefinitely
3. **Workers Logs 3-day retention is the V1 limit.** No external log sink. External observability is out of scope for V1.
4. **Aggressive Anthropic prompt caching** via `providerOptions.anthropic.cacheControl` — typical 70% savings on system prompt costs

### 16.4 Post-revenue minimum

Cloudflare Workers/Web traffic is the single product hosting surface. Upgrade to Workers Paid when production limits require it. As of the Week 1 production QA run, the current account can deploy Workers and SQLite-backed Durable Objects, but `AgentRun`/`RateLimiter` calls can fail with Cloudflare's `Exceeded allowed duration in Durable Objects free tier` error after the Free daily duration allotment is exhausted. Rate limiting fails open (§14.4), but `AgentRun` is the core run-state/streaming primitive and cannot be bypassed without violating the V2 architecture; final production chat QA therefore requires Workers Paid or a Free-tier duration reset.

**Total post-revenue minimum: $0–5/mo before usage overages, plus optional Workers Paid if Cloudflare usage requires it.**

---

## 17. 8-Week Implementation Plan

### 17.0 Execution order

Implement Weeks 1-8 in code first. Validation is a single end-of-build gate:
typecheck, lint, builds, explicit migration review, direct browser QA, and
running app-log review all happen only after the planned weekly code surfaces
are implemented. Typecheck/lint/build commands are code-health checks only;
they are never product tests and must not submit prompts, drive auth, click the
UI, or simulate user behavior. During implementation, limit checks to static
inspection and dependency/setup sync needed to keep coding unblocked. Do
**not** pause after each week to run builds or browser QA.

The final gate uses `agent-browser --auto-connect --session cheatcode-debug`
directly, not through checked-in browser/product-flow scripts and not through a
temporary local wrapper. Each meaningful action is its own visible command in
the transcript; do not hide product QA inside shell aliases, shell functions,
`pnpm` commands, chained flow runners, local `/tmp` helpers, or generated
TypeScript/Python/Node files. Use the snapshot-ref workflow manually: open →
wait → `snapshot -i` → click/fill/type real controls → re-snapshot. Capture
screenshots at meaningful milestones, exercise desktop and mobile-sized
contexts, review browser console entries, inspect visible network/resource
behavior, and cross-check the running Next/Wrangler logs. No custom script may
drive the UI, submit prompts, create browser sessions, perform acceptance
flows, wrap `agent-browser`, or act as the final product E2E gate unless the
user explicitly re-authorizes scripted testing in `plan.md`. If a throwaway
validation script, prompt harness, accessibility checker, smoke runner, load
runner, or browser automation helper appears while building V2, delete it
instead of running it. Do not create out-of-tree scripts for product testing
either; all product evidence must come from direct UI operations and log review.
Stagehand remains an in-sandbox product dependency for the user's
browser-automation tools; it is not the external product QA driver.
There are no package `test` scripts, Turbo `test` task, smoke scripts, E2E
scripts, prompt-submission harnesses, load drivers, or scripted browser QA
entry points in the V2 command surface. Root operational scripts are limited to
non-QA implementation chores such as skill bundling, local orchestration,
migration application, secret synchronization, Docker cleanup, and deployment
guardrails; they must never become product testing surfaces.
If a script exists solely to test product behavior, delete it; do not rename it,
hide it under another command, or keep it as a temporary helper. This applies
even when the script would live outside the repo, in `/tmp`, in a package
folder, or in a shell-history loop: no scripted product testing path is allowed.
The only acceptable product QA transcript is direct `agent-browser` commands
and direct log inspection.

### Week 1 — Foundation
**Goal:** Hello-world ToolLoopAgent in production with one tool.

- Set up monorepo: pnpm + Turborepo + Biome + tsconfig packages
- `packages/db` schema (Drizzle) + Supabase project + Hyperdrive
- `packages/byok` with Vault RPCs
- `apps/gateway-worker` with Hono + Clerk middleware
- `apps/agent-worker` with `AgentRun` DO + Mastra setup
- `packages/tools-code` with one tool: `runCode` via Blaxel sandbox process execution
- `apps/web` shell with Clerk + `useChat` shell + first AI Elements components
- GitHub Actions CI/CD wired
- **Milestone:** User logs in, sends a message, agent runs Python in a Blaxel sandbox, returns result. Production config is deploy-ready, but no production deploy runs until the user explicitly approves it.

### Week 2 — Sandbox + file tools + streaming polish
- Full `packages/tools-code` (read/write/exec/list/git)
- Blaxel standby/expiration/volume strategy for persistent project state
- Preview URLs via Blaxel previews wired to `apps/web/components/preview/`
- Resumable active streams via `DefaultChatTransport` reconnect endpoint + DO storage; `useChat` mount-time auto-resume stays disabled and visibility recovery calls `resumeStream()` only during active in-memory streaming
- Streamdown + full AI Elements wired
- **Milestone:** Agent runs `npx create-next-app`, user sees preview tab, edits file, hot-reload works.

### Week 3 — Browser + docs
- `packages/tools-browser` with Stagehand v3 LOCAL mode (Chromium in container)
- User takeover via x11vnc + websockify + noVNC iframe
- `packages/tools-docs` (pptxgenjs, docx, exceljs, react-pdf) → R2 → signed download URLs
- **Milestone:** Agent generates a slide deck and user downloads it. User can take control of browser mid-task.

### Week 4 — Research + skills
- `packages/tools-research` (Exa + Firecrawl)
- `packages/agent-core/workflows/deep-research.ts`
- `packages/agent-core/workflows/deep-research-fanout.ts` (fanout 25 max)
- All 9 skills authored: SKILL.md + references/assets only, with no bundled scripts or local eval fixtures (per Section 12)
- `scripts/build-skills.ts` build-time bundler producing `packages/skills/src/generated.ts`
- `skillInvoke` + `skillReadReference` tools wired into Mastra
- Manual description review completed for all 9 skill descriptions
- Skill routing verified only through the final direct UI/log QA gate; no checked-in skill-eval script runs in V2.
- **Milestone:** Deep research returns cited report; Deep research fans out 25 parallel agents in fan-out mode; the in-product catalog lists all 8 bundled skills; all 8 skills are reviewed through the final direct UI/log QA gate.

### Week 5 — Observability + BYOK settings
- Workers Logs + Workers Tracing + Workers Analytics Engine wired + `redactSecrets()` log filter + `withErrorHandler` wrapper
- BYOK settings UI in `apps/web/settings/providers`
- `packages/byok` owns provider-key validation for every BYOK provider; gateway validates before Vault storage, and `OpsMaintenanceWorkflow` runs periodic revalidation through the RLS-safe inventory RPC, disabling invalid keys without logging plaintext
- **Milestone:** Provider key settings, structured logs, tracing, analytics, and error redaction are working with no product notification surface.

### Week 6 — Budgets
- Per-run budget caps, set from the composer cap control (No cap / $2 / $5 / $10 / Custom, hard max $50) and persisted as the project cap
- Launch templates and a separate per-project defaults settings panel are descoped — the Paper design covers intent pills on the home composer instead
- **Milestone:** Budget caps are enforced from the composer.

### Week 7 — Frontend polish + Polar
- Polish `apps/web` thread UI, preview tabs, multi-agent progress, and sidebar project deletion for sandbox-limit recovery
- Polar billing flow (free/pro/premium/ultra/max tiers, §28) + entitlement checks
- In-product skills catalog page (browse 9 bundled skills only)
- **Milestone:** Billing functional; frontend polish is complete and ready for the final direct `agent-browser` QA gate.

### Week 8 — Hardening
- Clerk `user.deleted` starts a Cloudflare Workflow DSR lifecycle: build a deletion manifest, revoke external resources, delete Blaxel/DO/R2 state, archive projects, then hard-delete V2-owned rows after the 30-day grace period
- Final product QA and visual review with direct `agent-browser` UI interaction after Weeks 1-8 are implemented in code. Do not use checked-in custom scripts for browser/product QA, prompt submission, auth, or final E2E.
- Performance and abuse-prevention review through manual local QA, Workers/Next logs, and Cloudflare/Blaxel metrics. Do not run a custom load driver unless the user explicitly restores that scope in `plan.md`.
- Rate-limit + abuse-prevention final pass
- **Milestone:** Production readiness checks pass, including the final direct `agent-browser` QA gate. Marketing/docs/demo launch prep is owner-managed outside this engineering plan.

### 17.9 Delivery risk & descope order

The 8-week scope above is **deliberately ambitious** — sandboxed codegen, browser automation, docs generation, research, billing, 9 skills, and skill publishing is a lot for the window. V1 scope is **locked** — no feature is cut pre-emptively (see `future.md` for what already isn't in V1). But ambition without a fallback is how launches slip silently, so this is the **pre-agreed descope order**: if a week genuinely slips, items move to a fast-follow (v1.0.x, days after launch — *not* `future.md`) strictly top-down. Nothing below is removed unless a week actually slips; the list only fixes *what gives first*, so the call is made calmly instead of in a week-8 panic.

| Order | First to move to fast-follow | Why it's safe to defer | Still ships at launch |
|---|---|---|---|
| 1 | External skill publishing (`cheatcode/cheatcode-skills` repo + `skills.sh` link) | Out of V2; owner-managed launch work | The 9 bundled in-product skills themselves |
| 2 | Separate wide-research skill (25-way fan-out) | Folded into deep-research as fan-out mode | Deep research fan-out mode |
| 3 | Mobile-app build skill | Web/app builder covers the core promise | App-builder + general agent |

**Never descoped — the non-negotiable V1 core** (this is Codex's "simpler V1" floor, treated as the launch gate): auth + BYOK + sandbox + SSE chat streaming + file/code tools + billing/quota + ≥2 flagship skills. If *these* are at risk, the launch **date** moves — scope below the line is never raided to protect them.

Weekly checkpoint: every Friday, if the week's milestone is not demoable, the top unstarted descope item moves **that day** — not at week 8.

---

## 18. Setup & Run Commands

### 18.1 First-time setup

```bash
# Clone + install
git clone https://github.com/cheatcode/cheatcode.git
cd cheatcode
pnpm install

# Set up Supabase, then apply migrations (pre SQL → Drizzle → post SQL, §7.10)
pnpm supabase init
pnpm supabase link --project-ref <ref>
pnpm tsx scripts/migrate.ts --apply

# Regenerate Drizzle types from schema
pnpm turbo db:generate

# Bundle skills/* into packages/skills/src/generated.ts
pnpm turbo skills:build

# Create Cloudflare Worker projects
cd apps/web && wrangler init --no-deploy
cd ../gateway-worker && wrangler init --no-deploy
cd ../agent-worker && wrangler init --no-deploy
cd ../webhooks-worker && wrangler init --no-deploy
cd ../..

# Verify trycheatcode.com zone exists + DNS is in Cloudflare
wrangler dns list --zone trycheatcode.com
# Should show CNAME records for gateway / webhooks (per Appendix B)

# Deploy Workers (dry-run first; routes from wrangler.jsonc bind them automatically)
# The order is agent -> gateway -> web -> webhooks so service bindings resolve
# before the Cloudflare-hosted frontend is published.
pnpm deploy:workers
# Run only after explicit production approval.
CHEATCODE_PROD_DEPLOY_APPROVED=true pnpm deploy:workers -- --apply

# Verify routes attached
wrangler deployments list --name cheatcode-gateway
wrangler triggers list --name cheatcode-gateway      # confirms gateway.trycheatcode.com/*

# Set secrets in Cloudflare Secrets Store
wrangler secrets-store store list --remote
pnpm sync:secrets -- --env-file apps/web/.env.local --env-file apps/webhooks-worker/.dev.vars
pnpm sync:secrets -- --env-file apps/web/.env.local --env-file apps/webhooks-worker/.dev.vars --store-id <STORE_ID> --apply

# Configure Hyperdrive
wrangler hyperdrive create cheatcode-db \
  --connection-string="postgresql://..."
# Copy the returned Hyperdrive config id into every Worker wrangler.jsonc.
pnpm prod:set-hyperdrive -- --id <HYPERDRIVE_CONFIG_ID> --apply

# Create the entitlement KV cache and copy the returned id into
# gateway-worker and webhooks-worker wrangler.jsonc `ENTITLEMENTS_CACHE`.
wrangler kv namespace create cheatcode-entitlements-cache

# Build/push Blaxel sandbox image
cd infra/containers/sandbox
docker build -t sandbox/cheatcode-sandbox:yoo6c20wgw03 .
bl push
cd ../../..

# Initial deploy is the guarded `pnpm deploy:workers -- --apply` command above.
```

### 18.2 Local development

```bash
# Run everything locally
pnpm dev

# This starts (via Turborepo):
# - apps/web on http://localhost:3000 (Next.js dev server)
# - apps/gateway-worker on http://localhost:8787 (wrangler dev)
# - apps/agent-worker on http://localhost:8788 (wrangler dev)
# - All other workers on subsequent ports
# - Miniflare for DOs + Workflows
# - Hosted Blaxel sandboxes for sandbox-backed tools
```

### 18.3 Per-app commands

```bash
# Build a single app
pnpm turbo build --filter=@cheatcode/agent-worker

# Generate DB types after schema change
pnpm turbo db:generate

# Create a migration
pnpm --filter @cheatcode/db drizzle-kit generate

# Apply reviewed migrations locally
pnpm tsx scripts/migrate.ts --apply

# Deploy a single worker
cd apps/agent-worker && wrangler deploy
```

### 18.4 Skill development

```bash
# Add a new skill
mkdir -p skills/my-skill/references
$EDITOR skills/my-skill/SKILL.md

# Review skill loading through the final UI QA gate; do not add a local
# skill-eval or package test script.

```

### 18.5 Environment variables

`.env.local` at root holds dev vars **shared by all apps** (symlinked in). App-specific secrets live in each app's own `.dev.vars` (§27.6). It **never** contains `service_role`.

```bash
# Cloudflare
CLOUDFLARE_API_TOKEN=
CLOUDFLARE_ACCOUNT_ID=
CLOUDFLARE_ANALYTICS_API_TOKEN=     # Least-privilege token for Analytics Engine SQL watchdog.
OUTPUT_DOWNLOAD_SIGNING_SECRET=

# Blaxel + agent runtime
BL_API_KEY=
BL_WORKSPACE=cheatcode
BL_REGION=us-pdx-1
BLAXEL_SANDBOX_IMAGE=sandbox/cheatcode-sandbox:yoo6c20wgw03
BLAXEL_SANDBOX_MEMORY_MB=4096

# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
DATABASE_URL=                       # Workers/Next connect as the app_worker role (RLS-bound, §7.2)
# SUPABASE_SERVICE_ROLE_KEY is intentionally ABSENT — it bypasses RLS and must
# never reach a Worker or Next. The admin/DDL connection used ONLY by
# scripts/migrate.ts is SUPABASE_MIGRATION_URL, kept OUT of this shared file:
# a GitHub secret in CI, a git-ignored .env.migrate locally.

# Clerk
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=

# Polar
NEXT_PUBLIC_POLAR_PRO_MONTHLY_PRODUCT_ID=
POLAR_PRODUCT_ID_PRO=            # tier-based checkout (§28.3); server maps {tier} → product id
POLAR_PRODUCT_ID_PREMIUM=
POLAR_PRODUCT_ID_ULTRA=
POLAR_PRODUCT_ID_MAX=
POLAR_ACCESS_TOKEN=
POLAR_WEBHOOK_SECRET=

# Composio
COMPOSIO_API_KEY=
COMPOSIO_AUTH_CONFIGS={"github":"ac_...","gmail":"ac_...","slack":"ac_...","notion":"ac_...","linear":"ac_..."}
COMPOSIO_WEBHOOK_SECRET=

# Internal ops alerts
INTERNAL_ALERT_WEBHOOK_SECRET=
INTERNAL_MAINTENANCE_SECRET=        # May reuse INTERNAL_ALERT_WEBHOOK_SECRET locally; bound to agent + gateway + webhooks.

# Observability — V1 is Cloudflare-native only (Workers Logs + Tracing + Analytics Engine).
# No external log sink, no AI observability tool.

# Gateway URL
NEXT_PUBLIC_GATEWAY_URL=https://gateway.trycheatcode.com
```

---

## 19. Known Risks

> Forward-looking items (v1.5 candidates, deferred features, items cut from V1) live in [`future.md`](./future.md). This section is strictly V1 risks + mitigations.



| Risk | Mitigation |
|---|---|
| Blaxel SDK/Sandbox APIs are fast-moving | Pin `@blaxel/core@0.2.84`, keep research log current, and verify SDK usage against docs before each sandbox milestone |
| Blaxel free-tier concurrency/TTL limits | Monitor active sandboxes and standby storage; set project expiration policies and upgrade quota tier before launch traffic |
| Mastra v1.x still evolving | Pin to 1.35.0; track release notes |
| AI SDK v6 Gateway reliability issues | Skip Gateway — use direct providers with BYOK |
| OpenNext Cloudflare adapter edge cases | Manually QA auth, streaming, cache, and responsive app flows in `opennextjs-cloudflare preview` before deploy |
| Inngest replaced by Workflows (less battle-tested) | Workflows is GA; have observability to catch issues |
| Cloudflare or Blaxel outage | Multi-vendor runtime risk accepted; gateway/agent state is Cloudflare, sandbox execution is Blaxel, and user artifacts are recoverable from DB/R2 where persisted |

---

## 20. Legacy Cleanup

> The repo currently contains the previous Python/FastAPI Cheatcode V1 codebase
> under `cheatcode/`. **Do not delete, rewrite, or move the V1 code unless the
> user explicitly asks you to delete the V1 code by name in a future request.**
> V2 is still a
> greenfield TypeScript implementation, but the preserved V1 tree remains local
> reference material for UI parity, behavior checks, and archaeology.
> The default policy is preservation, not cleanup: no agent should infer
> permission to remove V1 from this section title, migration work, local
> validation, or broad repository tidying.

**Frontend visual continuity exception:** the V1 frontend remains the product-design reference for the V2 web app. Its dark thread workspace, sidebar/header composition, input styling, status treatment, and logo assets may be reused as visual/interaction source material and reimplemented in `apps/web`. This does **not** permit importing the old runtime architecture, API clients, Supabase auth/data patterns, generated `.next` output, package versions, or state-management code; all shipped code still targets the V2 stack in Section 10.

### 20.1 Legacy preservation policy

1. `cheatcode/` is preserved and ignored by V2 tooling. Do not include it in
   V2 builds, linting, static checks, deploys, or dependency resolution.
2. Read V1 when needed to match UI/UX, copy assets, understand previous
   behavior, or compare flows. Reimplement in the V2 stack rather than importing
   V1 runtime code.
3. Do not run destructive commands such as `rm -rf cheatcode/`, `git clean`,
   or broad cleanup scripts that would remove legacy files.
4. If the user later explicitly asks to delete V1, first create or verify a
   durable legacy snapshot branch/archive, then perform a scoped cleanup with a
   clear file list and post-cleanup validation.
   Do not perform this step for any generic "cleanup", "simplify", "ship V2",
   "remove legacy", or architecture-alignment request unless the user explicitly
   names V1 deletion as the requested action.
5. Existing V1 Supabase tables are also preserved in place. V2 continues to use
   `v2_`-prefixed tables in the same database and never resets, renames, or
   deletes V1 tables.

### 20.2 Files to rewrite from scratch

| Path | Action |
|---|---|
| `README.md` | Full rewrite — project description, install steps, link to `plan.md` |
| `CLAUDE.md` | Full rewrite — see Section 22 |
| `AGENTS.md` | **New file** — cross-tool AI agent context (Codex/Cursor/Gemini CLI) — see Section 22 |
| `.gitignore` | Rewrite — new monorepo: `.turbo`, `.wrangler`, `.next`, `.open-next`, `packages/skills/src/generated.ts`, `coverage`, `*.tsbuildinfo` |
| `.env.example` | Match Section 18.5 exactly |
| `.editorconfig` | Add — `tab_width = 2`, `end_of_line = lf`, `insert_final_newline = true` |

### 20.3 What survives

| Path | Why kept |
|---|---|
| `.git/` | History retained for archaeology + the `legacy/pre-v2-snapshot` branch |
| `LICENSE` | Reused |
| `plan.md` | This file — locked source of truth |

### 20.4 Post-cleanup verification

After running 20.1, repo root should contain only:

```
.git/
.gitignore                      (new)
.editorconfig                   (new)
.env.example                    (new)
README.md                       (new)
CLAUDE.md                       (new)
AGENTS.md                       (new)
LICENSE                         (kept)
plan.md                         (kept)
```

Everything else is created during Week 1.

---

## 21. Code Quality, Strict Mode & Lint Policy

This section codifies the engineering standards every line of TypeScript in the repo must meet. The standards are **CI-enforced**, not aspirational. Most are mechanical (Biome rules + tsconfig flags); a few are policy (branded IDs, structured logging, idempotent tools, no `process.env`).

The principle: **strict from day one, not retrofitted.** A new codebase has zero strictness debt — we keep it that way.

### 21.1 TypeScript strict mode (full configuration)

Maximum strictness from line one. `tsconfig.base.json` at repo root, extended by every package:

```jsonc
// tsconfig.base.json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "compilerOptions": {
    // ─── Target / Module ──────────────────────────────────────
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "bundler",         // Next.js + Wrangler both bundle
    "moduleDetection": "force",            // Every file is a module
    "lib": ["ES2023"],                     // Per-package overrides add DOM / WebWorker

    // ─── Strictness (every flag, on purpose) ──────────────────
    "strict": true,                        // Enables the 8 strict-family flags below
    "noImplicitAny": true,
    "strictNullChecks": true,              // Highest-ROI flag
    "strictFunctionTypes": true,
    "strictBindCallApply": true,
    "strictPropertyInitialization": true,
    "noImplicitThis": true,
    "alwaysStrict": true,
    "useUnknownInCatchVariables": true,    // catch (e) is unknown — forces narrowing

    // ─── Beyond strict ────────────────────────────────────────
    "noUncheckedIndexedAccess": true,      // arr[i] => T | undefined — catches off-by-one
    "exactOptionalPropertyTypes": true,    // { x?: T } rejects { x: undefined } unless declared
    "noImplicitOverride": true,            // Must write `override` keyword
    "noFallthroughCasesInSwitch": true,    // Missing `break` is an error
    "noPropertyAccessFromIndexSignature": true, // Force obj["k"] for index signatures
    "noUncheckedSideEffectImports": true,  // TS 5.6+
    "noImplicitReturns": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,            // Prefix _ to opt out
    "allowUnreachableCode": false,
    "allowUnusedLabels": false,

    // ─── Module hygiene ───────────────────────────────────────
    "verbatimModuleSyntax": true,          // Required for SWC/esbuild ESM
    "isolatedModules": true,               // Each file transpilable in isolation
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "allowImportingTsExtensions": false,

    // ─── Emit ─────────────────────────────────────────────────
    "noEmit": true,                        // Library packages override to false
    "declaration": false,                  // Library packages override to true
    "declarationMap": false,
    "sourceMap": true,
    "removeComments": false,
    "preserveConstEnums": true,
    "importHelpers": true,                 // Use tslib

    // ─── Performance ──────────────────────────────────────────
    "skipLibCheck": true,
    "incremental": true,
    "tsBuildInfoFile": ".tsbuildinfo",

    // ─── JSX (consumers override) ─────────────────────────────
    "jsx": "preserve",

    // ─── Misc ─────────────────────────────────────────────────
    "baseUrl": ".",
    "noErrorTruncation": true,
    "useDefineForClassFields": true,
    "types": []                            // Each package opts in explicitly
  },
  "exclude": ["node_modules", "dist", ".next", ".turbo", "coverage"]
}
```

**Per-package overrides:**

```jsonc
// apps/web/tsconfig.json (Next.js)
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "preserve",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "plugins": [{ "name": "next" }],
    "types": ["node"],
    "paths": { "@/*": ["./src/*"], "@cheatcode/*": ["../../packages/*/src"] }
  },
  "include": ["next-env.d.ts", "src/**/*", "**/*.ts", "**/*.tsx"]
}

// apps/gateway-worker/tsconfig.json (and all Workers)
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2023", "WebWorker"],
    "types": ["@cloudflare/workers-types/2023-07-01"],
    "paths": { "@/*": ["./src/*"], "@cheatcode/*": ["../../packages/*/src"] }
  },
  "include": ["src/**/*", "worker-configuration.d.ts"]
}

// packages/<lib>/tsconfig.json (libraries)
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": false,
    "declaration": true,
    "declarationMap": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"]
}
```

### 21.2 Biome 2.x configuration (full `biome.jsonc`)

Biome handles 100% of formatting and ~95% of linting. ESLint runs only for Next.js-specific rules Biome doesn't cover.

```jsonc
// biome.jsonc (root)
{
  "$schema": "https://biomejs.dev/schemas/2.4.0/schema.json",
  "vcs": {
    "enabled": true,
    "clientKind": "git",
    "useIgnoreFile": true,
    "defaultBranch": "main"
  },
  "files": {
    "ignoreUnknown": true,
    "includes": [
      "**",
      "!**/dist",
      "!**/.next",
      "!**/.turbo",
      "!**/.wrangler",
      "!**/.open-next",
      "!**/coverage",
      "!**/*.gen.ts",
      "!**/worker-configuration.d.ts",
      "!packages/skills/src/generated.ts"
    ]
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100,
    "lineEnding": "lf"
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "double",
      "semicolons": "always",
      "trailingCommas": "all",
      "arrowParentheses": "always"
    }
  },
  "css": {
    "parser": {
      "tailwindDirectives": true
    }
  },
  "assist": {
    "enabled": true,
    "actions": {
      "source": {
        "organizeImports": "on"
      }
    }
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,

      "correctness": {
        "useExhaustiveDependencies": "error",
        "useHookAtTopLevel": "error",
        "noUnusedImports": "error",
        "noUnusedVariables": "error",
        "noUnusedFunctionParameters": "warn",
        "noUnusedPrivateClassMembers": "error",
        "noUndeclaredDependencies": "error"
      },

      "suspicious": {
        "noExplicitAny": "error",
        "noConsole": {
          "level": "error",
          "options": { "allow": ["error", "warn", "info"] }
        },
        "noEmptyBlockStatements": "error",
        "noEvolvingTypes": "error",
        "noAssignInExpressions": "error",
        "noFocusedTests": "error"
      },

      "style": {
        "useImportType": "error",
        "useExportType": "error",
        "useNodejsImportProtocol": "error",
        "useNamingConvention": {
          "level": "warn",
          "options": {
            "strictCase": false,
            "conventions": [
              { "selector": { "kind": "typeLike" }, "formats": ["PascalCase"] },
              { "selector": { "kind": "variable", "scope": "global" }, "formats": ["camelCase", "CONSTANT_CASE", "PascalCase"] },
              { "selector": { "kind": "function" }, "formats": ["camelCase", "PascalCase"] }
            ]
          }
        },
        "noDefaultExport": "off",
        "noNonNullAssertion": "warn",
        "useConst": "error",
        "useTemplate": "error"
      },

      "complexity": {
        "noExcessiveCognitiveComplexity": {
          "level": "error",
          "options": { "maxAllowedComplexity": 15 }
        },
        "noBannedTypes": "error",
        "noStaticOnlyClass": "error",
        "noUselessConstructor": "error"
      },

      "performance": {
        "noBarrelFile": "warn",
        "noReExportAll": "error",
        "noDelete": "error"
      },

      "security": {
        "noGlobalEval": "error",
        "noDangerouslySetInnerHtml": "error"
      },

      "nursery": {
        "noFloatingPromises": "error",
        "noMisusedPromises": "error",
        "useSortedClasses": {
          "level": "warn",
          "options": { "functions": ["clsx", "cva", "cn", "tw"] }
        },
        "noTopLevelSideEffects": "error"
      }
    },
    "domains": {
      "react": "recommended",
      "next": "recommended"
    }
  },
  "overrides": [
    {
      "includes": [
        "**/app/**/page.tsx",
        "**/app/**/layout.tsx",
        "**/app/**/route.ts",
        "**/app/**/loading.tsx",
        "**/app/**/error.tsx",
        "**/app/**/not-found.tsx",
        "**/app/**/template.tsx",
        "**/middleware.ts",
        "**/next.config.ts",
        "**/wrangler.config.ts",
        "**/src/index.ts",
        "**/mastra.config.ts"
      ],
      "linter": { "rules": { "style": { "noDefaultExport": "off" } } }
    },
    {
      "includes": ["**/src/services/**", "**/src/lib/**", "**/src/domain/**"],
      "linter": { "rules": { "style": { "noDefaultExport": "error" } } }
    },
    {
      "includes": ["**/src/agents/**", "**/src/tools/**"],
      "linter": {
        "rules": {
          "suspicious": { "noGlobalAssign": "error" },
          "correctness": { "noGlobalObjectCalls": "error" }
        }
      }
    },
    {
      // The structured logger is the ONE sanctioned console.* writer — Workers Logs
      // ingests its JSON output (§13.7). Build/CLI scripts run top-level by design
      // and write to stdout. These two relaxations apply ONLY to these paths;
      // everywhere else noConsole + noTopLevelSideEffects stay `error`.
      "includes": ["packages/observability/src/logger.ts", "**/scripts/**"],
      "linter": {
        "rules": {
          "suspicious": { "noConsole": "off" },
          "nursery": { "noTopLevelSideEffects": "off" }
        }
      }
    }
  ]
}
```

Every code example in this plan is held to this config — no `as any`, no `z.any()`, no `require()`, no stray `console.log` outside the two override paths above. Where a heavy type is unavoidable, the examples derive it (`ComponentProps<typeof X>`, `isToolUIPart()` narrowing) rather than escaping to `any`.

### 21.3 ESLint as gap-filler (minimal)

Biome 2 covers `react-hooks/exhaustive-deps` (via `useExhaustiveDependencies`), `tailwindcss/classnames-order` (via `useSortedClasses`), and most React/Next patterns. **The only remaining gap: Next.js framework rules from `eslint-config-next`** (`@next/next/no-html-link-for-pages`, `@next/next/no-img-element`, etc.).

Minimal ESLint setup, only in `apps/web/`:

```js
// apps/web/eslint.config.mjs
import next from "eslint-config-next";
export default [...next];
```

Run in CI only, not pre-commit (Biome covers the 95% there).

### 21.4 Code organization rules

| Limit | Value | Enforced by |
|---|---|---|
| File size | **800 lines** hard cap, 500 soft | CI script: `wc -l` gate |
| Function size | **50 lines** hard cap | Code review |
| Cognitive complexity | **15** | Biome `noExcessiveCognitiveComplexity` |
| Max parameters | **4** | Code review (use options object beyond) |
| Max nesting depth | **3** | Code review (use early returns) |

**Exports:** named everywhere except framework-required defaults (Next.js routing, Worker entries, Mastra agent/workflow definitions, config files). Enforced via Biome overrides.

**Naming:**
- Files: `kebab-case.ts` for code, `PascalCase.tsx` for React components, `*.types.ts` for type-only
- Types/interfaces: `PascalCase`. No `I` prefix.
- Functions/variables: `camelCase`. Booleans prefixed `is/has/can/should`.
- Constants: `UPPER_SNAKE_CASE` only for true module-level immutables.
- Hooks: `useCamelCase`.

**Folder structure per package:**
```
src/
  index.ts             public API barrel (only at package root)
  domain/              entities, branded types, value objects
  services/            framework-agnostic business logic
  adapters/            I/O wrappers (db, http, ai-sdk, sandbox)
  routes/ or app/      framework entry points
  lib/                 cross-cutting utilities
  types/               ambient types only
```

### 21.5 Type safety patterns

**Branded types for every entity ID:**

```ts
// packages/types/src/ids.ts
type Brand<T, B> = T & { readonly __brand: B };
export type UserId      = Brand<string, "UserId">;
export type ProjectId   = Brand<string, "ProjectId">;
export type ThreadId    = Brand<string, "ThreadId">;
export type AgentRunId  = Brand<string, "AgentRunId">;
export type SandboxId   = Brand<string, "SandboxId">;
// ... one per entity

export const UserId = (s: string) => s as UserId;
// ... constructor per type
```

Prevents passing `projectId` where `userId` is expected at compile time.

**Discriminated unions over class inheritance:**
```ts
type AgentEvent =
  | { type: "text"; text: string }
  | { type: "tool-call"; toolName: string; input: unknown }
  | { type: "tool-result"; toolCallId: string; output: unknown }
  | { type: "reasoning"; reasoning: string };
```

**Result types** for predictable failures (validation, parsing, billing checks). Throw only for programmer errors and truly exceptional infra failures:
```ts
type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };
```

**Zod 3.25 runtime validation at every trust boundary** — HTTP input, LLM output, env, webhook payloads, DB rows you don't own. Pair `z.infer` with the schema; never define both manually. (Pinned `zod@3.25.76` per §4.1 — 3.25 implements Standard Schema, so it interoperates with `@hookform/resolvers` 5.x and AI SDK v6 tool schemas.)

**`unknown` always, `any` never.** Biome enforces.

**`as` casts only in two cases:** (1) `as const` for literal narrowing; (2) `as unknown as X` at trusted boundaries with an inline comment explaining why. Everywhere else: type guards or `satisfies`.

**Generics only when ≥2 concrete use sites exist.** Premature generics = unreadable code.

**Type guards** (`function isX(x): x is X`) at boundaries where Zod is overkill (e.g., tagged messages from a Durable Object).

### 21.6 Import organization

- Biome's `organizeImports` runs on save. Order: builtins → externals → workspace (`@cheatcode/*`) → relative (`./`).
- Path aliases: `@/*` per package (own tsconfig paths), `@cheatcode/*` for workspace. Relative imports only within the same `src/` subfolder.
- Cycle detection: `madge --circular --extensions ts,tsx` in CI (Biome doesn't catch).
- Side-effect imports forbidden except `import "server-only"`, `import "client-only"`, and CSS. Enforced by Biome.
- Dynamic imports (`await import()`) allowed only in Next.js for code-splitting heavy deps. **Forbidden inside Workers** (no eval-class loaders at runtime).

### 21.7 Pre-commit + pre-push hooks (Lefthook)

**Lefthook** in 2026 — Go binary, parallel-by-default, ~10× faster than Husky on monorepos, no Node dependency.

```yaml
# lefthook.yml
pre-commit:
  parallel: true
  commands:
    biome-staged:
      glob: "*.{ts,tsx,js,jsx,json,jsonc}"
      run: pnpm biome check --staged --write {staged_files}
      stage_fixed: true
    typecheck-changed:
      glob: "*.{ts,tsx}"
      run: pnpm turbo typecheck --filter='...[origin/main]' -- --noEmit

pre-push:
  parallel: true
  commands:
    biome-full:
      run: pnpm biome check .
    typecheck-full:
      run: pnpm turbo typecheck

commit-msg:
  commands:
    commitlint:
      run: pnpm commitlint --edit {1}
```

**Pre-commit budget: <5s.** If it crosses, engineers bypass it. Pre-push: <60s.

### 21.8 Validation policy: no scripted tests

- V2 manifests/catalog do not include Vitest, `@cloudflare/vitest-pool-workers`,
  or shared `@cheatcode/vitest-config`; the source tree has no `*.test.ts`
  files, package `test` scripts, Turbo `test` task, smoke scripts, E2E scripts, load drivers,
  prompt-submission harnesses, scripted accessibility passes, or scripted
  browser/product-flow automation.
- Do not add Playwright/Selenium/Cypress/Stagehand/agent-browser wrapper scripts
  for validation. `agent-browser` is invoked directly by the agent in the
  terminal with `--auto-connect --session cheatcode-debug`, using the
  snapshot-ref workflow and real click/fill/type operations.
- Product QA commands must stay literal and inspectable in the transcript:
  direct `agent-browser` commands plus direct log/console/network inspection.
  No hidden loop, CLI wrapper, generated TypeScript/Python/Node driver, or
  one-off shell script may stand in for clicking through the UI.
- Do not batch product QA behind shell aliases/functions, `pnpm` entries,
  helper files, or chained commands that behave like a flow runner. For final
  acceptance, each meaningful navigation, click, fill, snapshot, screenshot,
  console read, and log inspection is issued directly so the transcript itself
  is the evidence trail.
- Do not generate temporary product QA scripts during development. When a
  validation step requires a user-like action, operate the UI directly and check
  console/network/app logs; if a throwaway validator already exists in the V2
  tree, remove it rather than running it. This also applies outside the repo:
  do not create local shell, TypeScript, Python, Node, Playwright, Stagehand, or
  `agent-browser` wrapper files to test product flows.
- The deletion rule is strict: product-flow validators, prompt runners,
  scripted UI drivers, scripted accessibility checks, scripted load checks,
  scripted browser sessions, and custom wrappers around `agent-browser` are
  removed on sight. Do not keep them around as "temporary" helpers.
- The `scripts/` directory is not a testing surface. Keep only operational
  implementation helpers there; remove any file whose purpose is to validate
  product behavior, submit prompts, operate auth flows, drive browsers, or
  gather final acceptance evidence.
- Operational helpers may start services, build artifacts, migrate databases,
  sync secrets, or run guarded deploy orchestration, but they must not include
  product assertions or be cited as product QA. The only product QA evidence is
  direct UI operation plus console/network/app-log review.
- This rule is filename-agnostic. A command named `validate`, `check`, `demo`,
  `walkthrough`, or `replay` is still deleted when it drives product behavior,
  submits prompts, opens browsers, clicks UI, checks accessibility/load, or
  gathers acceptance evidence. Standalone configuration/resource validators are
  not part of the V2 command surface; required guardrails live inside the
  operation that needs them, such as migration target checks inside
  `scripts/migrate.ts`.
- This is a delete-first policy for product QA scripts. If such a script
  appears, remove the file or package entry immediately; do not run it once
  "just to check", move it to `/tmp`, keep it as a private helper, or replace it
  with a shell loop.
- "Testing" in V2 product work always means operating the real UI with direct
  `agent-browser` commands, clicking/filling/typing through the app, taking
  screenshots, and reading console/network/app logs. It never means a Node,
  TypeScript, Python, shell, Playwright, Cypress, Selenium, Stagehand, curl, or
  `agent-browser` wrapper, even when the file is temporary or outside the repo.
- May 27, 2026 user override: never use scripts for product testing. Product QA
  must be direct UI operation with `agent-browser`, visible click/fill/type
  commands, screenshots, console/network inspection, and app-log review.
- May 28, 2026 hardening: do not wrap product QA in `pnpm`, `tsx`, shell loops,
  `/tmp` helpers, generated files, browser-driver wrappers, package aliases, or
  any scripted flow. Each UI action, screenshot, console read, network/resource
  inspection, and app-log inspection must be issued directly in the transcript.
  Typecheck/lint/build remain code-health gates only; they are not product QA.
- May 28, 2026 explicit cleanup rule: if a testing script exists, delete it
  instead of fixing or running it. If an audit finds no V2 product-testing
  scripts, continue with direct UI/log QA; do not create a replacement wrapper.
- May 28, 2026 latest override: never use scripts for product testing. Final
  product verification is direct `agent-browser` UI interaction, screenshots,
  browser console/network inspection, and Worker/Next/Blaxel log review. Delete
  product-flow scripts, wrapper commands, generated browser drivers, curl
  flows, shell loops, and temporary helpers immediately; operational scripts may
  remain only for setup/build/migration/secret/deploy/admin chores and cannot
  serve as acceptance evidence.
- May 28, 2026 user cleanup directive: do not run scripted testing first and
  clean up later. If the file, command, shell loop, generated helper, package
  alias, or browser wrapper exists to validate product behavior, submit a chat
  prompt, drive auth, click UI, collect screenshots, inspect network output, or
  replace real UI operation, delete it immediately. Final acceptance is the
  visible direct `agent-browser` workflow plus direct browser console/network
  and Worker/Next/Blaxel log review.
- May 27, 2026 delete audit: no V2 product-test scripts should exist. Any newly
  discovered product validator is deleted immediately. Preserved V1 tests under
  `cheatcode/` are ignored reference material and are not run or copied into V2.
- May 28, 2026 artifact cleanup: stale root `qa-*.png` files and `.qa/` folders
  are removed from V2. Future screenshots are final direct `agent-browser`
  evidence only and must not become source-tree fixtures or scripted QA assets.
- Final acceptance happens after Weeks 1-8 are implemented in code. The agent
  must operate the UI directly: login, project chat, streaming, preview,
  code/data/env/browser/terminal tabs, settings, billing, BYOK, integrations,
  generated outputs, and mobile layouts. Re-snapshot after DOM changes, capture
  screenshots, inspect browser console/resource behavior, and review running
  Next/Wrangler/Worker/Blaxel/Cloudflare logs.
- Typecheck, lint, build, dependency checks, and migration generation remain
  code-health and operations gates; they are not product-flow testing and must
  not simulate user behavior. The standalone deploy/resource validation command
  surface has been deleted from V2.
- If the user later restores scripted testing, Section 4 must first be updated
  with exact dependency pins and this section must name the allowed scripts,
  scope, and acceptance role.

### 21.9 Anti-patterns codified in lint

| Anti-pattern | Enforcement |
|---|---|
| `any` | Biome `noExplicitAny: error` |
| `as` without guard | Biome `noNonNullAssertion: warn` + review |
| `console.log` | Biome `noConsole: error` (allow `error`/`warn`/`info`) |
| Empty catch | Biome `noEmptyBlockStatements` |
| Unused exports | `knip` in CI |
| Magic numbers | Biome `noMagicNumbers` (allow `0`, `1`, `-1`, `2`) — soft warn |
| File >800 lines | CI script: `wc -l` gate |
| Direct `process.env` | Biome `noRestrictedImports` of `process` from non-env packages; force `import { env } from "@cheatcode/env"` |
| Imports from `dist/`/`build/` | Biome `noRestrictedImports` |
| Direct DB access bypassing `packages/db` | Biome `noRestrictedImports` |
| Top-level side effects | Biome `noTopLevelSideEffects` (nursery) |
| `eval` / `Function()` / dynamic `import()` of user code | Biome `noGlobalEval` + review |

### 21.10 AI-agent-specific quality patterns

- **Determinism:** pure agent logic accepts injected `now: () => Date` and `random: () => number`. Direct `Date.now()`/`Math.random()` allowed only in adapters. Enforced via Biome `noRestrictedGlobals` on `src/agents/**` and `src/tools/**`.
- **Idempotent tools:** every Mastra tool accepts an `idempotencyKey` or is safe to retry. Document in JSDoc.
- **Logging discipline:** BYOK keys never logged. `redactSecrets()` wraps every `log()` call. CI greps for `console.log(.*key)` patterns.
- **Cost-conscious:** Anthropic `cacheControl: { type: 'ephemeral' }` on every system prompt and tool definition. Track per-step tokens via Workers Analytics Engine (Section 13.6).
- **LLM-readable errors:** every thrown error from a tool returns a structured object: `{ code, message, hint, retriable }`. The agent loop reads `hint` to self-correct.

### 21.11 Cloudflare Workers safety patterns

- **No global state** — each isolate is short-lived and shared across users. Never store user-specific state in module scope. Use DOs, request locals, or `ctx.props`.
- **Memory budget ~128MB per isolate**, CPU ~50ms paid plan. Stream request/response bodies; never buffer to memory unless <1MB.
- **No `eval`, `Function()`, or dynamic `import()` of user code.** Workers refuse at runtime; enforce statically via Biome.
- **`wrangler types` generates `Env` types** — never hand-write.
- **`compatibility_date` kept current**, `nodejs_compat` enabled.

### 21.12 What NOT to enforce for V1

- Coverage targets — V2 has no scripted test runner; validate by UI/logs after the all-weeks code surface is implemented
- JSDoc on every internal function — only public package APIs + Mastra tool definitions
- Hungarian notation, `I`-prefixed interfaces, `_private` underscores
- Excessive abstraction layers (controller → service → repository → mapper → entity → DTO for a CRUD route)
- Premature perf optimization in pre-LLM-call code paths — LLM dominates latency
- Stylistic bikeshedding (Biome defaults are the answer)

### 21.13 The 10-rule policy

1. **No `any`, ever.** Biome `noExplicitAny: error`. Use `unknown` + narrowing or Zod. Fails CI.
2. **No file > 800 lines.** CI gates. Refactor before merging.
3. **No function > 50 lines or cognitive complexity > 15.** Biome enforces. Extract or simplify.
4. **No `console.log`.** Use the structured logger from `packages/observability`. Logger redacts secrets.
5. **No direct `process.env`.** Import from `@cheatcode/env` (t3-env + Zod). One source of truth.
6. **No floating promises.** Biome `noFloatingPromises: error`. Every promise is awaited, voided, or chained.
7. **All trust boundaries Zod-validated.** HTTP input, LLM output, env, webhooks. No exceptions. Worker env validation is centralized in `packages/env/src/worker.ts` and applied at the `fetch`/`scheduled` entrypoint for gateway, agent, and webhooks Workers before route logic runs.
8. **Branded IDs for every entity.** Mixing fails at compile time.
9. **Default exports only where the framework demands.** Everywhere else: named exports.
10. **Pre-commit passes in <5s.** Lefthook + Biome `--staged`. Hook stays trustworthy.

### 21.14 Tooling installed at repo init

All tooling versions are pinned in the §4.1 catalog (`pnpm-workspace.yaml`) and the root `package.json` `devDependencies` (every entry `catalog:`) — both committed. Repo init is therefore just:

```bash
pnpm install                 # installs the whole workspace from the committed catalog
pnpm dlx lefthook install    # wire git hooks — once per clone
```

To **add** a tool later: add it to the §4.1 catalog, then `pnpm add -Dw <pkg>@catalog:`. Never pin a version outside the catalog — that is the rule that keeps the stack genuinely locked.

---

## 22. Repo Documentation Files

Three files at repo root, three audiences:

| File | Audience | Auto-loaded by |
|---|---|---|
| `README.md` | Humans (engineers, GitHub visitors) | n/a |
| `CLAUDE.md` | Claude Code | Claude Code CLI/IDE |
| `AGENTS.md` | OpenAI Codex, Cursor, Gemini CLI, Aider, Cline, etc. | Open spec — every modern AI coding agent |

### 22.1 Why both CLAUDE.md and AGENTS.md

`AGENTS.md` is the open cross-tool spec (`agents.md`). `CLAUDE.md` is Claude Code's tool-specific file. Most teams ship both because:

- Each tool reads only its own file
- The 80% overlap is fine — duplication is cheaper than wrong context
- Claude-specific guidance (e.g., subagent patterns, hooks) lives only in CLAUDE.md
- Tool-agnostic guidance lives in both

**Don't symlink them.** Drift is healthy — Claude needs to know about subagent patterns; Codex/Cursor users don't care.

### 22.2 Content scope (both files)

Both files contain:

1. **Project overview** — what Cheatcode is, who uses it
2. **Stack at a glance** — TypeScript, Cloudflare Workers, Next.js 16, Mastra, AI SDK v6, etc.
3. **Repo structure** — apps/ and packages/ cheatsheet
4. **Critical conventions** — branded IDs, no `any`, no `console.log`, no `process.env`, BYOK key handling, build-time skill bundling
5. **Common commands** — `pnpm dev`, `pnpm turbo build`, `pnpm turbo skills:build`, etc.
6. **What NOT to do** — anti-patterns Codex/Claude shouldn't introduce
7. **Plan.md as source of truth** — agents must update plan.md before contradicting it

### 22.3 Files committed alongside this plan

After running Section 20.1 cleanup, the next commit creates:
- `README.md` — short, GitHub-facing
- `CLAUDE.md` — see appendix file at repo root
- `AGENTS.md` — see appendix file at repo root

Both files cap at ~200 lines so they don't blow the agent's context budget. They reference `plan.md` for full detail.

---

## 23. API Contracts

> The gateway-worker is the only public surface for the **product API** (`gateway.trycheatcode.com`). There is exactly one other public surface: `webhooks-worker` on `webhooks.trycheatcode.com`, which receives server-to-server provider callbacks only (Polar / Clerk / Composio) — never browser traffic, never the product API. Every other Worker is reached through Service Bindings (RPC, sub-millisecond, no network hop). This section is the **locked contract** for every public route.

### 23.1 API design principles

1. **REST + OpenAPI at the gateway, Hono RPC inter-worker.** Public surface is REST/OpenAPI so AI agents and third-party tools can discover operations. Internal Worker-to-Worker calls use Hono's typed RPC over Service Bindings — type sharing without public coupling.
2. **URL path versioning `/v1/...`** for major versions. Date-header pinning `Cheatcode-Version: YYYY-MM-DD` reserved for future breaking-change rollouts. V1 ships `/v1/` only.
3. **Resource names are plural nouns**, never verbs. Nest only one level deep (`/v1/projects/{id}/threads` is fine; `/v1/projects/{p}/threads/{t}/runs/{r}` is not — flatten).
4. **Cursor pagination on all time-ordered lists.** Opaque base64 cursor encoding `(created_at, id)` so the underlying index can change later without breaking clients.
5. **Status code discipline.** `202 Accepted` for async work creation (returns `Location` + stream/status links). `204 No Content` for resume-stream endpoint when no active stream exists; the client handles this only through explicit active-stream reconnects, not mount-time auto-resume.
6. **`Idempotency-Key` header required** on `POST /v1/runs`. Stored in a per-user DO with 24h TTL (7d for billing-relevant endpoints).
7. **IETF `RateLimit-*` headers** on every response (`RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`).
8. **OpenAPI exposed at the gateway.** `/openapi.json` is generated from the checked-in gateway contract module with stable `operationId`s for every public route. New or heavily edited routes should migrate toward `@hono/zod-openapi` `createRoute(...)` / `app.openapi(...)` definitions so the contract and handler converge over time. `/docs` is a no-dependency built-in docs page for V1; do not add Scalar or a CDN docs UI unless Section 4 first pins that dependency.

### 23.2 The complete route table

| # | Method | Path | Auth | Body schema (Zod) | Response | Status | Rate-limit class |
|---|---|---|---|---|---|---|---|
| 1 | GET | `/v1/me` | JWT | — | `User` | 200 | `read.cheap` |
| 2 | GET | `/v1/limits` | JWT | — | `LimitsSnapshot` | 200 | `read.cheap` |
| 3 | GET | `/v1/usage/daily` | JWT | query: `?days` | `UsageDailyTotals` + `runs[]` (per-run start ts + status for the Activity punchcard, capped 2000 w/ `truncated`; legacy `totals` unchanged) | 200 | `read.cheap` |
| 4 | GET | `/v1/projects` | JWT | query: `?cursor&limit` | `Paginated<Project>` | 200 | `read.cheap` |
| 5 | POST | `/v1/projects` | JWT (Idempotency-Key optional) | `CreateProject { name, mode, masterInstructions?, importRepoUrl? }` | `Project` | 201 + `Location` | `write.normal` |
| 6 | GET | `/v1/projects/{projectId}` | JWT | — | `Project` | 200/404 | `read.cheap` |
| 7 | PATCH | `/v1/projects/{projectId}` | JWT | `UpdateProject` | `Project` | 200 | `write.normal` |
| 8 | DELETE | `/v1/projects/{projectId}` | JWT | — | — | 204/404 | `write.normal` |
| 9 | GET | `/v1/projects/{projectId}/threads` | JWT | `?cursor&limit` | `Paginated<Thread>` | 200 | `read.cheap` |
| 10 | POST | `/v1/projects/{projectId}/threads` | JWT | `CreateThread { title? }` | `Thread` | 201 | `write.normal` |
| 11 | GET | `/v1/threads/{threadId}` | JWT | — | `Thread` | 200/404 | `read.cheap` |
| 12 | GET | `/v1/threads/{threadId}/messages` | JWT | `?cursor&limit` | `Paginated<UIMessage>` | 200 | `read.cheap` |
| 13 | POST | `/v1/threads/{threadId}/runs` | JWT + Idempotency-Key | `CreateRun { message, model?, agentName?, budgetCapUsd? }` | SSE stream (`UI_MESSAGE_STREAM_HEADERS`) | 202 | `runs.create` (cost=10) |
| 14 | GET | `/v1/threads/{threadId}/runs/stream` | JWT (header or `?token=`) | — | SSE stream | 200/204 | `read.expensive` |
| 15 | GET | `/v1/threads/{threadId}/runs/status` | JWT | — | `RunStatus` (gains `paused` + `pendingApproval` snapshot) | 200/204 | `read.cheap` |
| 16 | POST | `/v1/runs/{runId}/cancel` | JWT | — | `{ ok: true }` | 200/404 | `write.normal` |
| 17 | GET | `/v1/outputs/{outputId}/download` | signed URL (`expires&sig`) | — | file stream | 200/410 | `public.read` |
| 18 | POST | `/v1/runs/{runId}/takeover` | JWT | — | `{ vncUrl, resumeToken }` | 200 | `write.normal` |
| 19 | POST | `/v1/runs/{runId}/resume` | JWT | `{ resumeToken }` | `{ ok: true }` | 200 | `write.normal` |
| 20 | GET | `/v1/tools` | JWT | `?domain?` | `Tool[]` | 200 | `read.cheap` |
| 21 | GET | `/v1/agents` | JWT | — | `Agent[]` | 200 | `read.cheap` |
| 22 | GET | `/v1/threads/{threadId}/sandbox/files` | JWT | `?path&recursive&includeHidden` | `SandboxFileList` | 200 | `read.expensive` |
| 23 | GET | `/v1/threads/{threadId}/sandbox/file` | JWT | `?path&encoding?` | `SandboxFile` | 200/404 | `read.expensive` |
| 24 | PATCH | `/v1/threads/{threadId}/sandbox/file` | JWT | `{ path, content, encoding? }` | `SandboxFileWrite` | 200 | `write.normal` |
| 25 | POST | `/v1/threads/{threadId}/sandbox/terminal` | JWT | `{ command, cwd?, timeoutMs? }` | `SandboxTerminalResult` | 200 | `write.normal` |
| 26 | GET | `/v1/integrations` | JWT | — | `Integration[]` | 200 | `read.cheap` |
| 27 | POST | `/v1/integrations/{name}/connect` | JWT | — | `{ oauthUrl }` | 200 | `write.normal` |
| 28 | DELETE | `/v1/integrations/{name}` | JWT | — | — | 204 | `write.normal` |
| 29 | GET | `/v1/provider-keys` | JWT | — | `ProviderKeySummary[]` | 200 | `read.cheap` |
| 30 | POST | `/v1/provider-keys` | JWT | `{ provider, key }` | `ProviderKeySummary` | 201 | `write.normal` |
| 31 | DELETE | `/v1/provider-keys/{provider}` | JWT | — | — | 204 | `write.normal` |
| 32 | GET | `/v1/threads/{threadId}/sandbox/files/{fileKey}` | JWT | `?encoding?` | `SandboxFile` | 200/404 | `read.expensive` |
| 33 | PATCH | `/v1/threads/{threadId}/sandbox/files/{fileKey}` | JWT | `{ content, encoding? }` | `SandboxFileWrite` | 200 | `write.normal` |
| 34 | POST | `/v1/billing/portal` | JWT | — | `{ url }` | 200 | `write.normal` |
| 35 | POST | `/v1/billing/checkout` | JWT | `{ tier }` (`pro\|premium\|ultra\|max`; server maps tier→`POLAR_PRODUCT_ID_*`, client product ids forbidden) | `{ url }` | 200 | `write.normal` |
| 36 | POST | `/v1/client-error` | public ‡‡ | `{ message, stack, url, ts }` | `{ ok: true }` | 200 | `public.write` |
| 37 | POST | `/v1/vitals` | public ‡‡ | `{ name, value, id }` | `{ ok: true }` | 200 | `public.write` |
| 38 | POST | `/v1/user-events` | JWT | `{ eventName }` | `{ ok: true }` | 200 | `public.write` |
| 39 | POST | `/polar` ‡ | Standard Webhooks | raw body | `{ ok: true }` | 200/401 | `webhook` |
| 40 | POST | `/clerk` ‡ | Svix | raw body | `{ ok: true }` | 200/401 | `webhook` |
| 41 | POST | `/composio` ‡ | Composio HMAC | raw body | `{ ok: true }` | 200/401 | `webhook` |
| 42 | GET | `/openapi.json` | public | — | OpenAPI v3.1 spec | 200 | `public.read` |
| 43 | GET | `/docs` | public | — | Built-in API docs UI | 200 | `public.read` |
| 44 | GET | `/health` | public | — | `{ ok: true, version }` | 200 | `public.read` |
| 45 | GET | `/v1/me/profile` | JWT | — | `Profile` (agent name, memory, per-surface model/budget defaults, disabled models, onboarding state) | 200 | `read.cheap` |
| 46 | PATCH | `/v1/me/profile` | JWT | `UpdateProfile` (partial) | `Profile` | 200 | `write.normal` |
| 47 | GET | `/v1/me/usage` | JWT | — | `SandboxUsageSummary` (hours used/total, resetAt, tier) — replaces a credits endpoint | 200/503 | `read.cheap` |
| 48 | GET | `/v1/billing/catalog` | JWT | — | `PlanCatalog` (tier/price/sandbox-hours) | 200 | `read.cheap` |
| 49 | POST | `/v1/runs/{runId}/approvals/{approvalId}` | JWT | `{ decision: 'allow' \| 'deny' }` | `{ ok: true }` | 200/404/409 | `write.normal` |
| 50 | GET | `/v1/threads/{threadId}/sandbox/console` | JWT | `?cursor&lastPid` (cursor-poll, NOT streaming) | `SandboxConsole` (log slice + pid + cursor + `reset`) | 200 | `read.expensive` (cost 5, 60 polls/min, own bucket `${userId}:${route}`) |
| 51 | GET | `/v1/search` | JWT | `?q` | `SearchResults` (projects + threads, ILIKE; no message text) | 200 | `read.cheap` |
| 52 | GET | `/v1/greeting` | JWT | — | `Greeting` (time-of-day + Open-Meteo weather; `weather: null` fallback) | 200 | `read.cheap` |

**Approval / preview notes:**
- Row 49 (approvals) resolves a paused gated tool call (§8.6); 404 if no such pending approval, 409 if already decided or the deadline passed (default-deny).
- Row 50 is cursor-poll, never streaming — DOs still own all streaming (§23.5). The client echoes the last-seen Blaxel `pid` as `lastPid`; a differing non-null pid forces `reset:true` + slice-from-0.
- The composer Add-menu GitHub import rides `POST/PATCH /v1/projects` via `settings.importRepoUrl` (no new route); `POST /v1/user-events` extends its event enum (append-only) for composer/preview/search telemetry.

‡ **Rows 39–41 are served by `webhooks-worker` on `webhooks.trycheatcode.com`** (paths `/polar`, `/clerk`, `/composio`) — a separate public surface from the gateway, no `/v1` prefix. Every other row is `gateway.trycheatcode.com/...`. Each provider's signature scheme differs (Svix vs Standard Webhooks vs Composio HMAC) — verification is per-provider, see §23.8.

‡‡ **Rows 36–37 are unauthenticated telemetry.** `navigator.sendBeacon()` (Web Vitals) cannot attach an `Authorization` header, and client errors fire before/without a session — so these are `public`, protected by the `public.write` IP rate limit (60/min/IP) and a 16 KB body cap. The gateway opportunistically attributes a `userId` if a Clerk JWT happens to be present, but never requires one (the handler falls back to `'anonymous'`). Row 38 is authenticated because it records user-specific activation state from the real UI.

**Composio connect route configuration:** `/v1/integrations/{name}/connect`
uses the app-level `COMPOSIO_API_KEY` and a `COMPOSIO_AUTH_CONFIGS` JSON object
stored in Cloudflare Secrets Store. Shape:
`{"github":"ac_...","gmail":"ac_...","slack":"ac_...","notion":"ac_...","linear":"ac_..."}`.
The gateway calls `composio.connectedAccounts.link(internalUserId,
authConfigId, { callbackUrl })`, stores the returned connection request id in
`v2_user_integrations`, and Composio webhooks advance the status to active /
expired / failed. The agent-worker also binds `COMPOSIO_API_KEY` so Mastra tools
can execute against active `v2_user_integrations` rows; it does not bind
`COMPOSIO_AUTH_CONFIGS` because only the gateway creates OAuth links. These
credentials are app-level Composio credentials, not BYOK provider keys.

### 23.3 Rate-limit class definitions

| Class | Budget | Cost per call | Where enforced |
|---|---|---|---|
| `read.cheap` | 600/min/user | 1 | RateLimiter DO |
| `read.expensive` | 60/min/user | 5 | RateLimiter DO |
| `write.normal` | 120/min/user | 3 | RateLimiter DO |
| `runs.create` | 30/min/user + daily quota | 10 | RateLimiter DO + QuotaTracker DO |
| `public.read` | 300/min/IP | — | CF Rate Limiting Rule |
| `public.write` | 60/min/IP | — | CF Rate Limiting Rule |
| `webhook` | 1000/min/IP | — | CF Rate Limiting Rule (provider-driven) |

### 23.4 Shared response envelopes

```ts
// packages/types/src/api.ts
import { z } from 'zod';

export const Paginated = <T extends z.ZodTypeAny>(item: T) => z.object({
  data: z.array(item),
  next_cursor: z.string().nullable(),
  has_more: z.boolean(),
});

export const ErrorResponse = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    hint: z.string().optional(),
    retriable: z.boolean(),
    request_id: z.string(),
    doc_url: z.string().url().optional(),
    details: z.record(z.unknown()).optional(),
  }),
});

export const LimitsSnapshot = z.object({
  rate_limits: z.record(z.string(), z.object({
    limit: z.number(),
    remaining: z.number(),
    reset_at: z.number(),
  })),
  quotas: z.record(z.string(), z.object({
    limit: z.number(),
    used: z.number(),
    period_end: z.string(),
  })),
});
```

### 23.5 Streaming endpoint contract (resumable streams)

The three endpoints implementing AI SDK v6 chat send/cancel plus explicit active-stream reconnect:

```ts
// POST /v1/threads/{threadId}/runs
// 1. Insert agent_runs row (status='pending'); set threads.active_run_id = runId
// 2. Get AgentRun DO by idFromName(runId)
// 3. Call DO.start({ message, threadId, userId, projectId, ... })
// 4. Return DO's ReadableStream as toUIMessageStreamResponse() with status 202
//    Headers: UI_MESSAGE_STREAM_HEADERS + Location: /v1/runs/{runId}
//    Body: SSE stream (text/event-stream)

// GET /v1/threads/{threadId}/runs/stream   (DefaultChatTransport reconnect target)
// 1. Look up threads.active_run_id; if null → 204 No Content
// 2. Get AgentRun DO, call DO.resumeStream(lastSeq) — lastSeq from ?lastSeq= query
// 3. Return SSE stream: replayed parts past lastSeq + live continuation

// POST /v1/runs/{runId}/cancel
// 1. Get AgentRun DO, call DO.cancel(reason)
// 2. Return { ok: true }; DO emits a terminal data-error part and ends the SSE stream

// POST /v1/runs/{runId}/approvals/{approvalId}   (gateway → DO)
// 1. Get AgentRun DO, call DO.decideApproval(approvalId, decision)
// 2. The DO resolves the broker promise for the paused tool call and emits
//    data-approval-decision; the run leaves `paused` (allow → running, deny → fails the run)
```

**Paused-run lifecycle (run-control, §8.6).** A gated tool call moves the run into the
`paused` state: the loop emits `data-approval-request` and awaits a broker promise registered
in request-context. The SSE stream stays open the whole time (`paused` is a non-terminal
state, §24.2). The AgentRun DO `alarm()` is **multiplexed** — it carries both the retention
cleanup deadline and the active approval/fallback deadline; whichever is sooner fires next.
On a **5-minute** tool-approval deadline with no decision, the DO defaults to **deny** and
fails the run. **DO eviction mid-approval** loses the in-memory broker; on the next interaction
the run resolves as a default-deny failure rather than hanging.

**Interactive model fallback (replaces silent fallback).** When the primary provider errors
(billing/quota/opaque) and a fallback model is available, the DO emits `data-model-fallback`
and waits up to **120 s**; no response → **auto-allow** the fallback. The offer is suppressed
when the fallback model (`openai/gpt-5.4-mini`) is in the user's disabled set. The client
renders an "Use fallback" / "Open Models & Keys" choice card.

**Client reconnect banner.** The transport preserves `prepareReconnectToStreamRequest` and
the `data-seq` cursor; on a dropped connection the client shows a reconnect banner and resumes
from the last `seq` (a paused/approval-waiting run reconnects to the same open stream).

This is **one transport — SSE everywhere** (see §10.6). No WebSocket is involved in agent
streaming. WebSocket is used only for noVNC takeover (§9.5), which connects
through a Blaxel private preview; the V1 terminal is command-based over HTTPS.

**Required behavior on v6 quirks:**
- The transport MUST set `prepareSendMessagesRequest` to map useChat's default `{ id, messages, trigger }` body onto the `CreateRun` schema (§23.2 #12) — without it the POST 422s. See §10.6.
- Resume cursor: the DO emits a **transient `data-seq` part** (§25.5) on every flush carrying the latest `message_part.seq`. The client persists it (`sessionStorage`). If the current page already has stream data in memory, `prepareReconnectToStreamRequest` sends that value back as `?lastSeq=` so transient reconnects resume from the exact cursor. On a fresh page load with no in-memory messages, the client requests `lastSeq=0` so the AgentRun DO replays stored chunks before live tailing; AI SDK v6 resume does not reconstruct durable message history unless the app supplies initial messages or the stream endpoint replays from the beginning.
- `useChat` mount-time auto-resume stays disabled. AI SDK v6 can still trip a
  duplicate reconnect race around `204 No Content` in React development when a
  completed thread is reopened. Visibility changes call `resumeStream()` only
  while the current page already has an active in-memory streaming run.
- Duplicate text-start parts on resume: pin AI SDK ≥6.0.84 (we do — 6.0.182 locked).
- Replay must include the original `text-start` frames before any `text-delta` frames.

### 23.6 Idempotency key contract

```
Header: Idempotency-Key: <opaque-uuid, 1-255 chars>
Required for: POST /v1/runs
Optional for: POST /v1/projects, POST /v1/integrations/*/connect

Storage: Durable Object per (userId, idempotencyKey) — single-writer guarantees prevent KV's eventual-consistency races.

Replay rules:
  Same body hash + completed non-streaming response → return cached response with header `Idempotency-Replayed: true`
  Same body hash + in-flight                       → 409 conflict_in_flight with Retry-After: 1
  Different body hash (reuse)                      → 422 idempotency_key_reused

`POST /v1/threads/{threadId}/runs` is an SSE creation endpoint, so the
idempotency DO caches status/headers and **does not cache stream bytes**. A
duplicate completed streaming create returns 409 with a hint to reconnect via
`GET /v1/threads/{threadId}/runs/stream?lastSeq=N`; the AgentRun DO remains the
only durable stream replay store.

TTL: 24h default; 7d for billing-relevant routes.
```

### 23.7 Inter-Worker RPC (Hono typed RPC over Service Bindings)

```ts
// apps/gateway-worker — pulls typed client from agent-worker
import type { agentApp } from '@cheatcode/agent-worker';
import { hc } from 'hono/client';

const agent = hc<typeof agentApp>('', { fetch: env.AGENT.fetch.bind(env.AGENT) });

// Now fully type-safe inter-worker calls with zero network hop:
const result = await agent.runs[':runId'].$get({ param: { runId } });
```

Service Bindings are RPC (no network) — sub-millisecond. The TS type of `agentApp` is exported from `apps/agent-worker/src/index.ts` so the gateway gets compile-time route awareness.

### 23.8 Webhook handler contract (provider-specific verification)

`webhooks-worker` is the only worker that accepts provider callbacks. The three providers do **not** share one signature scheme — assuming they do is a security hole — so each verifier is implemented separately and runs against the **raw request body** (verify *before* parse):

| Provider | Route | Scheme | Verifier |
|---|---|---|---|
| Clerk | `/clerk` | Svix (`svix-id` / `svix-timestamp` / `svix-signature`) | `verifyWebhook()` from `@clerk/backend` |
| Polar | `/polar` | Standard Webhooks (`webhook-id` / `webhook-timestamp` / `webhook-signature`) | `validateEvent()` from `@polar-sh/sdk/webhooks` |
| Composio | `/composio` | HMAC-SHA256 over `webhook-id.webhook-timestamp.rawBody`, base64 in `webhook-signature` | own verifier, per Composio docs |

```ts
// apps/webhooks-worker/src/verify.ts
import { verifyWebhook } from '@clerk/backend';
import { validateEvent } from '@polar-sh/sdk/webhooks';
import { hmacSha256Base64, timingSafeEqual } from '@cheatcode/auth';

// Each verifier takes the raw body + request and either returns the parsed,
// trusted event or throws WebhookError. NEVER parse before verifying.
export const verifiers = {
  clerk: (req: Request, raw: string, env: Env) =>
    verifyWebhook(req, { signingSecret: env.CLERK_WEBHOOK_SECRET }),   // Svix under the hood

  polar: (req: Request, raw: string, env: Env) =>
    validateEvent(raw, Object.fromEntries(req.headers), env.POLAR_WEBHOOK_SECRET),

  composio: async (req: Request, raw: string, env: Env) => {
    const id = req.headers.get('webhook-id') ?? '';
    const timestamp = req.headers.get('webhook-timestamp') ?? '';
    const sig = req.headers.get('webhook-signature') ?? '';
    const received = sig.split(',')[1] ?? sig;
    const expected = await hmacSha256Base64(`${id}.${timestamp}.${raw}`, env.COMPOSIO_WEBHOOK_SECRET);
    if (!timingSafeEqual(received, expected)) throw new WebhookError('invalid_signature');
    return JSON.parse(raw) as ComposioWebhookEvent;
  },
} as const;
```

Shared handler pattern, after the provider-specific verifier returns:
1. Verifier throws on bad signature or stale timestamp → respond `401`. This is the **only** non-200 — it forces the provider's dashboard to surface the failure.
2. Dedup: check the provider's event id against the idempotency DO (7-day TTL).
3. If new: enqueue the work to Cloudflare Workflows; the handler itself stays thin.
4. Respond `200 OK` even if downstream processing later fails — Workflows owns retries; never make a provider re-send a webhook we already durably accepted.

---

## 24. Durable Object Specifications

> Five DO classes total: `AgentRun`, `ProjectSandbox`, `RateLimiter`, `QuotaTracker`, and `IdempotencyStore`. All SQLite-backed (default since April 2025). **No DO uses WebSocket** — `AgentRun` streams agent output over SSE (§10.6), and `ProjectSandbox`/`RateLimiter`/`QuotaTracker`/`IdempotencyStore` are RPC-only. The only WebSocket in V1 is noVNC takeover through a Blaxel private preview (§9.5), never to a DO.

### 24.1 Universal DO patterns

- **Storage class:** SQLite via `new_sqlite_classes` in wrangler migrations. No KV-backed classes.
- **Idempotency:** every DO is reached via `idFromName(<deterministicKey>)` so the same caller always gets the same instance and state.
- **Concurrency:** DOs are single-threaded. Concurrent RPCs serialize. No locking primitives needed.
- **SSE streaming (`AgentRun` only):** `fetch()` returns a `ReadableStream` (`text/event-stream`). The durable replay buffer is SQLite `message_part`; live fan-out is an in-memory `Set` of stream controllers, rebuilt on reconnect. No WebSocket hibernation — see §24.2.
- **Schema migrations:** version-tracked via internal `schema_version` table; applied in `ctx.blockConcurrencyWhile()` in the constructor (idempotent).
- **TTL alarms:** every DO that accumulates data sets a daily `setAlarm()` for cleanup.
- **Hard limits:** 10 GB storage / 2 MB per row / 100 cols/table / ~1000 req/s per DO instance.

### 24.2 AgentRun DO

One DO per agent run, identified by `idFromName(runId)`. Owns the run's state, message log, budget tracking, and live SSE subscribers.

**SQLite schema:**

```sql
CREATE TABLE schema_version (version INTEGER PRIMARY KEY);

CREATE TABLE run (
  id              TEXT PRIMARY KEY,
  thread_id       TEXT NOT NULL,
  project_id      TEXT NOT NULL,
  user_id         TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('pending','running','paused','completed','failed','canceled')),
  model_id        TEXT NOT NULL,
  agent_name      TEXT NOT NULL,
  budget_cap_usd  REAL NOT NULL,
  tokens_in       INTEGER NOT NULL DEFAULT 0,
  tokens_out      INTEGER NOT NULL DEFAULT 0,
  cost_usd        REAL NOT NULL DEFAULT 0,
  parent_run_id   TEXT,
  created_at      INTEGER NOT NULL,
  started_at      INTEGER,
  completed_at    INTEGER,
  error_json      TEXT
);

CREATE TABLE message_part (
  seq             INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id      TEXT NOT NULL,
  role            TEXT NOT NULL,
  part_type       TEXT NOT NULL,
  part_id         TEXT,
  payload_json    TEXT NOT NULL,
  transient       INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL
);
CREATE INDEX idx_part_msg ON message_part(message_id);

CREATE TABLE budget_event (
  seq             INTEGER PRIMARY KEY AUTOINCREMENT,
  kind            TEXT NOT NULL,
  tokens          INTEGER NOT NULL,
  usd             REAL NOT NULL,
  model_id        TEXT,
  ts              INTEGER NOT NULL
);
```

**TypeScript interface:**

```ts
export interface AgentRunStub {
  start(input: StartRunInput): Promise<RunSnapshot>;
  sendUserMessage(message: UIMessage): Promise<{ accepted: boolean; seq: number }>;
  pause(): Promise<RunSnapshot>;
  resume(): Promise<RunSnapshot>;
  decideApproval(approvalId: string, decision: 'allow' | 'deny'): Promise<RunSnapshot>;  // §8.6 gate
  cancel(reason: string): Promise<RunSnapshot>;
  finalize(outcome: 'completed' | 'failed', error?: string): Promise<RunSnapshot>;
  getSnapshot(): Promise<RunSnapshot>;
  getMessages(afterSeq?: number, limit?: number): Promise<MessagePartRow[]>;
  resumeStream(lastSeq: number): Promise<ReadableStream>;
}

export interface AgentRunDO extends DurableObject, AgentRunStub {
  // fetch() handles: POST /start, GET /stream (SSE), and POST /cancel.
  // No webSocket* handlers — agent streaming is SSE (§10.6).
  fetch(request: Request): Promise<Response>;
  alarm(): Promise<void>;
}

export interface StartRunInput {
  runId: string;
  threadId: string;
  projectId: string;
  userId: string;
  modelId: string;
  agentName: string;
  firstMessage: UIMessage;
  budgetCapUsd: number;
  parentRunId?: string;
}

export interface RunSnapshot {
  runId: string;
  status: RunStatus;
  modelId: string;
  budget: { tokensIn: number; tokensOut: number; usdSpent: number; capUsd: number };
  messageCount: number;
  lastSeq: number;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
}
```

**Lifecycle state machine:**

```
pending → running → (completed | failed | canceled)
                ↓
              paused → running
```

`paused` is entered both by user takeover (§9.5) and by a **tool approval gate** (§8.6): the
loop awaits an Allow/Deny decision delivered via `POST /v1/runs/{runId}/approvals/{approvalId}`
(→ `decideApproval()`). Allow resumes the tool call (`paused → running`); Deny fails the run.
The `alarm()` is multiplexed across the daily retention cleanup and the active approval/​
fallback deadline (5-min approval default-deny; 120-s fallback auto-allow) — see §23.5.
Sandbox-hours metering continues during a pause (bounded overshoot, §28.2).

**Two entry points — do not confuse them:**

- **`fetch(POST /start)` — the streaming path.** The gateway's `POST /v1/threads/{id}/runs` calls this. The handler: (1) inserts/guards the `agent_runs` row + sets `threads.active_run_id`; (2) creates the SSE `ReadableStream` and registers its controller in the in-memory subscriber `Set`; (3) kicks the agent loop with `ctx.waitUntil(runAgentLoop())` — **fire-and-forget, it does NOT await the run**; (4) returns the stream `Response` **immediately** (202). First bytes flow within the §30.1 TTFT budget; the loop keeps appending to `message_part` and fanning out after the response is already streaming.
- **`start()` RPC — the streaming path.** Returns a `RunSnapshot` once the run is registered and the loop is kicked, while live output streams through the AgentRun Durable Object.

Both share one guard: if `status != 'pending'`, return the existing snapshot — idempotent retry. The agent loop body is identical; only whether the caller receives a stream differs. Implementers must never `await` the full loop before returning the SSE response.

**SSE subscription pattern:**

```
Client connects: GET /v1/threads/{threadId}/runs/stream?lastSeq=N   (gateway → DO.fetch)
DO:
  1. Create a ReadableStream; register its controller in an in-memory Set<Controller>.
  2. Replay SELECT * FROM message_part WHERE seq > N ORDER BY seq (paginated 100/batch),
     writing each part as a `data:`-framed SSE event into the stream.
  3. After the backlog drains, mark the controller liveCaughtUp and keep it subscribed.
  4. Every new part the agent loop appends to message_part is also pushed to all
     live controllers — fan-out is a plain in-memory loop (the DO is single-threaded).
  5. On finalize the DO writes a terminal `data-finish` part and closes all controllers.
     On client disconnect (request abort) the controller is removed from the Set.
```

Resumability survives DO hibernation: `message_part` is durable SQLite, so a reconnecting
client always replays correctly from `lastSeq`. Only the in-memory controller `Set` is lost
on eviction — it is rebuilt lazily on the next `GET .../stream`. There is no WebSocket and
no `serializeAttachment` — the seq cursor lives in the client and the SQLite row is the
source of truth.

**Cleanup alarm:** Daily `setAlarm()` deletes runs where `completed_at < now() - 30 days`. Hard-deletes the DO via `ctx.storage.deleteAll()` when run is >90 days old.

### 24.3 ProjectSandbox DO

One DO per project, identified by a stable lower-case SHA-256-derived sandbox ID
(`cc-` + 40 hex chars) computed from the internal project/tenant scope. This keeps
Blaxel sandbox names DNS-safe, under Blaxel's 49-character `metadata.name` limit,
and tenant-isolated. Wraps Blaxel
sandbox lifecycle and normalizes it behind the `SandboxLike` tool boundary.

**TypeScript interface:**

```ts
// Argv form only at the Cheatcode API boundary (§14.5). Blaxel process
// execution takes shell command strings; this wrapper is the only place that
// serializes argv arrays into a shell command.
export interface ProjectSandboxExecInput {
  command: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
}

export interface ProjectSandboxStub {
  ensureReady(): Promise<SandboxStatus>;
  getStatus(): Promise<SandboxStatus>;
  exec(input: ProjectSandboxExecInput): Promise<ExecResult>;
  startProcess(input: ProjectSandboxExecInput & {
    processId?: string;
    waitForPort?: { port: number; path?: string; timeoutMs?: number };
  }): Promise<{ id: string; command: string; pid?: number; status: string }>;
  readFile(input: { path: string; encoding?: 'utf8' | 'base64' }): Promise<{ path: string; content: string; encoding: 'utf8' | 'base64'; size?: number }>;
  writeFile(input: { path: string; content: string; encoding?: 'utf8' | 'base64' }): Promise<{ path: string; success: boolean }>;
  listFiles(input: { path: string; recursive?: boolean; includeHidden?: boolean }): Promise<{ path: string; files: FileEntry[] }>;
  // Creates or reuses a Blaxel preview URL. Private previews return an access token.
  exposePort(input: { port: number; hostname?: string; name?: string; tokenTtlMs?: number }): Promise<{ port: number; url: string; name?: string; token?: string }>;
  unexposePort(input: { port: number; name?: string }): Promise<void>;
  // runCode accepts an optional env map — request-scoped secret passing (§7.8, §9.4).
  runCode(input: { language: 'python' | 'javascript'; code: string; env?: Record<string, string> }): Promise<RunCodeResult>;
  createBackup(input: { dir: string; name?: string; ttl?: number }): Promise<{ id: string; dir: string }>;
  restoreBackup(input: { backup: { id: string; dir: string } }): Promise<{ success: boolean; id: string; dir: string }>;
  sleep(): Promise<void>;
  acquireLease(holderId: string, ttlMs: number): Promise<{ token: string; expiresAt: number }>;
  releaseLease(token: string): Promise<void>;
}
```

The project row stores the Blaxel sandbox name in `projects.sandbox_id`. The legacy `projects.container_backup` JSONB column stays nullable for migration compatibility; V2 snapshot handles are now persistent Blaxel volume handles, not R2 directory backups. Blaxel standby preserves warm process/filesystem state while the sandbox exists, and the per-project volume preserves `/workspace` across sandbox deletion/recreation.

**Lifecycle rules**:

| Trigger | Action |
|---|---|
| Successful agent run completion | Let Blaxel auto-standby; persist `projects.sandbox_id` |
| Idle ~15 seconds | Blaxel transitions to standby and preserves process/filesystem state |
| Image changed incompatibly | Create a new sandbox name and migrate files from volume/R2 artifacts as needed |
| Sandbox deleted/expired | Recreate from image; recover durable files from project volume/R2 when available |
| Project deleted | Delete the Blaxel sandbox and attached project volume, then delete R2 artifacts |

**Multi-agent coordination:** Subagents share the project sandbox by default. For destructive ops (`rm -rf node_modules`, snapshot restore), require explicit lease token from parent run. Subagents needing isolated state use `idFromName(`${projectId}:${branchId}`)`.

**Disk monitoring:** 60-second alarm runs `df -h /workspace`; rejects new writes if usage exceeds the configured sandbox/volume budget.

### 24.4 RateLimiter DO

Token-bucket rate limiting per `(userId, route)` key. Sharded by `idFromName(`ratelimit:${userIdPrefix}`)`.
Gateway callers treat this DO as an availability guard, not a hard dependency:
if the DO cannot be reached or returns invalid JSON, the request proceeds after
logging `rate_limiter_unavailable`; only a valid `allowed: false` result blocks
the request.

**SQLite schema:**

```sql
CREATE TABLE bucket (
  key             TEXT PRIMARY KEY,
  tokens          REAL NOT NULL,
  last_refill_ms  INTEGER NOT NULL,
  capacity        INTEGER NOT NULL,
  refill_per_sec  REAL NOT NULL
);
```

**TypeScript interface:**

```ts
export interface RateLimiterStub {
  consume(key: string, cost: number, config: RateLimitConfig): Promise<RateLimitResult>;
  peek(key: string, config: RateLimitConfig): Promise<RateLimitResult>;
  reset(key: string): Promise<void>;
  consumeMany(items: Array<{ key: string; cost: number; config: RateLimitConfig }>): Promise<Record<string, RateLimitResult>>;
}

export interface RateLimitConfig {
  capacity: number;
  refillPerSec: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}
```

**Algorithm — token bucket:**

```ts
async consume(key: string, cost: number, config: RateLimitConfig): Promise<RateLimitResult> {
  const now = Date.now();
  const row = this.sql.exec("SELECT * FROM bucket WHERE key=?", key).one() ?? null;
  let tokens = row ? row.tokens : config.capacity;
  const lastRefill = row?.last_refill_ms ?? now;
  tokens = Math.min(config.capacity, tokens + (now - lastRefill) / 1000 * config.refillPerSec);

  if (tokens < cost) {
    const retryAfterMs = Math.ceil((cost - tokens) / config.refillPerSec * 1000);
    return { allowed: false, remaining: Math.floor(tokens), retryAfterMs };
  }
  tokens -= cost;
  this.sql.exec(
    `INSERT INTO bucket (key, tokens, last_refill_ms, capacity, refill_per_sec) VALUES (?,?,?,?,?)
     ON CONFLICT(key) DO UPDATE SET tokens=excluded.tokens, last_refill_ms=excluded.last_refill_ms`,
    key, tokens, now, config.capacity, config.refillPerSec
  );
  return { allowed: true, remaining: Math.floor(tokens), retryAfterMs: 0 };
}
```

### 24.5 QuotaTracker DO

Per-user atomic quota counter. One DO per user via `idFromName(`quota:${userId}`)`.

**SQLite schema:**

```sql
CREATE TABLE counter (
  feature     TEXT NOT NULL,
  period_key  TEXT NOT NULL,
  used        REAL NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (feature, period_key)
);

CREATE TABLE limit_override (
  feature     TEXT PRIMARY KEY,
  limit_val   REAL NOT NULL,
  source      TEXT,
  updated_at  INTEGER NOT NULL
);
```

**TypeScript interface:**

```ts
export interface QuotaTrackerStub {
  record(feature: string, amount: number, periodEnd: Date): Promise<{ used: number; remaining: number; limit: number }>;
  tryConsume(feature: string, amount: number, periodEnd: Date): Promise<{ allowed: boolean; remaining: number; limit: number }>;
  peek(feature: string, periodEnd: Date): Promise<{ used: number; remaining: number; limit: number }>;
  reset(feature: string): Promise<void>;
  setLimit(feature: string, limit: number, source: string): Promise<void>;
  snapshot(periodEnd: Date): Promise<Record<string, { used: number; limit: number }>>;
}
```

`record()` is for soft meter-style quotas such as sandbox-hours: it increments
usage even past the configured limit so Settings can show real consumption.
`tryConsume()` remains the hard gate for calls that must be denied at 100%, such
as Composio tool executions.

**Period anchoring:** `period_key = YYYY-MM` derived from `subscription.current_period_start` (synced on Polar webhook). DO writes to Supabase `usage_daily_totals` every 30s or 100 increments (batched).

### 24.6 IdempotencyStore DO

Per-user/per-key request dedupe for `POST /v1/threads/{threadId}/runs`.

```ts
interface IdempotencyStoreStub {
  begin(input: {
    key: string;
    bodyHash: string;       // sha256(method + path + query + body)
    ttlMs: number;          // 24h for run creates
  }): Promise<
    | { action: 'proceed' }
    | { action: 'conflict_in_flight'; retryAfterMs: number }
    | { action: 'replay'; response: CachedResponse }
    | { action: 'reused' }
  >

  complete(input: {
    key: string;
    status: number;
    headers: [string, string][];
    body: string | null;    // null for SSE run-create responses
  }): Promise<void>
}
```

For streaming run creation, `body` is intentionally `null`; stream replay lives
in `AgentRun.message_part`, not in the idempotency store.

### 24.7 DO migration safety

**Wrangler `migrations[]` entries:**

```jsonc
{
  "migrations": [
    { "tag": "v1", "new_sqlite_classes": ["AgentRun", "ProjectSandbox", "RateLimiter", "QuotaTracker", "IdempotencyStore"] }
  ]
}
```

**Rules:**
- Adding new class → new entry with `new_sqlite_classes`
- Deleting class → `deleted_classes` entry BEFORE removing code refs (else deploy refuses)
- Renaming → `renamed_classes: [{ from, to }]` preserves stored data
- Never enable SQLite on a class deployed as KV (runtime rejects)

**Internal schema migration (idempotent constructor):**

```ts
constructor(ctx: DurableObjectState, env: Env) {
  super(ctx, env);
  this.sql = ctx.storage.sql;
  this.ctx.blockConcurrencyWhile(async () => {
    const current = this.sql.exec("SELECT version FROM schema_version").one()?.version ?? 0;
    if (current < 1) this.applyV1();
    if (current < 2) this.applyV2();
  });
}
```

### 24.8 Performance targets per DO

| Metric | Target |
|---|---|
| First SSE event latency (warm DO) | <50 ms |
| First SSE event latency (hibernated wake) | <200 ms |
| Sustained SSE part throughput per DO | 1000 parts/s (batched) |
| Stream resume latency (1000 buffered parts) | <300 ms |
| AgentRun DO storage per run | <50 MB target, 500 MB hard cap |
| Cost per active session | <$0.02 |
| Cost per archived run (30-day retention) | <$0.001 |

---

## 25. Tool Registry & Streaming Events

### 25.1 Tool naming + organization

Tools live in `packages/tools-*`, registered at agent-worker boot. Pattern: `<domain>_<verb>`, snake_case, atomic.

```
fs_read, fs_write, fs_list, fs_search, fs_delete
shell_exec, shell_start_process, shell_kill_process, shell_terminal
git_status, git_commit, git_push, git_clone
browser_open, browser_act, browser_extract, browser_observe, browser_screenshot
search_web, search_web_advanced, search_company, firecrawl_scrape, firecrawl_search, firecrawl_extract
docs_generate_slides, docs_generate_pdf, docs_generate_xlsx, docs_generate_docx
composio_list_tools, composio_execute
data_analyze_csv, data_chart, data_scrape_to_csv
research_deep, research_wide, research_competitor
sandbox_create, sandbox_destroy, sandbox_snapshot, sandbox_restore, start_dev_server
skill_invoke, skill_read_reference
```

**Naming rules:** domain-first (LLM intent matches better), verb after, snake_case, ≤6 properties per tool (split if larger). Destructive or production-impacting actions require explicit first-class user commands and audit logging; V1 has no generic approve/reject tool gate.

**Integration approach (deliberate — verified 2026-06-16):** The agent calls
`@composio/core`'s low-level `tools.getRawComposioTools` (framework-agnostic
discovery) and `tools.execute` directly, with **no Composio provider** set, and
hand-wraps them in exactly two Mastra `createTool` meta-tools
(`composio_list_tools` for runtime discovery, `composio_execute` for the
action). Discovery projects each raw action to `{ slug, name, description,
inputParameters, version, isDeprecated }` — the fields needed to then call
`composio_execute` — rather than the default `OpenAIProvider` function envelope.
Discovery passes the documented max `limit` (500; the API silently caps at ~20
otherwise — github alone has 800+ actions) and accepts an optional `search`
keyword so the model can narrow large toolkits server-side; the projected list is
bounded into **valid JSON** by whole-tool count (never sliced mid-object). The
client pins concrete per-toolkit `toolkitVersions` (fetched from
`GET /api/v3/toolkits/<slug>` → `meta.version`) so discovery and `tools.execute`
agree on one version and manual execute never throws `ComposioToolVersionRequiredError`;
it also sets `baseURL` (= the SDK default `backend.composio.dev`, pinned) and
`allowTracking: false` (no edge telemetry fetches). The LLM sees only these two
tools — never N expanded per-action tools — so the tool list and token budget
stay bounded. `@composio/core`
(~1.2 MB) is dynamically `import()`-ed only when a tool fires, to stay under the
Worker startup-CPU limit; per-request BYOK key, `userId`, and
`connectedAccountId` are injected via Mastra `requestContext`. We deliberately
do **not** use the framework providers `@composio/vercel` (emits a Vercel AI SDK
`ToolSet`) or `@composio/mastra` (emits Mastra `createTool`s): both expand every
action into its own tool, build the tool set eagerly, and capture a `Composio`
instance at construction — which would regress the bounded tool surface, the
lazy-import mitigation, and per-request BYOK/quota control. They are additive on
top of `@composio/core`, not equivalent to it.

**Composio execution contract:** `composio_list_tools` lists actions for an
active user-connected integration. `composio_execute` resolves the user's
`connectedAccountId` from `v2_user_integrations`, meters the call through the
gateway-owned `QuotaTracker` Durable Object via an external Durable Object
binding, then calls `composio.tools.execute`. Context7 Cloudflare Workers docs
confirm `durable_objects.bindings[].script_name` is the supported Wrangler
configuration for binding a Durable Object class exported by another Worker; the
agent-worker binds `QUOTA_TRACKER` from `cheatcode-gateway` and does not own a
migration for that class.

### 25.2 Tool definition pattern

```ts
import { tool } from 'ai';
import { z } from 'zod';

export const fsRead = tool({
  description: 'Read a file from the project sandbox. Returns UTF-8 text. Use fs_list first if unsure of paths.',
  inputSchema: z.object({
    path: z.string().describe('Absolute path under /workspace, e.g. /workspace/src/app.tsx'),
    max_bytes: z.number().int().positive().max(1_000_000).default(100_000)
      .describe('Cap on bytes returned (default 100KB)'),
  }).strict(),
  outputSchema: z.object({
    path: z.string(),
    content: z.string(),
    truncated: z.boolean(),
    bytes: z.number(),
  }).strict(),
  execute: async (input, { runtimeContext }) => { /* ... */ },
});
```

**Rules:** `.strict()` always · every property `.describe()` for LLM · explicit output schema (never `z.any()`) · gated tools pause the run for an in-product Allow/Deny approval via `withApprovalGate` (§8.6), default-deny on timeout.

### 25.3 `runtimeContext` shape

Passed to every tool's `execute`, never serialized to LLM:

```ts
export interface RuntimeContext {
  userId: UserId;
  projectId: ProjectId;
  threadId: ThreadId;
  runId: AgentRunId;
  traceId: string;                    // OTel trace_id
  sandbox: ProjectSandboxStub;        // DO stub
  env: WorkerEnv;                     // typed CF bindings
  logger: Logger;                     // request-scoped, includes request_id
  budget: BudgetTracker;              // per-run cost caps
  signal: AbortSignal;                // wired to client disconnect + cancel
  byok: {
    get(provider: Provider): Promise<string | null>;  // decrypts per call inside request tx; request-scoped, no module cache
  };
}
```

### 25.4 Tool versioning

1. **Per-tool versioning.** Add fields as optional with defaults; bump tool ID to `fs_read_v2` only on breaking changes.
2. Tools tagged with `since: '2026-05-20'` and optionally `deprecated_after`. Gateway logs warnings on deprecated usage.
3. **Agent configs pin exact tool versions.** Re-resolution requires explicit "rebuild" action.

### 25.5 CheatcodeUIMessage data parts taxonomy

```ts
// packages/types/src/ui-message.ts
import type { UIMessage, InferUITools } from 'ai';
import type { cheatcodeTools } from '@cheatcode/agent-core';

export type CheatcodeUIMessage = UIMessage<
  { runId: AgentRunId; modelId: string; userId: UserId },
  {
    plan:               { v: 1; tasks: Task[]; parallelGroups: number[][] };
    'task-status':      { v: 1; taskId: string; status: TaskStatus; error?: string };
    'budget':           { v: 1; tokensIn: number; tokensOut: number; usdSpent: number; capUsd: number };
    'sandbox-status':   { v: 1; status: SandboxState; previewUrl?: string; expoUrl?: string };
    'takeover':         { v: 1; available: boolean; vncUrl?: string; resumeToken?: string };
    'artifact':         { v: 1; outputId: string; kind: 'slide'|'pdf'|'image'|'video'|'audio'|'xlsx'|'docx'; downloadUrl: string; mimeType: string };
    'quota':            { v: 1; feature: string; remaining: number; limit: number; resetAt: number };  // billing-credits emits this in SANDBOX HOURS (§28.10) — warn at 80%/95%
    'thinking':         { v: 1; text: string; delta: boolean };
    'error':            { v: 1; code: string; message: string; retriable: boolean };
    'approval-request': { v: 1; approvalId: string; toolName: string; toolInput: unknown; reason: string; deadlineAt: number };  // run-control: paused, awaiting Allow/Deny (§8.6, default-deny at deadline)
    'approval-decision':{ v: 1; approvalId: string; decision: 'allow' | 'deny'; decidedBy: 'user' | 'timeout' };                 // run-control: resolves the matching request part in place
    'model-fallback':   { v: 1; fromModel: string; toModel: string; reason: string; deadlineAt: number };                       // run-control: interactive fallback consent (120s auto-allow) — replaces the silent text-delta notice
    'seq':              { v: 1; seq: number };  // transient — latest message_part.seq; drives the resume cursor (§10.6, §23.5)
  },
  InferUITools<typeof cheatcodeTools>
>;
```

**Versioning rules:** every data part has `v: number` · frontend switches on `v`, gracefully ignores unknown · add fields as optional · bump `v` only on breaking changes · never remove fields within a major version.

**Reconciliation:** parts with same `id` update in place · without `id`, parts append · `transient: true` for ephemeral events (toasts, ticks) — sent over wire but not persisted.

**Server emitter helper:**

```ts
export function emit<K extends keyof CheatcodeUIMessage['data']>(
  writer: UIMessageStreamWriter<CheatcodeUIMessage>,
  type: K,
  data: CheatcodeUIMessage['data'][K],
  opts?: { id?: string; transient?: boolean },
) {
  writer.write({ type: `data-${type}` as const, id: opts?.id, data, transient: opts?.transient });
}
```

**Ordered delivery across reconnects:** every emitted part persisted to AgentRun DO `message_part` with monotonic `seq`. On resume, replay `seq > lastSeen` before connecting live writer.

### 25.6 Tool dispatch in agent-worker

```ts
// apps/agent-worker/src/tools/registry.ts
import { fsRead, fsWrite, fsList } from '@cheatcode/tools-code';
import { browserAct, browserExtract } from '@cheatcode/tools-browser';
import { docsGenerateSlides } from '@cheatcode/tools-docs';
// ...

export const cheatcodeTools = {
  fs_read: fsRead,
  fs_write: fsWrite,
  fs_list: fsList,
  shell_exec: shellExec,
  browser_act: browserAct,
  // ... 60+ tools
} as const;
```

Each agent picks a subset from this registry.

---

## 26. Error Taxonomy

> Every error response uses one envelope. Every `code` follows the prefix convention. Every `hint` is prescriptive — agents read these inline and self-correct.

### 26.1 Error envelope (locked shape)

```ts
{
  "error": {
    "code": "tool_execution_failed",
    "message": "The sandbox command timed out after 60s",
    "hint": "Retry the run; if this persists, check Cloudflare deployment status.",
    "retriable": true,
    "request_id": "req_01HM3K8N2P9X4ABCD",
    "doc_url": "https://docs.trycheatcode.com/errors/tool_execution_failed",
    "details": { "tool_name": "shell_exec", "timeout_ms": 60000 }
  }
}
```

All fields required except `hint`, `doc_url`, `details`. `request_id` also in `X-Request-Id` header. Format: `req_<ULID>`.

### 26.2 Status code → code prefix mapping

| HTTP | Class | Code prefix | Examples |
|---|---|---|---|
| 400 | Schema validation | `invalid_*` | `invalid_request_body`, `invalid_query_param` |
| 401 | Auth | `auth_*` | `auth_token_invalid`, `auth_token_expired`, `auth_token_missing` |
| 402 | Payment | `payment_*` | `payment_required`, `payment_method_failed` |
| 403 | Permission | `permission_*` | `permission_denied`, `permission_plan_required` |
| 404 | Not found | `not_found_*` | `not_found_thread`, `not_found_run` |
| 409 | Conflict | `conflict_*` | `conflict_run_already_active`, `conflict_in_flight`, `conflict_state_invalid` |
| 410 | Gone | `gone_*` | `gone_output_expired` |
| 422 | Semantic | `validation_*` | `validation_model_unavailable`, `validation_tool_not_registered`, `idempotency_key_reused` |
| 429 | Rate limit | `rate_limit_*` / `quota_*` | `rate_limit_exceeded`, `quota_exhausted_sandbox_hours` |
| 500 | Server | `internal_*` | `internal_error` |
| 502 | Upstream | `upstream_*` | `upstream_llm_overloaded`, `upstream_sandbox_failed` |
| 503 | Unavailable | `unavailable_*` | `unavailable_maintenance` |
| 504 | Upstream timeout | `upstream_timeout_*` | `upstream_timeout_llm`, `upstream_timeout_sandbox` |

### 26.3 ErrorCode catalog

```ts
// packages/types/src/errors.ts
export type ErrorCode =
  | 'auth_token_missing' | 'auth_token_invalid' | 'auth_token_expired'
  | 'payment_required' | 'payment_method_failed' | 'subscription_past_due'
  | 'permission_denied' | 'permission_plan_required'
  | 'not_found_user' | 'not_found_project' | 'not_found_thread'
  | 'not_found_run' | 'not_found_output' | 'not_found_tool'
  | 'invalid_request_body' | 'invalid_query_param' | 'invalid_path_param'
  | 'validation_model_unavailable' | 'validation_tool_not_registered'
  | 'idempotency_key_reused' | 'validation_byok_required'
  | 'conflict_in_flight' | 'conflict_run_already_active' | 'conflict_state_invalid'
  | 'gone_output_expired'
  | 'rate_limit_exceeded' | 'quota_exhausted_sandbox_hours'
  | 'quota_exhausted_composio_calls'
  | 'quota_exhausted_deployments' | 'budget_cap_reached'
  | 'daily_cost_cap_reached'
  | 'byok_key_missing' | 'byok_key_invalid' | 'byok_key_quota_exhausted'
  | 'sandbox_disk_full' | 'sandbox_cpu_exhausted' | 'sandbox_failed_to_start'
  | 'sandbox_command_failed'
  | 'tool_validation_failed' | 'tool_execution_failed' | 'tool_timeout'
  | 'upstream_llm_overloaded' | 'upstream_llm_failed' | 'upstream_timeout_llm'
  | 'upstream_sandbox_failed' | 'upstream_timeout_sandbox'
  | 'upstream_provider_outage'
  | 'internal_error' | 'unavailable_maintenance';
```

### 26.4 LLM-readable `hint` field

Rules:
- **Prescriptive, not descriptive.** Tells the agent what to do next.
- "Switch to model=claude-sonnet-4-6; current model is deprecated" beats "Model not found".
- "Retry with budget_cap_usd >= 0.50" beats "Budget exceeded".
- Imperative voice.
- Never localize `code` or `hint`. Only `message` is localizable later.

### 26.5 `retriable` flag

```ts
const RETRIABLE_CODES = new Set([
  'rate_limit_exceeded', 'upstream_llm_overloaded', 'upstream_timeout_llm',
  'upstream_timeout_sandbox', 'internal_error', 'unavailable_maintenance',
  'conflict_in_flight',
]);

const NON_RETRIABLE_CODES = new Set([
  'auth_token_invalid', 'permission_denied', 'permission_plan_required',
  'payment_method_failed', 'byok_key_invalid', 'idempotency_key_reused',
  'budget_cap_reached', 'daily_cost_cap_reached', /* all quota_exhausted_* */
]);
```

Agents use `retriable: true` to decide auto-retry (with exponential backoff via `Retry-After`). Frontend uses it to show "Retry" button.

### 26.6 Server-side error helper

```ts
// packages/observability/src/errors.ts
export class APIError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly opts: {
      hint?: string;
      retriable?: boolean;
      details?: Record<string, unknown>;
      doc_url?: string;
    } = {},
  ) { super(message); }

  toResponse(requestId: string): Response {
    return Response.json({
      error: {
        code: this.code,
        message: this.message,
        hint: this.opts.hint,
        retriable: this.opts.retriable ?? this.defaultRetriable(),
        request_id: requestId,
        doc_url: this.opts.doc_url ?? `https://docs.trycheatcode.com/errors/${this.code}`,
        details: this.opts.details,
      },
    }, { status: this.status, headers: { 'X-Request-Id': requestId } });
  }

  private defaultRetriable(): boolean {
    return RETRIABLE_CODES.has(this.code);
  }
}

// Usage:
throw new APIError(429, 'rate_limit_exceeded', 'Too many runs', {
  hint: 'Wait 12 seconds before retrying, or upgrade plan at /settings/billing',
  details: { retry_after_seconds: 12 },
});
```

---

## 27. Local Development Environment

### 27.1 Multi-Worker dev pattern

Single `wrangler dev` with chained configs. Service Bindings resolve in-process (sub-millisecond):

```bash
wrangler dev \
  -c apps/gateway-worker/wrangler.jsonc \
  -c apps/agent-worker/wrangler.jsonc \
  -c apps/webhooks-worker/wrangler.jsonc
```

**First config is the HTTP entrypoint.** Other Workers reachable via Service Bindings inside Miniflare 4. **Never run 5 separate `wrangler dev` processes** — triggers worker-registry `EADDRINUSE` races.

### 27.2 Blaxel sandbox locally

Local development uses the authenticated Blaxel CLI and the same hosted Blaxel Sandboxes used in production. Docker is only needed when rebuilding the custom sandbox image locally before `bl push`/`bl deploy`.

```bash
bl version
bl workspaces --current
bl get sandboxes
pnpm sync:blaxel-local-token
pnpm docker:dev:build
```

If Blaxel CLI auth fails: run `bl login` and switch to the `cheatcode` workspace before running sandbox-backed tool flows. Local Worker dev must have `BL_API_KEY`, `BL_WORKSPACE`, `BL_REGION`, and `BLAXEL_SANDBOX_IMAGE` in ignored env files or standard Worker secrets.

`BL_API_KEY` can be a long-lived Blaxel API key or the authenticated CLI access
token. CLI access tokens expire; `pnpm sync:blaxel-local-token` refreshes CLI
auth with `bl get sandboxes` and copies the current CLI token into
`apps/agent-worker/.dev.vars` only when the existing local `BL_API_KEY` is a
missing or is a JWT-shaped CLI token. The script refuses to write malformed or
expired CLI tokens. Non-JWT API keys are left untouched.

Root Docker Compose files are intentionally limited to the sandbox image:

- `docker-compose.dev.yml` builds `cheatcode-agent-sandbox:dev` under the
  `cheatcode-dev` Compose project.
- `docker-compose.prod.yml` builds `cheatcode-agent-sandbox:prod` under the
  `cheatcode-prod` Compose project for production-image parity checks.

Both compose services are pinned to `platform: linux/amd64` for image parity.
They do not replace Blaxel production sandboxes. `scripts/dev.ts` no longer
starts or cleans per-project Docker sandbox containers; `pnpm docker:clean`
remains only for manually removing old local image-validation containers.

### 27.3 Root `pnpm dev` runner

Root `pnpm dev` runs `scripts/dev.ts`, not `turbo dev`, because Workers must
share one chained Wrangler process (§27.1). The runner:

1. runs `pnpm turbo skills:build`
2. checks Blaxel env/CLI reachability and refreshes local CLI-token auth unless
   `--web-only` is passed
3. starts `apps/web` with Next.js on port 3000
4. starts one Wrangler process with gateway as the primary config and agent
   plus webhooks as service-bound configs

```bash
pnpm dev
pnpm dev -- --dry-run
pnpm dev -- --web-only
pnpm dev -- --workers-only
pnpm audit:archive -- --dry-run
pnpm typecheck:scripts
```

Package-local `dev` scripts remain for targeted debugging, but root local
development uses the single-process Worker topology above.

`pnpm typecheck:scripts` is the root operational-script TypeScript gate. It
compiles `scripts/**/*.ts` with the repo strict settings and Node types because
root scripts are outside the pnpm workspace package graph and are not covered by
`pnpm turbo typecheck`.

Browser/product validation is direct `agent-browser` QA only. Open the local or
preview URL, snapshot interactive refs, click/fill/type through login, project
chat, preview tabs, settings, billing, BYOK, integrations, and mobile layouts,
capture screenshots, inspect console/resource output, and read the running
Next/Wrangler/Worker/Blaxel logs. Do not add or run product-flow scripts,
source-level test runners, prompt harnesses, browser automation scripts,
accessibility scripts, smoke scripts, E2E scripts, or load drivers unless the
user explicitly restores scripted testing in `plan.md`. Delete any such script
if it appears; the only accepted product evidence is the directly operated UI,
browser console/resource review, and app/platform logs.

Blaxel `process.exec({ keepAlive: true })` uses `timeout` as the process
auto-kill duration in seconds, not merely the port readiness timeout. App
preview dev servers therefore set `timeout: 3600` plus limited restart-on-failure
recovery so final `agent-browser` QA and file editing do not race a short-lived
process kill.

### 27.4 Port allocation

| Process | Port |
|---|---|
| Next.js (apps/web) | 3000 |
| Wrangler (gateway + all bound workers) | 8787 |
| Wrangler inspector (devtools) | 9239 |
| Sandbox preview URLs | dynamic via Blaxel previews |
| Supabase local — API | 54321 |
| Supabase local — DB | 54322 |
| Supabase local — Studio | 54323 |

### 27.5 DO state persistence between sessions

```jsonc
{ "dev": { "persist_to": ".wrangler/state" } }
```

Persists DO storage, KV, R2, D1, Cache between `wrangler dev` restarts. Delete `.wrangler/state` for clean slate.

### 27.6 Local secrets

Per-Worker `.dev.vars` only (no per-env variants — we only have local-dev + production, and production secrets live in Cloudflare Secrets Store, not in any `.dev.vars*` file).

```bash
# apps/gateway-worker/.dev.vars
CLERK_SECRET_KEY=sk_test_...
CLERK_WEBHOOK_SIGNING_SECRET=whsec_...
POLAR_WEBHOOK_SECRET=...
INTERNAL_ALERT_WEBHOOK_SECRET=...
# Workers connect as app_worker even locally — RLS parity with production (§7.2).
DATABASE_URL=postgresql://app_worker:app_worker@localhost:54322/postgres
```

Never commit. Production app secrets live in **Cloudflare Secrets Store** via
`secrets_store_secrets` bindings. Blaxel secrets live as standard Worker secrets
on `cheatcode-agent`: `BL_API_KEY`, `BL_WORKSPACE`, and `BL_REGION`. The
`cheatcode-webhooks` Worker also binds the same Blaxel secret set for DSR
lifecycle cleanup consistency; current sandbox deletion uses API key/workspace,
but `BL_REGION` remains present so the Blaxel env contract does not drift.

Local `pnpm dev` uses `scripts/dev.ts` to write ignored `wrangler.local-dev.generated.jsonc` copies next to each Worker's `wrangler.jsonc` with production-only `secrets_store_secrets` omitted. This lets Wrangler bind per-Worker `.dev.vars` locally while the committed `wrangler.jsonc` files remain the production Secrets Store source of truth.

Before local Workers start, `scripts/dev.ts` validates that
`apps/agent-worker/.dev.vars` contains the required standard Worker secrets:
`BL_API_KEY`, `BL_WORKSPACE`, `BL_REGION`, and
`OUTPUT_DOWNLOAD_SIGNING_SECRET`. `--skip-blaxel-check` skips only the Blaxel
keys for routing-only debugging; the output signing secret is still required.
For local Composio action execution, `apps/agent-worker/.dev.vars` also carries
`COMPOSIO_API_KEY`; it remains a Secrets Store binding in production.

The migration runner's admin connection is **separate and isolated**: `SUPABASE_MIGRATION_URL` (locally the `postgres` superuser — `postgresql://postgres:postgres@localhost:54322/postgres`) lives in a git-ignored `.env.migrate`, read only by `scripts/migrate.ts`. It is never in `.env.local`, never in a `.dev.vars`, never bound to a Worker — DDL privileges stay out of the app entirely.

### 27.7 Local R2

Miniflare 4 simulates R2 transparently. Bind a `r2_bucket`; reads/writes persist to `.wrangler/state/v3/r2`.

### 27.8 Local Postgres

**Supabase CLI** (`pnpm exec supabase start`, pinned in §4) — exact Postgres + PostgREST + GoTrue stack we ship to.

```bash
pnpm exec supabase init
pnpm exec supabase link --project-ref <ref>
pnpm exec supabase start
pnpm tsx scripts/migrate.ts --apply   # pre SQL → drizzle-kit migrate → post SQL (§7.10)
```

### 27.9 Two-environment model: local-dev + production

V1 ships with **only two environments**: local-dev (each engineer's machine) and production. **No staging, no preview/PR deploys, no shared dev environment.** Rationale: pre-revenue, small team, fast iteration. Every PR's correctness is checked by local static checks, build, final direct UI/log QA after all weeks are implemented, and CI; production is the only deployed environment.

| Concern | local-dev | production |
|---|---|---|
| Workers | `wrangler dev` (Miniflare) | `CHEATCODE_PROD_DEPLOY_APPROVED=true pnpm deploy:workers -- --apply` |
| Supabase | `pnpm exec supabase start` (Docker, local PG17 stack + `uuidv7()` compatibility function) | Existing hosted PG17.4 project with V2-prefixed tables |
| Clerk | Clerk dev instance (`pk_test_*`) | Clerk production app (`pk_live_*`) |
| Polar | Polar sandbox org | Polar production org |
| R2 | local Miniflare R2 simulator | `cheatcode-outputs`, `cheatcode-snapshots`, `cheatcode-audit`, `cheatcode-uploads` |
| Web Worker | `pnpm dev` for fast Next dev; `pnpm --filter @cheatcode/web preview` for workerd parity on port 3001 | `CHEATCODE_PROD_DEPLOY_APPROVED=true pnpm --filter @cheatcode/web deploy` |
| Secrets | `.dev.vars` | Cloudflare Secrets Store for app secrets; standard Worker secrets for Blaxel credentials |
| Sandbox | Blaxel workspace `cheatcode` | Blaxel workspace `cheatcode` |

Docker Compose is a local image-management convenience only: `docker-compose.dev.yml`
and `docker-compose.prod.yml` build the Blaxel sandbox image in stable Docker Desktop
projects, while production deploys via `wrangler deploy`, OpenNext Cloudflare, Blaxel, and the
managed Supabase project.

One `wrangler.jsonc` per Worker — no `env` blocks, no `--env` flag. **Clerk dev vs prod MUST be separate apps** — different JWK sets. Same for Polar (sandbox vs production org).

**Why no staging:**
- Adds a third Supabase project / R2 bucket set / Clerk app / Polar org to maintain
- Encourages "fix it in staging" instead of fixing the local app and validating through UI/logs
- Pre-revenue, no contractual uptime obligation that would justify the cost
- Re-add staging in v1.5 if/when we have paying customers and a deploy that breaks them in production becomes unacceptable

### 27.10 First-time setup runbook

```bash
git clone <repo> && cd cheatcode
pnpm install
bl workspaces --current                  # pre-flight; should print cheatcode
pnpm exec supabase start
pnpm tsx scripts/migrate.ts --apply       # pre SQL → drizzle migrate → post SQL (§7.10)
pnpm turbo db:generate
pnpm turbo skills:build
cp apps/gateway-worker/.dev.vars.example apps/gateway-worker/.dev.vars
# fill .dev.vars per worker
pnpm dev
# http://localhost:3000  → Next.js
# http://localhost:8787  → Workers gateway
# http://localhost:54323 → Supabase Studio
```

---

## 28. Pricing Tiers & Entitlements

### 28.1 Pricing matrix (V1 locked)

We charge for the agentic platform. LLM tokens are BYOK (zero cost to us). **Sandbox hours
are the sole user-facing metered platform resource** (real infra cost). Composio tool calls,
projects, and BYOK slots are resource gates. **There is no "credits" unit anywhere** — every
design surface (15f/07b/14b/19b) shows sandbox hours directly.

| Dimension | **Free** | **Pro $25/mo** | **Premium $50/mo** | **Ultra $99/mo** | **Max $200/mo** |
|---|---|---|---|---|---|
| **Sandbox-hours / mo** | **5** | **60** | **140** | **320** | **800** |
| Active projects | 3 | 25 | 50 | 100 | 250 |
| Concurrent sandboxes | 1 | 3 | 5 | 8 | 12 |
| Research fan-out subagents / run | 3 | 10 | 15 | 20 | 25 |
| Composio tool calls / mo | 1,000 | 20,000 | 50,000 | 120,000 | 300,000 |
| Connected Slack workspaces (agent tools via Composio) | 1 | 5 | 10 | 20 | Unlimited |
| Deployments / mo | 5 | 100 | 250 | 600 | Unlimited |
| BYOK provider slots | 3 | 10 | Unlimited | Unlimited | Unlimited |
| Data retention | 30 days | 1 year | 1 year | 1 year | 1 year |
| Support | community | email (48h) | email (24h) | priority (24h) | priority (12h) |

Free is the BYOK trial path. Price + sandbox hours are the locked design values; the other
caps are **scaled monotonically by tier** as a flagged assumption pending sign-off (C2 —
the design defines only price + sandbox hours). The single source for tier/price/sandbox-hour
allowance is `PLAN_CATALOG` in `packages/billing/src/catalog.ts`.

**Team / Enterprise are retired.** Seats, per-seat pricing, SSO/SAML/SCIM, and the org model
move to [`future.md`](./future.md)'s cut list; legacy rows map `team → premium`,
`enterprise → max`. No annual (-20%) row ships this round.

### 28.2 Quota semantics

| Type | Behavior | Examples |
|---|---|---|
| **Sandbox hours** | Warn at 80% then 95% (via the `data-quota` stream part, **in hours**); **HARD-block new run creation at 100%** — in-flight runs finish (bounded overshoot) | sandbox-hours |
| Soft limit | Warn at 80% then 95% with in-app banner | Composio calls, deployments |
| Hard limit | Block at 100% | concurrent sandboxes, active projects, BYOK slots |
| Activity reset | Calendar-month, anchored to `subscription.current_period_start` | All meter-style |
| Resource reset | Never (downgrade marks excess `over_quota=true`, freezes read-only 30d, then archives) | projects, BYOK slots |

**Sandbox-hours enforcement.** The gate's denominator is the entitlement's
`quota_sandbox_hours` read from Postgres at run creation; the QuotaTracker DO's
`limit_override` is display-sync state, never an enforcement input. All sandbox-hours
QuotaTracker reads/writes use the canonical `quotaPeriodEndFor(entitlement)` period helper.

**Burst vs sustained:** Concurrent sandboxes = hard parallel cap (sustained). Sandbox-hours = monthly bucket (burst-friendly). Research fan-out subagents and Composio calls use per-run and per-month quotas to prevent runaway usage.

### 28.3 Polar product configuration

**Four monthly products**, one per paid tier:

- `cheatcode_pro_monthly` ($25) · `cheatcode_premium_monthly` ($50) ·
  `cheatcode_ultra_monthly` ($99) · `cheatcode_max_monthly` ($200)

Each product's id is configured as a gateway env var — `POLAR_PRODUCT_ID_PRO`,
`POLAR_PRODUCT_ID_PREMIUM`, `POLAR_PRODUCT_ID_ULTRA`, `POLAR_PRODUCT_ID_MAX`. Checkout is
**tier-based**: `POST /v1/billing/checkout {tier}` maps the tier to its product id
server-side; **client-supplied product ids are forbidden**.

Use Polar's `external_id` = the internal `v2_users.id` UUID, not Clerk `user_id`.
`polar.customers.getStateExternal({ externalId: internalUserId })` gives one-call sync.
Every paid Polar product must set product metadata `tier = pro | premium | ultra | max`;
the webhook layer ranks tiers via `TIER_ORDER` from the shared catalog and falls back to
product name/ID only for local sandbox fixtures.

### 28.4 Polar webhooks subscribed

Required: `customer.state_changed` (catch-all), `subscription.created`, `subscription.active`, `subscription.canceled`, `subscription.past_due`, `subscription.revoked`, `order.paid`, `order.refunded`, `refund.created`.

**Cancellation sequencing:**
- End-of-period cancellation → `subscription.canceled` immediately (status stays `active`, `cancel_at_period_end=true`), then `subscription.revoked` at period end.
- Treat `canceled` = "show retention banner, still has access". Treat `revoked` = "downgrade to Free NOW".

### 28.5 Entitlement enforcement architecture

```
                     Polar webhook
                          │
                          ▼
                 webhooks-worker (verify + dedup)
                          │
                          ▼
                Supabase entitlements row
                   (durable truth)
                          │
              ┌───────────┴───────────┐
              ▼                       ▼
     Cloudflare KV cache         QuotaTracker DO
     (5min TTL, eventually      (strong consistency,
      consistent global view)    atomic increments)
              │                       │
              ▼                       ▼
     gateway middleware        tool execute / agent step
     (entitlement check,       (per-quota check)
      hard limits)
```

**Three layers:**

1. **Supabase `entitlements`** — durable source of truth. Updated by Polar webhook only.
2. **Cloudflare KV** (`entitlement:${userId}`, 5min TTL) — global cache. ~2 second propagation.
3. **QuotaTracker DO** — atomic counter for activity quotas. Authoritative for "am I over my quota right now."

### 28.6 Schema additions

> **Canonical user identity.** Every table in the database keys users by the **internal UUID `users.id`** (uuid v7). `clerk_id` is a lookup column that lives **only on `users`** — it is never an FK target and never appears in another table. The webhook layer resolves Clerk ID → internal UUID exactly once (§29.6); everything downstream uses the UUID. `withUserContext()` (§7.3) sets `app.user_id` to the internal UUID, so RLS policies compare `uuid` to `uuid`.

```sql
-- packages/db/src/schema/billing.ts (NEW domain file)

create table entitlements (
  user_id            uuid primary key references users(id) on delete cascade,
  tier               text not null default 'free' check (tier in ('free','pro','premium','ultra','max')),
  polar_customer_id  text,
  polar_subscription_id text,
  subscription_status text not null default 'none',
  cancel_at_period_end boolean not null default false,
  current_period_start timestamptz,
  current_period_end   timestamptz,
  max_projects         int not null default 3,
  max_concurrent_sandboxes int not null default 1,
  max_seats            int not null default 1,   -- frozen at 1 (seats retired with Team tier)
  quota_sandbox_hours  numeric not null default 5,
  quota_composio_calls int not null default 1000,
  quota_deployments    int not null default 5,
  flag_private_projects boolean default false,
  flag_sso              boolean default false,
  updated_at           timestamptz not null default now(),
  webhook_event_id     text,
  source               text
);

create table billing_events (
  id            uuid primary key default public.uuidv7(),
  user_id       uuid references users(id) on delete set null,
  event_type    text not null,
  polar_event_id text unique,
  payload       jsonb,
  processed_at  timestamptz default now()
);
create index on billing_events (user_id, processed_at desc);

-- Activity punchcard: per-run start timestamps for GET /v1/usage/daily `runs[]` (§28.10).
-- Hand-edited post-migration index (numbered at land time, §7.10).
create index v2_agent_runs_user_started_idx on v2_agent_runs (user_id, started_at desc);
```

**Tier migration (Team/Enterprise retired):** the `tier` CHECK alter is paired with an
`UPDATE` mapping `team → premium` and `enterprise → max` before the new constraint is
applied. The per-category usage rollup (`v2_usage_daily_categories`) is **not** added — the
Activity card is a per-run punchcard read directly from `v2_agent_runs` via the index above.

**Polar customer mapping:** Polar's `external_id` is set to the internal `users.id` UUID (not the Clerk ID). `polar.customers.getStateExternal({ externalId: internalUserId })` resolves directly. The webhook handler maps the Polar event → `users.id` via `polar_customer_id` or `external_id`.

### 28.7 Cache invalidation flow

- Polar webhook arrives → updates Supabase → writes Cloudflare KV → broadcasts on DO pub/sub (`user:${userId}:entitlement_changed`) → Workers invalidate in-memory copies.
- Median propagation: ~2 s globally via KV.
- Active sessions get strongly-consistent updates via DO fanout.

### 28.8 Fail-open vs fail-closed

| Scenario | Behavior |
|---|---|
| Supabase down + KV miss | Fail-open: assume current cached tier; no cache → assume Free |
| QuotaTracker unreachable at run creation (sandbox-hours gate) | Fail-open (logged + analytics event); the `GET /v1/me/usage` display endpoint returns 503 |
| Hard limits (concurrent sandboxes, projects) | Fail-closed: always block on cap |
| 24h grace after `subscription.past_due` | Keep tier active, banner says "update payment" |
| `subscription.revoked` | Drop to Free immediately |

### 28.9 Downgrade behavior

On tier downgrade:
- **Resource overages:** mark excess projects `over_quota=true` and
  `archived_pending_action=true`, set `archive_after=now()+30 days`, and freeze
  writes/runs/terminal/file edits. Users may delete excess projects or upgrade;
  a later keep/archive chooser can clear these flags. Enforcement is
  server-side only (gateway returns 403 on writes/runs); the Paper design has
  no dedicated read-only composer state, so the web client ships none.
- **Active sandboxes exceeding new cap:** let current finish; block new spawns.
- **BYOK slots:** keep keys but set `disabled_at`/`disabled_reason` beyond the
  current slot limit; Vault retrieval ignores disabled rows until the user
  removes keys or upgrades.

### 28.10 Sandbox-hours usage meter

The **user-facing usage unit is sandbox hours** — read directly from the period-keyed
QuotaTracker counter. There is **no derived "credit" unit, no `credits = hours × N` mapping,
and no ledger**; BYOK LLM token spend never debits the hours meter (LLM run cost stays
governed by `budgetCapUsd` / `dailyCostCapUsd`, §8.7, and is surfaced via `totals`).

- `GET /v1/me/usage` → `SandboxUsageSummary` (`{ sandboxHoursUsed, sandboxHoursTotal, resetAt,
  tier }`); replaces any credits endpoint.
- `GET /v1/billing/catalog` → `PlanCatalog` (tier/price/sandbox-hours) sourced from
  `PLAN_CATALOG` (`packages/billing/src/catalog.ts`), the single source of truth.
- **Activity chart = a per-run punchcard** read from `v2_agent_runs` via
  `v2_agent_runs_user_started_idx` (the `runs[]` extension on `GET /v1/usage/daily`), not a
  per-category rollup.
- The 402 quota error body is `{ sandboxHoursTotal, sandboxHoursUsed, resetAt, tier }`
  (`quota_exhausted_sandbox_hours`); run-control renders it as an upgrade prompt, and the
  `data-quota` part wording is "Sandbox hours: 58 of 60 used — resets Jul 1".

*Optional future note:* a branded "credits" display could later be layered as a thin
client-side formatter over this hours number, requiring no backend/schema/contract change
(recorded so the option is not lost; seat plans, hour top-ups/promo grants, and a branded
credits layer are all on the future.md cut list).

---

## 29. Onboarding & Lifecycle Hooks

### 29.1 Activation metric (the one we optimize)

**Primary:** "First agent run completed successfully" within 5 min of signup. **Target: <90 seconds.** Industry benchmark: Cursor ~3min, Lovable ~2min, v0 ~90s.

Secondary signals are emitted through `cc_user_events`: first preview opened,
first BYOK key added, and first generated artifact.

### 29.2 First-run flow (5 screens, all skippable, <90s)

After Clerk auth (Google/GitHub one-click; email/phone fallback, no password by default), the
shipped onboarding is a **5-screen flow**, every step **skippable**, persisted to
`v2_user_profiles.onboarding_state` and gated until `onboarding_completed_at` is set:

1. **Intro** — what Cheatcode does; single "Get started" CTA.
2. **Name** — the user's preferred agent display name (→ `agent_display_name`).
3. **Tools** — connect integrations; the Composio step **links out to
   `/settings/integrations`** for this round (inline connect is a later upgrade).
4. **Basics** — per-surface Agent defaults seed (App builder / General agent model + budget)
   and global memory.
5. **Plan** — renders the billing-credits tier catalog (`GET /v1/billing/catalog`) + tier
   checkout; selecting a paid tier opens tier-based Polar checkout (§28.3).

**Clean implementation — NO backfill (decision #4).** The onboarding gate applies to
**everyone**; pre-existing (dev) accounts are **cleared out**, not migrated — there is no bulk
`onboarding_complete` job. The <90 s activation framing still holds: a user can skip straight
through to a first agent run.

### 29.3 Post-activation checklist (sidebar, dismissible)

Persists 7 days. 4 gamified tasks:

- ☐ Build your first project ← auto-checks on first run
- ☐ Add your LLM API key ← BYOK CTA
- ☐ Open your first preview ← activation depth
- ☐ Connect an integration ← growth (links to `/settings/integrations`; the "invite a teammate" task is retired with seats/Team)

### 29.4 Empty states (never show "0 of X" alone)

- **No projects:** 6 template tiles + "or describe what you want" prompt box.
- **No BYOK keys:** banner — "Cheatcode is bring-your-own-key. Add one to keep building." with deep link.

### 29.5 Time-to-value targets (locked)

| Milestone | Target | Industry benchmark |
|---|---|---|
| Signup → first agent run | <90 s | Lovable ~60 s |
| Signup → first deployment | <5 min | v0 ~3 min |
| Signup → first preview | <10 min | Replit ~7 min |
| D1 retention | >40% | median 35% |
| D7 retention | >25% | median 18% |
| Free→Paid by D30 | 3–5% | Lovable 4%, Cursor 6% |

### 29.6 Clerk webhook handlers

Configured events: `user.created`, `user.updated`, `user.deleted`, `session.created`. Verify via Svix (`verifyWebhook` from `@clerk/backend`).

**`user.created` → idempotent primary flow.** This handler is the normal place a Clerk ID enters the system; it mints the internal `users.id` UUID and everything downstream uses that. The gateway also has a narrowly scoped fallback for local development and webhook-delay resilience: after a Clerk JWT has been verified, if `resolveInternalUserId()` returns null and `CLERK_SECRET_KEY` is available, the gateway fetches the Clerk user via `createClerkClient({ secretKey }).users.getUser(clerkUserId)`, extracts the primary email, and calls the exact same `upsertClerkUser()` path. It never trusts a client-supplied email and it remains idempotent with the webhook.

```ts
async function onUserCreated(evt: ClerkWebhookEvent) {
  const { id: clerkId, email_addresses } = evt.data;

  // INSERT ... RETURNING id gives us the internal UUID (uuidv7 default).
  // On conflict (webhook retry) we still need the existing internal id.
  const [user] = await db.insert(users)
    .values({ clerkId, email: email_addresses[0].email_address })
    .onConflictDoUpdate({
      target: users.clerkId,
      set: { email: email_addresses[0].email_address },
    })
    .returning({ id: users.id });

  await db.insert(entitlements)
    .values({ userId: user.id, tier: 'free' /* default limits from §28.1 */ })
    .onConflictDoNothing();

  emitUserEvent(env, { event: 'signup_completed', userId: user.id, authMethod: 'oauth' });
}
```

Clerk handles welcome / verification / password-reset emails internally. We do **not** send any transactional email from our system in V1.

**`user.updated`** — resolve `clerkId → users.id`, propagate email/name/avatar
into `v2_users`; if the user already has `polar_customer_id`, push the latest
email/name to Polar with `customers.update({ id, customerUpdate: { email, name
} })` so receipts route correctly.

**`user.deleted` (GDPR DSR):**
1. Soft-delete: `users.deleted_at = now()`
2. Enqueue a Cloudflare Workflow:
   - Cancel Polar subscription (revoke + prorated refund)
   - Terminate active sandboxes; `unexposePort()` every exposed preview/takeover port
   - Revoke Composio OAuth tokens (Gmail, Slack, GitHub, etc.)
   - Archive all projects
3. After 30-day grace → hard-delete, via a **deletion-manifest Workflow that covers Postgres, R2, and Durable Objects** — DB rows alone are not enough:
   - **Postgres:** V2-prefixed tables (`v2_users`, `v2_user_profiles`, `v2_entitlements`, billing rows except `v2_billing_events`, `v2_projects`, `v2_threads`, `v2_messages`, `v2_agent_runs`, `v2_user_integrations`, `v2_generated_outputs`, `v2_usage_events`, `v2_usage_daily_totals`, `v2_provider_keys`) plus `delete_all_provider_keys()` to purge the user's Supabase Vault BYOK secret rows before the metadata cascade. `v2_user_profiles` is covered by `ON DELETE CASCADE` (PK=user_id FK→v2_users), so the `v2_users` delete reaps it automatically. Existing V1 tables in the same Supabase project are left untouched.
   - **R2 — delete every prefix the user owns:** `cheatcode-outputs/{userId}/`, `cheatcode-uploads/{userId}/`, and the `cheatcode-snapshots` `DirectoryBackup` objects for the user's projects.
   - **Durable Objects:** the webhooks Worker calls HMAC-protected internal Service Binding routes on `agent-worker` and `gateway-worker`; `AgentRun` clears its storage, `ProjectSandbox` destroys Blaxel state and clears its storage, and `QuotaTracker` clears quota counters/limits for the user.
   - **Retry semantics:** already-deleted Blaxel sandboxes count as success, but every other Blaxel deletion failure bubbles to the Cloudflare Workflow retry policy before Durable Object state is cleared. R2 output cleanup deletes the whole `{userId}/` prefix and then any indexed keys outside that prefix, so unindexed artifacts cannot survive the DSR.
   - **Retained deliberately:** `billing_events` for 7 years (tax/legal), PII-scrubbed; `cheatcode-audit` gzipped NDJSON archives per the audit-retention policy (compliance record, not user-erasable), also PII-scrubbed.

### 29.7 Custom claims in JWT — NO

Clerk's 1.2 KB session cookie too tight for tier + quota + flags. Tier-in-JWT = stale-tier-in-JWT. **All entitlements server-side; resolve per-request from KV (~2 ms).**

One exception: `onboarding_complete: boolean` in `user.public_metadata`, exposed as JWT custom claim — used by Next.js middleware for the onboarding-gate routing (§29.2) without a DB lookup.

**Required Clerk config:** the session-token template must mirror public metadata into the
JWT with the claim `{"metadata": "{{user.public_metadata}}"}` (Clerk dashboard → Sessions →
customize session token). Without this claim the middleware cannot read
`onboarding_complete` from the token and would fall back to a DB lookup on every navigation.
This is an ops configuration step, verified during QA.

### 29.8 Cheatcode-owned notifications are out of V2

V2 ships **no email, no SMS, no Slack inbound or outbound from Cheatcode, no web
push, and no persisted in-app notification center**. Current-screen feedback is
rendered inline by the active UI surface: quota warnings, BYOK key validation
failures, sandbox status, and billing past-due state appear as banners, toasts,
or stream parts while the user is already in the app. Do not add
`v2_notifications`, `/v1/notifications`, polling bridges, service workers, or
background notification delivery unless the user explicitly updates this plan.

Every open tab still holds its own SSE stream to the AgentRun DO; the DO fans
each new run part out to all live subscribers, so active multi-tab sessions stay
in sync in real time without a notification feature.

**Auth-related email (verification, password reset, magic link)** — entirely handled by Clerk; we don't customize or proxy it.

**Billing receipts** — entirely handled by Polar as merchant-of-record.

**Composio integrations** (Gmail / Slack / Notion / Linear / GitHub etc.) — these are agent tools, not notification channels. When the user explicitly asks the agent to "send an email to X" or "post in #channel," the agent uses the user-connected Composio OAuth to act on their behalf. Cheatcode itself never sends email/SMS/Slack on its own initiative.

### 29.9 Cancellation flow

Cancellation is handled in Settings → Billing, not by scripts or external
support flows. The V2 product supports:

1. **Reason picker** (`too_expensive`, `missing_features`, `switched_service`,
   `unused`, `customer_service`, `low_quality`, `too_complex`, `other`) plus an
   optional free-text comment.
2. **Confirmation** that the plan cancels at period end and access remains
   active until the current Polar period end.
3. **Easy reactivation** while `cancel_at_period_end = true`.

The gateway calls Polar with `subscriptions.update({ id, subscriptionUpdate:
{ cancelAtPeriodEnd: true|false } })`. Immediate revoke is not exposed in the
app; revoked subscriptions use a new checkout. In-app discounts, pause plans,
win-back campaigns, and coupon automation are outside V2 unless the plan is
explicitly re-expanded with exact Polar product/discount behavior.

**Re-activation:** `POST /v1/billing/reactivate` — if within billing period and the subscription is only marked cancel-at-period-end, call Polar `subscriptions.update({ id, subscriptionUpdate: { cancelAtPeriodEnd: false } })`. If revoked, new checkout.

**Win-back:** handled outside the V1 product by the owner. The app itself does not send win-back email/SMS/Slack messages.

### 29.10 Anti-fraud

| Vector | Mitigation |
|---|---|
| Signup bots | Clerk bot protection ON; V2 enforces verified primary email before sandbox-spawning run creation; custom SignupRateLimiter/disposable-email enforcement is deferred unless Clerk-hosted signup is replaced with a Cheatcode-owned signup form |
| Multi-account farming | `cf-connecting-ip` + browser fingerprint; flag >3 accounts/fingerprint to ops review (never auto-block) |
| BYOK key validation | On add: `packages/byok.validateProviderKey()` calls a provider-specific low-impact endpoint; reject 401/403 (and equivalent invalid-key statuses). `OpsMaintenanceWorkflow` periodically revalidates stored key metadata through Vault without logging plaintext. No user-facing scheduled-agent surface. |
| Sandbox cryptomining | CPU cap (1 vCPU free / 2 paid); kill after 60 min idle; kill after 24h total wall-clock; a process sustaining >90% CPU for 30 min → terminate + flag user |
| Sandbox egress abuse | V1: egress is open (no domain allowlist — see §9.6). Contained by the resource caps above + audit trail. v1.5 adds a filtering egress proxy. |
| Composio call abuse | Sub-rate-limit: max 100 calls/min regardless of monthly bucket; >10× baseline spike pages on-call |

---

## 30. Performance Budgets & Telemetry

### 30.1 Latency targets (locked)

**Workers / infra:**

| Operation | P50 | P95 | P99 |
|---|---|---|---|
| Worker cold start (TLS-prewarmed) | <5 ms | <15 ms | <50 ms |
| Worker warm dispatch | <1 ms | <3 ms | <10 ms |
| Service Binding hop | <0.5 ms | <2 ms | <5 ms |
| DO request (same colo) | <5 ms | <15 ms | <40 ms |
| DO request (cross-colo) | <30 ms | <80 ms | <150 ms |
| Hyperdrive query (cached) | <10 ms | <25 ms | <60 ms |
| Hyperdrive query (uncached) | <40 ms | <120 ms | <300 ms |
| Sandbox warm exec | <50 ms | <150 ms | <400 ms |
| Sandbox cold start (snapshot restore) | <800 ms | <2.0 s | <4.0 s |
| Sandbox cold start (fresh image) | <8 s | <20 s | <45 s |

**LLM streaming:**

| Metric | Target |
|---|---|
| Time-to-first-token (TTFT) | P50 <700 ms · P95 <1.8 s · P99 <3.5 s |
| TTFT with prompt cache hit | P50 <350 ms |
| Tokens/sec (Sonnet-class sustained) | ≥60 tok/s |
| Tokens/sec (Haiku-class) | ≥120 tok/s |
| Streaming chunk size to client | 16–64 chars per SSE event |
| Control RPC (cancel/resume — POST → gateway → DO) | P95 <100 ms |

**Agent steps:**

| Operation | P50 | P95 | P99 |
|---|---|---|---|
| Single agent step (LLM + parse) | <2 s | <6 s | <15 s |
| Tool invocation (sandbox `exec`) | <500 ms | <2 s | <8 s |
| Tool invocation (HTTP fetch) | <300 ms | <1 s | <3 s |
| Full agent run (5-step build) | <30 s | <90 s | <180 s |

**Frontend (chat UI, p75 real-user):**

| Metric | Target |
|---|---|
| INP | <200 ms |
| LCP | <1.8 s |
| CLS | <0.05 |
| TTFB | <400 ms |
| First message render after submit | <300 ms |

### 30.2 SLO definitions

| SLO | Target | Window | Error budget | Burn-rate alert |
|---|---|---|---|---|
| Gateway availability (non-5xx) | 99.9% | 30d | 43.2 min | 2% over 1h OR 5% over 6h |
| Agent run success (ok OR abandoned-by-user) | 97% | 30d | 21.6 h failed runs | 2× expected fail rate over 1h |
| Streaming connection reliability (no mid-stream drop) | 99% | 7d | 1.68 h | 5 mid-drops/min in 5-min window |
| TTFT P95 | <1.8 s | 7d | 8.4 h above SLO | P95 >2.5 s for 10 min |
| Sandbox exec success | 99.5% | 30d | 3.6 h | 1% failure over 15 min |
| Silent-failure rate | <2% | 7d | — | >5% over 1h |
| Cost-per-run regression | <120% of 7d median | rolling 1h | — | >150% for 30 min |

**Cost guardrails:** (these govern LLM run cost only — user billing is sandbox-hours, §28.
Run-cost USD prefers the gateway-reported cost, falling back to the cached OpenRouter
`/models` price map; no hard-coded price table, §4.2.)
- Per-run hard cap: default $5 ("No cap" run option = uncapped, §8.7); kills run, emits `silent_failure_detected:cost_spike`
- Per-user daily cap: scaled by tier (e.g. $10 Free, rising monotonically Pro→Max), enforced at run creation from same-day `v2_usage_events` and again inside AgentRun as the stream accrues spend
- No separate per-tenant token quota ships in V2. The locked §28 pricing matrix
  treats LLM tokens as BYOK and defines no token allowance values; runaway model
  usage is controlled by the per-run and daily cost caps above. Add a token
  budget only after §28 names exact tier values and UI copy.

### 30.3 Telemetry event catalog

**Funnel events:**

| Event | When | Attributes |
|---|---|---|
| `signup_completed` | Clerk `user.created` | `user_id`, `auth_method`, `referrer`, `utm_source` |
| `first_run_started` | First agent run | `user_id`, `run_id`, `template`, `prompt_length`, `model` |
| `first_run_completed` | First successful run | `user_id`, `run_id`, `duration_ms`, `tokens_used`, `tool_calls`, `error` |
| `first_byok_key_added` | First successful BYOK key save | `user_id` |
| `first_preview_opened` | First real preview panel open | `user_id` |
| `first_generated_artifact` | First R2-backed generated output | `user_id`, `run_id` |
| `first_paid` | Polar `subscription.created` | `user_id`, `plan`, `mrr_cents` |
| `retention_d7` | Computed daily | `user_id`, `cohort_week` |
| `retention_d28` | Computed daily | `user_id`, `cohort_month` |
| `first_week_mau` | ≥3 runs in week 1 | `user_id` |

**Per-run events:**

| Event | Attributes |
|---|---|
| `run_started` | `run_id`, `user_id`, `model`, `prompt_length`, `template_id` |
| `step_started` | `run_id`, `step_idx`, `step_type`, `tool_name` |
| `step_completed` | `run_id`, `step_idx`, `duration_ms`, `tool_name`, `result_bytes` |
| `tool_invoked` | `run_id`, `step_idx`, `tool_name`, `result_bytes`, `duration_ms` |
| `skill_invoked` | `run_id`, `skill_name`, `duration_ms` |
| `run_completed` | `run_id`, `status`, `duration_ms`, `total_tokens`, `usd_cost` |
| `run_abandoned` | `run_id`, `user_id` (emitted when the last stream subscriber disconnects while status is still `running`) |
| `tier_upgraded` | `user_id`, `from_plan`, `to_plan`; MRR delta is omitted in V2 because Polar monthly/annual revenue cannot be inferred safely from every webhook payload without a separate pricing snapshot |

**Errors / cost / failures:**

| Event | Attributes |
|---|---|
| `cost_aggregated_daily` | `user_id`, `date`, `tokens_in`, `tokens_out`, `cache_read`, `cache_write`, `usd_total` |
| `error_emitted` | `run_id`, `user_id`, `error_category`, `error_code`, `worker_name`, `route` |
| `silent_failure_detected` | `run_id`, `detector` (tool_loop / output_validator / cost_spike), `confidence` |

Silent-failure detection is mandatory — semantic detectors catch what status codes miss.

### 30.4 Workers Analytics Engine datasets

Five datasets. Limits: 20 blobs, 20 doubles, 1 index per write; total blobs ≤16 KB.

**Dataset 1: `cc_agent_metrics`**

```ts
env.AGENT_METRICS.writeDataPoint({
  indexes: [user_id],
  blobs: [run_id, agent_name, model, step_type, status, error_code ?? "", worker_name, env_tag, version_tag],
  doubles: [duration_ms, prompt_tokens, completion_tokens, cache_read_tokens, cache_write_tokens, usd_cost_micros, step_idx, tool_call_count],
});
```

**Dataset 2: `cc_user_events`** — funnel

```
indexes: [user_id]
blobs:   [event_name, plan, referrer, utm_source, country, run_id, auth_method, template_id, model, error_code, detector, run_status, event_date, from_plan, to_plan, cohort_week, cohort_month, step_type, tool_name, skill_name]
doubles: [mrr_cents, value_usd_micros, prompt_length, duration_ms, tokens_used, tool_calls, confidence, tokens_in, tokens_out, cache_read_tokens, step_idx, result_bytes]
```

**Dataset 3: `cc_error_events`**

```
indexes: [worker_name]
blobs:   [error_category, error_code, route, user_id, run_id, version_tag, message_truncated, stack_top]
doubles: [http_status, retry_count, duration_ms]
```

**Dataset 4: `cc_performance_metrics`**

```
indexes: [route]
blobs:   [worker_name, env, version_tag, status_class]
doubles: [ttft_ms, total_ms, postgres_ms, sandbox_ms, llm_ms, queue_wait_ms]
```

**Dataset 5: `cc_cost_events`**

```
indexes: [user_id]
blobs:   [model, tool_name, cache_hit, run_id, day]
doubles: [usd_micros, tokens_in, tokens_out]
```

### 30.5 Sample WAE queries

```sql
-- Per-user daily cost (last 7d)
SELECT toDate(timestamp) AS d, index1 AS user_id,
       SUM(double1 * _sample_interval) / 1e6 AS usd
FROM cc_cost_events
WHERE timestamp > NOW() - INTERVAL '7' DAY
GROUP BY d, user_id ORDER BY usd DESC LIMIT 100;

-- Error rate by route (last hour)
SELECT blob1 AS route,
       SUM(IF(blob4='error', _sample_interval, 0)) /
       SUM(_sample_interval) AS error_rate
FROM cc_agent_metrics
WHERE timestamp > NOW() - INTERVAL '1' HOUR
GROUP BY route;

-- P95 step latency by model
SELECT blob3 AS model,
       quantileExactWeighted(0.95)(double1, _sample_interval) AS p95_ms
FROM cc_agent_metrics
WHERE timestamp > NOW() - INTERVAL '1' DAY
GROUP BY model;
```

### 30.6 Workers Tracing (OTel) configuration

Open beta since 2025-11-07. Automatic spans for `fetch`, Service Bindings, DOs, KV, R2, D1, Hyperdrive, Queues, AI, Workflows — no instrumentation required.

```jsonc
{
  "observability": {
    "logs":   { "enabled": true, "head_sampling_rate": 1.0 },
    "traces": {
      "enabled": true,
      "head_sampling_rate": 0.1,
      "persist": true
    }
  }
}
```

**Sampling rules:**

| Trace type | Rate |
|---|---|
| Default request | 10% |
| Errors (status≥500 or `cc.error_code≠""`) | 100% (tail sampling) |
| Authenticated agent runs | 25% |
| Background maintenance/webhook | 5% |
| Health checks | 0% |

**Span attribute conventions (OTel GenAI + Cheatcode-specific):**

```
gen_ai.system           = "anthropic" | "openai" | "google"
gen_ai.request.model    = "claude-sonnet-4-6"
gen_ai.usage.input_tokens / output_tokens / cache_read / cache_creation
gen_ai.response.finish_reasons = ["stop"]
cc.run_id               = uuid
cc.user_id              = string
cc.agent_name           = "planner" | "executor" | ...
cc.step_idx             = int
cc.tool_name            = string
cc.sandbox_id           = string
cc.cost_usd_micros      = int
```

### 30.7 Logging discipline

| Level | Use |
|---|---|
| `debug` | Local-only, off in prod |
| `info` | Run lifecycle, billing decisions, deployments, admin actions |
| `warn` | Recoverable (rate-limit retry, slow query) |
| `error` | Unrecoverable (5xx, tool fatal, billing failure) |

**Format:** JSON one event per line:

```json
{"ts":"2026-05-20T10:32:01Z","level":"info","worker":"agent","run_id":"...","user_id":"...","msg":"step_completed","step_idx":3,"duration_ms":1840}
```

**Sampling:**
- Errors: 100%
- Warn: 100%
- Info on hot paths: 10%
- Info on rare paths: 100%
- Debug: 0% in prod

**Redaction (regex block-list before write):**
- API keys: `/(sk-|sk_test_|sk_live_|polar_|hyper_)[A-Za-z0-9_-]{20,}/` → `[REDACTED]`
- BYOK keys: never logged
- Email: `sha256[:12]` if needed for correlation
- Prompt bodies: only first 256 chars
- Tool args containing `password`, `token`, `auth`, `secret` keys: drop value, keep key

### 30.8 Performance optimization patterns

| Pattern | When | Target |
|---|---|---|
| Anthropic ephemeral prompt cache (`cacheControl: { type: 'ephemeral' }`) | System prompt ≥1024 tokens (Sonnet), repeated within 5 min | TTFT savings 30–50%; break-even at ~2 reuses |
| Streaming chunk size | Always | 16–64 chars per SSE event |
| DO request batching | Multi-write hot path | Coalesce within 5 ms tick |
| Hyperdrive query cache | Read-heavy idempotent | TTL 60 s reads / 0 s writes |
| R2 multipart upload | Files >100 MB | 8–16 MB parts, 10 parallel |
| Frontend code splitting | Always | First-paint bundle <90 KB gzip |
| Service Binding hop | Always | No network, direct isolate, <2 ms P95 |
| Cache API | Idempotent GETs | 60 s edge-side |

**Anthropic prompt-cache rule:** writes cost 1.25× standard, reads cost 0.1×. Break-even ≈ 2 reads within TTL. Cache system prompt + tool definitions + first N stable turns. Never cache the user's latest turn.

### 30.9 Reference codebases

- `vercel/ai-chatbot` — `useChat` streaming, prompt caching on Anthropic
- `vercel-labs/open-agents` — multi-Worker layout with Service Bindings, Mastra orchestrator
- `cloudflare/agents` (GA April 2026) — canonical DO + streaming + tool-call patterns
- `blaxel-ai/sdk-typescript` sandbox examples — process, filesystem, preview, session examples

---

## Appendix A — Provider TS SDK Quick Reference

| Purpose | Package | Default model/config |
|---|---|---|
| LLM (Anthropic) | `@ai-sdk/anthropic@2.0.50` | `claude-sonnet-4-6` w/ ephemeral cache + thinking |
| LLM (Google Gemini) | `@ai-sdk/google@3.0.80` | `gemini-2.5-flash` |
| LLM (OpenAI) | `@ai-sdk/openai@2.0.101` | `gpt-5.4-mini` |
| LLM (OpenRouter) | `@openrouter/ai-sdk-provider@2.9.0` | explicit `openrouter/<model-id>`, e.g. `openrouter/openrouter/auto` |
| Web search | `exa-js@2.13.0` | `search()` with nested `contents` |
| Scrape | `@mendable/firecrawl-js@1.29.0` | `/scrape` + `/extract` |
| Browser | `@browserbasehq/stagehand@3.2.0` | LOCAL mode in container |
| MCP client | `ai@6.0.182` `experimental_createMCPClient` | — |
| Auth | `@clerk/nextjs@7.3.4`, `@clerk/backend@3.4.9` | — |
| Billing | `@polar-sh/sdk@0.46.4` | — |
| Sandbox | `@blaxel/core@0.2.84` | `blaxel/base-image:latest` or custom Cheatcode sandbox image |
| DB | `drizzle-orm@0.45.2`, `drizzle-kit@0.31.10` | — |
| Weather (greeting) | Open-Meteo (keyless HTTP, no SDK) | gateway-only `fetch`, Cache-API 15 min TTL |

---

## Appendix B — Repository setup checklist

- [ ] Create GitHub repo `cheatcode/cheatcode` (private)
- [ ] Create Cloudflare account for Workers, R2, Hyperdrive, Workflows, and domain DNS
- [ ] Create/access Blaxel workspace `cheatcode`
- [ ] Add `trycheatcode.com` as a Cloudflare zone (one zone covers all subdomains)
- [ ] Update domain registrar nameservers to Cloudflare's
- [ ] DNS records to create in the `trycheatcode.com` zone:
  - `CNAME gateway → <worker>.workers.dev` (proxied; bound to gateway-worker via `routes`)
  - `CNAME webhooks → <worker>.workers.dev` (proxied; bound to webhooks-worker)
  - Optional Blaxel custom preview domain after verification; initial previews may use `*.preview.bl.run`
  - `CNAME @` and `CNAME www` → Cloudflare Worker route `cheatcode-web`
- [ ] Create Cloudflare Worker `cheatcode-web` through `apps/web/wrangler.jsonc`
- [ ] Create Supabase project + note URL/keys
- [ ] Create Clerk app + configure OAuth providers (auth-email handled by Clerk; we do not customize templates in V1)
- [ ] Create Polar account + configure products (billing receipts handled by Polar as merchant-of-record)
- [ ] Enable Workers Observability (Logs + Tracing) in Cloudflare dashboard per Worker
- [ ] Configure GitHub Actions cache for Turborepo artifacts
- [ ] Configure GitHub Actions secrets:
  - `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
  - `OUTPUT_DOWNLOAD_SIGNING_SECRET`
  - `BL_API_KEY`, `BL_WORKSPACE`, `BL_REGION`
  - `SUPABASE_ACCESS_TOKEN`
- [ ] Run initial bootstrap (Section 18.1)
- [ ] Deploy to production
- [ ] Manually QA agent run end-to-end with direct `agent-browser` UI
      operation and log review only; do not use scripts or wrappers

---

## Appendix C — Glossary

| Term | Meaning |
|---|---|
| **Agent loop** | The cycle of LLM call → tool call → tool result → repeat until done |
| **AI SDK** | Vercel AI SDK — TS framework for LLM apps |
| **AgentRun DO** | Durable Object instance per agent run; holds run state + SQLite message buffer + live SSE subscribers |
| **BYOK** | Bring Your Own Key — user provides their own API keys for AI providers |
| **Blaxel sandbox** | Hosted persistent VM sandbox running per user/project with process, filesystem, preview, and standby APIs |
| **DO** | Durable Object — stateful Cloudflare Workers primitive |
| **Hyperdrive** | Cloudflare's Postgres connection pooler + query cache |
| **LOCAL mode** | Stagehand v3 mode where browser runs on user-controlled CDP endpoint (our sandbox) |
| **Mastra** | TypeScript agent framework on top of AI SDK |
| **noVNC** | JavaScript VNC client for browser-based remote desktop |
| **R2** | Cloudflare's S3-compatible object storage with zero egress |
| **Blaxel SDK** | `@blaxel/core` — manages hosted sandboxes, process/file APIs, previews, volumes, sessions, and lifecycle |
| **Service Binding** | Cloudflare's RPC mechanism between Workers (no network hop) |
| **Skill** | Filesystem-extensible agent capability (Anthropic SKILL.md format) |
| **Stagehand** | Browserbase's TS browser automation lib with AI methods (`act`/`extract`/`observe`) |
| **Streamdown** | Vercel's streaming-markdown React component |
| **Turborepo** | Monorepo build orchestrator + remote cache |
| **UIMessage** | AI SDK's typed message format with stream parts |
| **Vault** | Supabase's column-level encryption for secrets (libsodium-backed) |
| **Deep Research fan-out** | Mastra Workflow that fans out N parallel research subagents |
| **Workers Paid** | Cloudflare's paid Workers plan, enabled if production DO/Workflow/resource limits require it |
| **Workflows** | Cloudflare's durable workflow product for step-based execution and internal maintenance jobs. V2 does not expose recurring/scheduled agents. |

---

**Plan version:** 1.0
**Locked:** May 19, 2026
**Owner:** Cheatcode team
**Status:** Ready to implement

---
