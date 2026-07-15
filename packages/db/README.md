# @cheatcode/db

Drizzle schema, queries, and Hyperdrive-aware Postgres client for Cheatcode V2.

## Public exports

- `createDb`
- `withUserContext`
- `resolveInternalUserId`
- project/thread/message helpers, including the bounded model-context suffix reader
- run admission, status, and logical-model attribution helpers
- billing entitlement helpers, including `cancel_at_period_end` subscription
  state for Polar cancellation/reactivation
- user-scoped run activity and sandbox-resource usage helpers
- daily activation cohort helpers for `retention_d7`, `retention_d28`, and
  `first_week_mau`
- lifecycle helpers for RLS-safe BYOK revalidation, invalid-key disablement, and
  Clerk deletion workflows
- bounded keyset helpers for object-first generated-output retention cleanup
- `schema/*`

Composio connected-account IDs are project-global provider identities and the primary
key of `v2_user_integrations`. Upserts may change status only when the stored
user and toolkit still match; an ownership/toolkit collision fails closed.
IDs must be trimmed, non-empty, and at most 256 characters.
Write helpers own a nested-safe transaction, serialize per user/toolkit, and
allow only an active account to be marked default.

Entitlement updates and resource-consuming writes use one advisory-lock order:
entitlement, then project or provider-key catalog. Project-count and BYOK-slot
checks therefore read the authoritative entitlement row and commit their write
under the same tenant lock as Polar reconciliation. Bulk Composio upsert/delete
helpers keep ownership and default selection in one short nested-safe database
transaction; provider I/O is deliberately outside this package and outside the
RLS transaction.

Account deletion uses `v2_users.deletion_fence` as an irreversible-phase
fence. The Workflow atomically claims the exact soft-delete generation before
touching external resources; Clerk upserts can restore an account during the
grace period, but fail while a claimed deletion is running. Manifest creation,
project archival, and the final user delete all require the same fence.
The final delete and every Clerk upsert also share a transaction-scoped advisory
lock derived from the external identity. The delete atomically records only a
SHA-256 identity tombstone before removing the user row, preventing an in-flight
or stale webhook from recreating an identity whose external resources were already
erased. Tombstones are permanent, contain no Clerk ID or user ID, and grant the
Worker only `SELECT` and `INSERT`; retries after a lost delete response are
idempotent.

Project, thread, and message lists use versioned keyset cursors with stable timestamp/id
ordering; invalid or cross-collection cursors fail instead of restarting at page one.
Message traversal starts at the latest page and continues toward older records, while the
gateway reverses each page into chronological rendering order.
Model-context traversal is a separate chronological suffix query: PostgreSQL applies both its
message-count limit and cumulative serialized-row byte limit before returning data through
Hyperdrive, so a malformed or very large historical message cannot create an unbounded Worker
allocation.
Project slugs are allocated without scanning all historical projects, and user-scoped
advisory locks serialize project/thread/run lifecycle mutations. Project deletion stores
requested/completed cleanup timestamps so external workspace cleanup is retriable.
Daytona is the sole durable owner of each per-user workspace; Postgres records only the
current sandbox attachment and immutable project workspace slug. The removed directory-backup
handle was never part of the active restore path.

Agent-run creation persists SHA-256 idempotency-key and request-body identities under a
per-key advisory lock and unique user/key constraint. Confirmed-absent Durable Object starts
are compensated by locking the run row, terminalizing a nonterminal run, and clearing only
the matching thread pointer in the same transaction. Assistant messages have a partial unique
run index; conflict handling compares JSONB in PostgreSQL, so object-key order does not change
replay identity. Account-deletion run and integration identifiers are read in bounded keyset
pages rather than materialized into one Workflow payload.

## Code Checks

```bash
pnpm --filter @cheatcode/db typecheck
```

## Migrations

```bash
pnpm --filter @cheatcode/db db:generate
pnpm tsx scripts/migrate.ts --dry-run
pnpm tsx scripts/migrate.ts --apply --phase=pre-deploy
pnpm tsx scripts/migrate.ts --apply --phase=post-deploy
```

