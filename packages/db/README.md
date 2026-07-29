# @cheatcode/db

Drizzle schema, tenant-scoped queries, and the Hyperdrive-aware Postgres client
for Cheatcode.

## Ownership

Postgres stores product metadata and durable workflow state. User files remain
in Daytona workspaces, generated artifacts remain in R2, provider secrets remain
in Supabase Vault, and live stream state remains in Durable Objects.

Every runtime Worker uses its own least-privilege login:

- `app_gateway` owns authenticated product reads and writes.
- `app_agent` owns run, artifact, skill, and sandbox-related persistence.
- `app_webhooks` owns provider reconciliation and lifecycle jobs.

Runtime transactions enter a signed tenant context through `withUserDb` or the
handle-typed `withUserContext`. Nested transaction compositions accept only the
branded transaction context supplied by those helpers.
Administrative migration credentials are never exported by this package or
loaded by an application process.

## Current schema

The schema modules under `src/schema/` define:

- users and personalization profiles
- projects, threads, messages, and agent runs
- BYOK provider-key references and Composio integrations
- generated-output indexes and pending artifact-upload intents
- entitlements and sandbox/run activity
- user-authored skills
- project, account, refund, and daily-maintenance workflow jobs
- immutable Clerk deletion tombstones
- security-sensitive audit records

Files are not stored in Postgres. `v2_generated_outputs` contains only ownership,
mime, filename, and R2 object identity.

## Invariants

- All entity IDs are UUIDs and all public query helpers use branded IDs.
- User-facing reads and writes run under forced RLS.
- Project workspace slugs end in the owning project UUID and satisfy the
  filesystem-safe canonical constraint.
- Agent-run terminal status and `finished_at` move together.
- Assistant transcript segments are unique by run and segment, with one final
  segment marker.
- Provider-key rows contain Vault references and non-secret fingerprints only.
- Generated outputs and upload intents bind user, run, and project ownership.
- Agent-run skill-runtime capabilities store only bounded, short-lived digests;
  the agent role rotates them under signed user context and terminal transitions
  clear them.
- Lifecycle jobs use exact generation, phase, cursor, continuation, and lease
  identities so stale Workflow steps cannot mutate a newer operation.
- Clerk deletion tombstones are permanent hashes; they prevent a deleted
  external identity from being recreated by delayed webhooks.

## Lifecycle state

`v2_resource_deletion_jobs` and `v2_user_deletion_jobs` are durable Workflow
coordination records. They make multi-system deletion retryable across
Postgres, R2, Daytona, Composio, Polar, and Durable Objects. Successful and stale
jobs are removed; only quarantined failures remain for operator review.

`v2_user_deletion_refund_intents` fences the one external money mutation in
account deletion. Its immutable provider identity and idempotency key prevent a
retry from issuing a second refund.

`v2_daily_maintenance_jobs` coordinates daily activation aggregation, abandoned
upload-intent cleanup, and retention work. Each phase is leased and advances by
compare-and-swap.

`v2_artifact_upload_intents` is the durable half of the Postgres/R2 commit
protocol. An AgentRun reserves an output identity before writing R2 and
atomically replaces the intent with `v2_generated_outputs` after the object is
verified. Daily maintenance removes only quiesced, terminal, expired intents.

## Queries

Public exports include:

- `withDatabase`
- `withUserDb`
- `withUserContext`
- `assertDatabaseRuntimeReadiness`
- `resolveInternalUserId`
- project, thread, message, and agent-run helpers
- model-context suffix reads with logical-turn and byte bounds
- BYOK and integration helpers
- entitlement and usage helpers
- caller-configured user-skill list primitives plus locked count/insert/update composition
- entitlement-read/project-lock composition for billing-owned lazy-materialization limits
- lifecycle job discovery, claim, renewal, progression, and completion helpers
- locked refund-intent reads/writes that execute caller-owned transition policy in-transaction
- audit and maintenance helpers
- `schema/*`

List endpoints use versioned keyset cursors. Destructive workflows use bounded
pages and never serialize an unbounded tenant inventory into Workflow history.
External provider calls occur outside database transactions and advisory locks.

## Migrations

The repository keeps a single current-schema Drizzle baseline at
`drizzle/0000_current_schema.sql`, its generated snapshot, and the journal.
Future schema changes append ordinary forward Drizzle migrations. The
pre-launch historical migration archive is intentionally absent.

```bash
pnpm --filter @cheatcode/db db:generate
pnpm db:migrate -- --dry-run
pnpm db:migrate -- --apply
```

The migration runner:

1. Loads the git-ignored `.env.migrate`.
2. pins the expected host, database, role, and Postgres system identity;
3. acquires the shared database-maintenance advisory lock;
4. verifies the Drizzle journal checksum and ordering;
5. applies pending migrations only with `--apply`; and
6. validates the complete current table, column, constraint, index, function,
   RLS, grant, role, and data-integrity contract.

The laptop application environment contains only the three runtime-role URLs.
Administrative migration credentials stay in `.env.migrate` or a protected
operations environment.

## Code checks

```bash
pnpm --filter @cheatcode/db typecheck
pnpm --filter @cheatcode/db lint
pnpm --filter @cheatcode/db build
```

## Environment

Runtime callers supply their Worker-specific Hyperdrive binding and matching
tenant-context signing secret. Migration tooling uses:

- `SUPABASE_MIGRATION_URL`
- `SUPABASE_MIGRATION_EXPECTED_HOST`
- `SUPABASE_MIGRATION_EXPECTED_DATABASE`
- `SUPABASE_MIGRATION_EXPECTED_ROLE`
- `SUPABASE_MIGRATION_EXPECTED_SYSTEM_IDENTIFIER`
