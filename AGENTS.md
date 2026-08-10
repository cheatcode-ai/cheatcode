# AGENTS.md

This is the canonical contributor and coding-agent guide for Cheatcode. It
follows the [agents.md](https://agents.md) convention so the same instructions
work across supported tools.

These instructions apply to the entire repository. If a subdirectory later
adds its own `AGENTS.md`, the nearest file takes precedence for that subtree.
Explicit instructions in an issue, pull request, or user request take
precedence over repository guidance.

## Project

Cheatcode is a source-available generalist AI agent platform. Users describe an
outcome, and agents can build applications, create documents and media, conduct
research, and operate browser workflows.

The application is TypeScript-first and runs across Cloudflare and Vercel.
Users bring their own keys for paid AI and tool providers. The live source,
deployment configuration, database migrations, and package READMEs define the
current architecture.

## Stack

| Layer | Choice |
|---|---|
| Backend | Cloudflare Workers, Durable Objects, and Workflows |
| Frontend | Next.js 16.2.11, React 19.2.7, Tailwind CSS 4.3.2, AI Elements, and Streamdown on Vercel |
| Agent framework | Mastra 1.57.0 on Vercel AI SDK 7.0.58 |
| Sandbox | Per-user Daytona sandboxes through a bounded REST-over-fetch client |
| Browser runtime | Stagehand 3.7.0 in local mode inside the Daytona sandbox |
| Database | Supabase Postgres only, through Cloudflare Hyperdrive and Drizzle ORM 0.45.2 |
| Authentication | Clerk 7.5.19 |
| Billing | Polar 0.48.1 |
| Connected apps | Bounded Composio v3.1 REST client |
| Storage | Cloudflare R2 for generated outputs; no Supabase Storage |
| Observability | Workers Logs, Workers Tracing, and Workers Analytics Engine |
| Tooling | pnpm 11.15.0, Turborepo 2.10.5, TypeScript, and Biome 2.5.2 |

## Repository layout

```text
apps/
  web/                   Next.js application deployed on Vercel
  gateway-worker/        Public Hono API, Clerk auth, and request admission
  agent-worker/          Agent loop, Workflows, Durable Objects, and Daytona adapter
  preview-proxy/         Authenticated proxy for Daytona previews
  webhooks-worker/       Clerk, Polar, Composio, and Daytona webhook processing

packages/
  agent-core/            Mastra agents, workflows, contexts, and tool registry
  auth/                  Clerk verification and signed-capability protocols
  billing/               Polar integration, plan catalog, and entitlement policy
  byok/                  Vault-backed provider-key access and validation
  composio/              Bounded Composio REST client
  db/                    Drizzle schema, migrations, client, and scoped queries
  durable-storage/       Durable Object SQLite schema validation
  env/                   Zod-validated environment contracts
  observability/         Structured logging, redaction, errors, and analytics
  preview-bridge/        Shared code-server parent-frame integration
  sandbox-contracts/     Provider-neutral sandbox ports and validators
  skills/                Build-time skill loader and generated bundle
  tsconfig/              Shared TypeScript configurations
  types/                 Branded IDs, Zod schemas, API contracts, and UI types

skills/                  19 curated skill sources; _shared/office is vendored
infra/                   Local-development and Daytona container definitions
scripts/                 Build, development, migration, and safety tooling
.github/                 CI, deployment workflows, and community templates
```

Read the README in the app or package you are changing before moving an
architectural boundary. Package READMEs document public exports, checks, and
environment inputs.

## Contributor workflow

Use the exact Node.js version from the root `engines` field and the pnpm
version from `packageManager`. Do not substitute npm or Yarn.

```bash
pnpm install
pnpm dev
pnpm dev:down
pnpm turbo skills:build
pnpm db:generate
pnpm db:migrate -- --dry-run
```

`pnpm dev` starts the application stack through Docker Compose and requires a
complete, git-ignored `.env.local`. Administrative migration credentials
belong only in git-ignored `.env.migrate`; application processes must not load
them.

Before editing:

1. Inspect `git status` and preserve unrelated work.
2. Confirm dependency versions in `pnpm-workspace.yaml` and
   `pnpm-lock.yaml`.
3. Read the relevant app or package README.
4. Inspect the schema, migration, or deployment source of truth before changing
   that boundary.

Never commit `.env.local`, `.env.migrate`, provider keys, tokens, database
credentials, or sanitized-looking copies of real secrets.

## Verification policy

This repository intentionally has no unit-test suite. Code changes are verified
with static analysis, production builds, architectural checks, and real-flow
browser QA where behavior changes.

Run the complete gate chain before requesting review:

```bash
pnpm lint
pnpm typecheck
pnpm turbo build --force
pnpm deadcode
pnpm architecture:check
pnpm turbo skills:build
```

These gates cover Biome, TypeScript, production builds, Knip, dependency
boundaries, and the generated skill bundle. Markdown is not a substitute for
running applicable code gates.

For user-visible or integration behavior, exercise the real flow directly with
`agent-browser --auto-connect --session cheatcode-debug`. Capture relevant
screenshots and inspect the browser console, network activity, and running
application logs. Direct browser operation is the repository's acceptance
workflow; routine contributions should not add a separate scripted product,
browser, authentication, accessibility, load, or end-to-end harness.

Every pull request should include verification notes listing the commands run,
the real flows exercised, and any omitted check with its reason.

## Code conventions

CI enforces these rules:

1. Do not use explicit `any`; use `unknown` with narrowing or schema
   validation.
2. Do not use `console.log`; use the structured logger from
   `packages/observability`.
3. Application code does not read `process.env` directly; use
   `packages/env`. Framework configuration and operational scripts may use
   their documented boundary-specific loaders.
4. Use branded IDs for entities such as `UserId`, `ProjectId`,
   `ThreadId`, and `AgentRunId`.
5. Use named exports. Default exports are reserved for framework-required
   entrypoints such as Next.js routes, Worker entries, configuration files, and
   Mastra definitions.
6. Await, explicitly void, or chain every promise.
7. Zod-validate HTTP input, environment data, webhooks, provider responses, LLM
   output, and other trust boundaries.
8. Keep files at or below 800 lines, functions at or below 50 lines, and
   cognitive complexity at or below 15.
9. Add JSDoc to Mastra tool definitions; tool descriptions are production
   prompt behavior.

Files use `kebab-case`, React components use `PascalCase`, and type-only
modules end in `*.types.ts`. Types and interfaces use `PascalCase` without
an `I` prefix. Functions and variables use `camelCase`; booleans start with
`is`, `has`, `can`, or `should`. Reserve
`UPPER_SNAKE_CASE` for true module-level constants.

## Security and data boundaries

### BYOK keys

- Access provider keys only through `packages/byok`.
- Decrypt a key only inside the active `withUserContext()` transaction and
  pass the plaintext downward as a request-scoped value.
- Never log plaintext keys or place them in error details, analytics, or
  verification notes.
- Never cache plaintext in module scope or persist it in KV, Durable Object
  storage, Postgres, R2, or generated artifacts.
- Provider-key rows store Vault references and non-secret fingerprints, not
  plaintext.

### Database roles and RLS

Every runtime Worker connects with one of three separate, least-privilege
Postgres roles:

- `app_gateway` for authenticated product reads and writes;
- `app_agent` for run, artifact, skill, and sandbox persistence; and
- `app_webhooks` for provider reconciliation and lifecycle jobs.

Runtime Workers never use `service_role` or an administrative migration
login. Tenant-owned tables use forced row-level security and a role-specific,
signed transaction context established through `withUserDb` or
`withUserContext`. Do not bypass those transaction helpers or pass their
branded context outside its transaction.

Postgres stores product metadata and durable workflow state. User workspace
files remain in Daytona, generated artifacts remain in R2, provider secrets
remain in Supabase Vault, and live stream state remains in Durable Objects.

## Migration safety

Schema modules live in `packages/db/src/schema`; SQL migrations and their
journal live in `packages/db/drizzle`.

- Migrations are append-only. Never rewrite, reorder, or remove an applied
  migration or its journal entry.
- Use `generate -> review -> migrate`: run `pnpm db:generate`, inspect the
  generated SQL and snapshot, run `pnpm db:migrate -- --dry-run`, then apply
  with `pnpm db:migrate -- --apply` only against the approved target.
- Never use `drizzle-kit push` in production.
- Never run migrations with a runtime Worker role. The guarded runner requires
  an administrative URL plus pinned host, database, role, and Postgres system
  identity from `.env.migrate`.
- Preserve the migration runner's advisory lock, ledger integrity checks,
  session timeouts, and post-migration schema assertions.
- Update `packages/db/README.md` and affected package documentation when a
  database boundary changes.

## House naming conventions

Function prefixes are behavioral contracts:

- `fetch*` performs third-party network I/O.
- `load*` assembles a composite from the database.
- `read*` reads bytes or Durable Object storage.
- `get*` performs a cheap keyed lookup without a fallback chain.
- `resolve*` selects through an explicit fallback chain.
- `assert*` synchronously checks an invariant and throws.
- `require*` asynchronously fetches a prerequisite and throws when absent.
- `ensure*` idempotently creates or establishes a prerequisite.
- `guard*` wraps an operation with policy.
- `verify*` performs cryptographic verification.
- `validate*` applies business rules.

Data and lifecycle nouns also have fixed meanings:

- `Row` is a private raw persistence shape and keeps source
  `snake_case`.
- `Record` is an exported, mapped persistence shape in `camelCase`.
- `Options` are caller-selected, per-call inputs.
- `Config` is validated, longer-lived configuration.
- `Context` carries request-scoped dependencies and identity.
- `State` is mutable or persisted lifecycle data.

Wire and schema grammar:

- Generic wire or storage union tags use `type`.
- Generic in-process-only union tags use `kind`.
- Domain fields such as `status`, `provider`, and literal `ok` keep their
  names.
- Persisted message parts are wire data and use `type`.
- Schemas owned by this repository use `z.strictObject(...)`.
- Third-party payload projections use `z.object(...).strip()`
  intentionally.
- Use `z.looseObject(...)` only when the contract must preserve unknown keys.
- Error codes use `<category>_<subject>_<condition>`.
- Event names use `<subsystem>_<object>_<past-participle>`.

Architectural suffixes:

- Shared implementation modules end in `-support`, not `-utils` or
  `-helpers`.
- UI role modules use `-controller`, `-view`, or `-model`.
- Worker route collections use `-routes`; transport-only collections use
  `-http-routes`.
- Hooks keep a `use*` function name, but controller filenames omit a
  redundant `use-` prefix.

## Where things live

| Need | Location |
|---|---|
| Add a web route | `apps/web/src/app/<route>/page.tsx`; authenticated routes use the existing `(app)` group |
| Add a Worker route | `apps/<worker>/src/<domain>-routes.ts` or `<domain>-http-routes.ts`, registered from that Worker's `src/index.ts` |
| Add an agent tool | `packages/agent-core/src/tools/<domain>/<tool>.ts`; expose cross-package domains through a dedicated export subpath |
| Add a Mastra agent | `packages/agent-core/src/mastra/agents/<name>.ts` |
| Add a Mastra workflow | `packages/agent-core/src/mastra/workflows/<name>.ts` |
| Add a database table | `packages/db/src/schema/<domain>.ts`, then generate and review a forward migration |
| Add database queries | A focused module in `packages/db/src/`, exported through the package's public surface |
| Add shared API types or IDs | `packages/types/src/` |
| Add an environment contract | The matching app module in `packages/env/src/` |
| Add a curated skill | `skills/<name>/SKILL.md`, with optional `references/` or `assets/` |
| Change skill bundling | `scripts/build-skills.ts` and `packages/skills/` |
| Change sandbox contracts | `packages/sandbox-contracts/`; Daytona implementation details stay behind `packages/agent-core/src/tools/code/` |
| Change Durable Object SQLite state | `packages/durable-storage/` and the owning Durable Object module |
| Change preview-frame integration | `packages/preview-bridge/` |
| Change deployment topology | The relevant `wrangler.jsonc`, `apps/web/vercel.json`, and CI workflow |

Curated skills are bundled into `packages/skills/src/generated.ts` at build
time because Workers have no runtime filesystem. The source of truth is the set
of non-underscore directories under `skills/`;
`scripts/build-skills.ts` intentionally skips `_`-prefixed directories.

## Architectural constraints

- Do not use Node.js `fs` at runtime in Workers; bundle required files at
  build time.
- Do not use Supabase Realtime; Durable Objects own streaming.
- Do not store file bytes in Postgres; use R2 and the generated-output index.
- Do not introduce Inngest, Sentry, Langfuse, or Axiom. Use Cloudflare-native
  workflow and observability primitives.
- Do not use `service_role` from Workers.
- Do not use `postgres.js`; use `pg` for Hyperdrive compatibility.
- Do not bypass `packages/byok` for provider-key access.
- Do not expose Cheatcode as an MCP server; Cheatcode consumes MCP tools.
- Do not add hard step, token, or cost ceilings to agent loops. Semantic
  completion controls the loop; cancellation and timeouts remain operational
  safeguards.
- Do not introduce a new vendor without an explicit architecture decision and
  matching documentation and configuration changes.

When an architectural boundary moves, update the source, deployment
configuration, migration or schema, package README, and public exports in the
same change. Check `pnpm-workspace.yaml` and `pnpm-lock.yaml` for dependency
truth; `packages/db/src/schema` and `packages/db/drizzle` for database truth;
and Worker `wrangler.jsonc`, `apps/web/vercel.json`, and `.github/workflows`
for deployment truth.

## Commits and pull requests

Commit messages and pull request titles use Conventional Commits:

```text
feat(agent): add wide research workflow
fix(sandbox): handle snapshot restore on cold start
refactor(db): split provider keys by domain
docs(architecture): document a package boundary
```

Keep the subject on one line and below 72 characters. Pull requests should
explain the reason for the change, call out architecture or migration effects,
and include the verification notes described above.

## When stuck

- Architecture or ownership: start with the relevant app or package README and
  its public exports.
- Dependency or version question: inspect `pnpm-workspace.yaml` and
  `pnpm-lock.yaml`.
- Database or RLS question: read `packages/db/README.md`,
  `packages/db/src/schema`, `packages/db/drizzle`, and
  `scripts/database-operation-safety.ts`.
- Sandbox lifecycle issue: start with
  `apps/agent-worker/src/durable-objects/project-sandbox-lifecycle.ts`,
  `project-sandbox-runtime-handle.ts`, and
  `packages/agent-core/src/tools/code/daytona-client.ts`.
- Authentication issue: inspect `packages/auth/` and the gateway's
  authentication middleware.
- Agent-run streaming issue: inspect
  `apps/agent-worker/src/durable-objects/agent-run-stream-driver.ts`,
  `agent-run-mastra-stream.ts`, and
  `apps/agent-worker/src/streaming/ui-message-stream.ts`.
- Skill activation issue: inspect the skill frontmatter `description`, then
  `scripts/build-skills.ts` and `packages/skills/`.
- Strict TypeScript surprise: check `exactOptionalPropertyTypes` and
  `noUncheckedIndexedAccess` before weakening a type.
- Worker module resolution issue: verify package exports and the Worker's
  `nodejs_compat` setting in `wrangler.jsonc`.

## License and third-party materials

Contributions to repository-owned code are made under the root `LICENSE`.
First-party excluded assets and third-party materials have separate terms
described in `NOTICE`; do not assume the repository license applies to them.