Production releases prepare the immutable Vercel artifact, run
`--phase=pre-deploy`, deploy and verify the exact-SHA Cloudflare backend and
Vercel frontend, then run `--phase=post-deploy`. The default `all` phase is for
read-only planning; mutating both phases in one invocation is intentionally
refused. The migration runner pins the database host/database/role/system ID,
holds the shared database-maintenance advisory lock, verifies raw and Drizzle
history identities, executes the Drizzle journal through that same pinned
session, and refuses contractions until the complete pre-deploy phase is
recorded.

Every raw-ledger row has a required SHA-256 identity. Missing identities,
modified executable migrations, and retired-manifest mismatches all fail closed;
the runner has no checksum repair or adoption mode.

Provision `app_worker` with a unique managed credential before the first
migration. The runner validates that the role already exists, can log in, and
has no elevated database capabilities before it executes any migration SQL;
password creation and rotation never belong in version-controlled operations.

The Composio identity migration is staged: pre-deploy migration `0031` rejects
duplicates and installs the unique provider-ID index required by new Workers;
post-deploy migration `0032` repairs default state and promotes that index to
the table primary key. Do not deploy the new integration upsert before `0031`.

Drizzle migration `0020_user_deletion_fence.sql` is an expand-only pre-deploy
column addition and must land before the fenced lifecycle code.
Drizzle migration `0021_clerk_deletion_tombstone.sql` and pre-deploy security
overlay `0033_clerk_deletion_tombstone_access.sql` must land before Workers that
write or check identity tombstones.
Drizzle migrations `0022_agent_run_idempotency.sql`,
`0023_project_cleanup_and_keyset_indexes.sql`, and
`0024_deletion_pages_and_assistant_message_identity.sql` must land before the matching
gateway, agent, and deletion Workflow code. Post-deploy migration
`0034_remove_superseded_thread_index.sql` removes the narrower prior sidebar index only
after its keyset-ready replacement is live. The output-integrity overlay in `0028`
validates historical rows and protects new writes before deployment; post-deploy
migration `0035_finalize_security_integrity.sql` makes `sha256` physically non-null,
forces security-sensitive RLS, and removes direct audit-log mutation only after the
matching Workers are live.
Drizzle migration `0025_generated_output_expiry_index.sql` adds the partial expiry/id index used by
the daily generated-output cleanup Workflow; it must land before that Workflow is deployed.
Drizzle migration `0026_first_artifact_milestone.sql` adds and backfills the durable
first-artifact timestamp so retention cleanup cannot cause the activation event to fire again.
Drizzle migration `0027_remove_project_backup_scaffolding.sql` records the schema snapshot
contraction without executing destructive SQL before deployment. Post-deploy migration
`0036_remove_project_backup_scaffolding.sql` removes `v2_projects.container_backup` only after
Workers that no longer read or write the obsolete backup handle have been verified.
Drizzle migration `0032_finalize_agent_run_model_attribution.sql` records the required agent-run model
attribution schema without executing its contraction before deployment. After Workers
persist a canonical logical model on every run, raw post-deploy migration
`0041_finalize_agent_run_model_attribution.sql` attributes historical automatic runs and
makes `v2_agent_runs.model_id` physically non-null.

Audit retention uses a resumable detach/archive/purge state machine. Detach and
its recovery manifest commit atomically; R2 objects are content-addressed and
download-verified. The version-1 NDJSON envelope retains event/time/type
evidence but omits user IDs, resource IDs, metadata, IP addresses, and user
agents. A failed upload leaves the full detached table available for the next
run. Database copies may be purged only in a separate run after at least 30
verified days and a typed confirmation; the R2 object is re-verified and is not
deleted.

```bash
pnpm audit:archive -- --dry-run
pnpm audit:archive -- --apply
pnpm audit:archive -- --apply --purge-verified-before-days 30 \
  --confirm-purge DROP_VERIFIED_AUDIT_PARTITIONS
```

`packages/db/src/schema/drizzle.ts` is the Drizzle migration-generation barrel.
It intentionally omits `auditLog`, because `v2_audit_log` is partitioned and owned
by `infra/supabase/migrations/pre/0003_audit_log_partitioned.sql`.

## Env

- Workers pass `env.HYPERDRIVE.connectionString`.
- Migration scripts use `SUPABASE_MIGRATION_URL` through `.env.migrate`, never Worker env.
- Audit archive applies also require `CLOUDFLARE_ACCOUNT_ID`; Wrangler uses its
  authenticated credentials, pinned to that account, for remote R2 operations.
