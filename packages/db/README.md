# @cheatcode/db

Drizzle schema, queries, and Hyperdrive-aware Postgres client for Cheatcode V2.

## Public exports

- `createDb`
- `withUserContext`
- `assertDatabaseRuntimeReadiness`
- `resolveInternalUserId`
- `isUserAccountActive` for least-privilege fresh durable-state admission
- project/thread/message helpers, including the bounded model-context suffix reader
- run admission, status, and logical-model attribution helpers
- billing entitlement helpers, including `cancel_at_period_end` subscription
  state for Polar cancellation/reactivation
- user-scoped run activity and sandbox-resource usage helpers
- 200-row keyset pages across daily `retention_d7`, `retention_d28`, and
  `first_week_mau` activation cohorts
- lifecycle helpers for RLS-safe BYOK revalidation, invalid-key disablement,
  tier-slot reconciliation, and Clerk deletion workflows
- bounded keyset helpers for object-first generated-output retention cleanup
  including soft-deleted rows
- leased project/thread deletion jobs with bounded continuation, migration fencing, backoff, and
  quarantine
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

BYOK revalidation claims return the current non-secret fingerprint plus an exact
15-minute UUID lease. Plaintext is read only while both still match. A conclusive
validation records `last_revalidated_at` and clears the lease under the normal
provider-mutation lock; invalid-key disablement uses the same fingerprint/lease
compare-and-set. The provider HTTP request therefore runs with no Postgres
transaction or advisory lock held, failed requests do not suppress the key for
23 hours, and replacement/deletion/reclaim races cannot let stale work disable a
newer key. Provider-key reconciliation never resurrects a key disabled by
provider revalidation. The post-migration cleanup clears the retired
`tier_slot_limit` disable reason once; current provider-key mutations have no
subscription-slot policy or tier-based reranking behavior.

Daily activation events are ordered by event kind and user UUID and traversed with
a stable keyset cursor. A page returns at most 200 rows, keeping both Hyperdrive
results and each Analytics Engine emission invocation below Cloudflare's 250-point
limit. Each logical activation event also has a deterministic identity so replayed
Workflow writes can be deduplicated with `count(DISTINCT blob6)` downstream. The
candidate scan uses `v2_users_activation_created_idx`; per-user activity probes use
`v2_agent_runs_user_started_idx`, alongside the separate run-deletion paging index.

`v2_retention_jobs` is the globally scoped orchestration aggregate for one UTC day's activation
and output-cleanup chain. Its release/lease/continuation identity fences every Workflow generation;
phase and both keyset cursors are compared exactly on every progress mutation. Output-row deletion
and cleanup-cursor advancement share one transaction, and external R2 deletion must first renew the
same exact position. The `app_webhooks` role has global maintenance policies but can insert only
`day`/`scheduled_at` and update only the orchestration columns; forced RLS and the production target
contract reject broader access.

`v2_artifact_upload_intents` is the durable half of the Postgres/R2 commit protocol. An AgentRun
reserves a deterministic output/key identity before R2 is touched, then atomically replaces that
intent with `v2_generated_outputs` only after the create-only object write is verified. Terminal
run persistence marks any remaining intents quiesced only after the active execution and artifact
promises have settled. Reservation and the final pre-write guard extend `cleanup_not_before` by two
hours. Daily retention can therefore remove only intents whose immutable terminal run, explicit
quiescence proof, and remote-side-effect grace deadline all precede the day's fixed cutoff. Active
run outputs are excluded from generated-output retention, and an idempotent committed replay for
an active run atomically renews `expires_at` before a fresh download capability can expose it.
An already-terminal replay may acknowledge only the same unexpired committed output and never
renews it, closing the post-commit response-loss window without reviving terminal work.
Postgres makes a terminal run's status and `finished_at` immutable, so maintenance cannot lose its
terminal proof between page selection and exact row deletion.
Composite NO ACTION foreign keys keep a pending intent discoverable and make project, run, or account
finalization fail closed until its object-first cleanup is complete.

Account deletion uses `v2_users.deletion_fence` as an irreversible-phase
fence, `v2_users.deleted_at` as the durable grace deadline, and
`v2_user_deletion_jobs` as the resumable orchestration aggregate. A bounded discovery
RPC registers due generations; a separate maintenance-fenced claim RPC leases queued
or expired jobs and atomically installs the exact epoch-millisecond user fence. Clerk
deletion is terminal when first accepted: the identity advisory lock makes later or
out-of-order sync events return `in_progress`, and replayed delete events retain the original
deletion generation. Short Workflow generations persist the monotonic phase,
provider/keyset progress cursor, continuation, lease, and failure state. Failed instance
creation is deferred transactionally, and cron can reclaim both queued failures and expired
continuations without a total cleanup-page cap.

Run state, the shared sandbox, billing, quota state, integrations, R2 objects and upload intents,
project archival, and finalization execute in that strict order. Every action renews the lease
and revalidates both job identity and deletion generation inside the destructive durable
step; database-only phases keep the check and mutation in one tenant transaction.
`v2_user_deletion_refund_intents` is the durable authority for the only provider-money mutation in
that sequence. Its composite foreign key binds one immutable order/amount/currency/idempotency
identity to the exact job, user, and generation. The `app_webhooks` role can read its own row but
can reserve or record evidence only through lease-, phase-, cursor-, and continuation-fenced
security-definer RPCs. Provider evidence is all-null or complete; provider IDs and idempotency keys
are unique, terminal status cannot regress, and an unresolved partial index supports the phase and
finalization guards. A `BEFORE UPDATE OF phase OR DELETE` trigger rejects leaving `billing` or
removing the job until the recorded Polar status is `succeeded`; the application repeats that
predicate before advance and before final user deletion.
The final delete and every Clerk identity sync also share a transaction-scoped advisory
lock derived from the external identity. The delete atomically records only a
SHA-256 identity tombstone before removing the user row, preventing an in-flight
or stale webhook from recreating an identity whose external resources were already
erased. Tombstones are permanent and contain no Clerk ID or user ID. Runtime
roles have no direct tombstone access; the postgres-owned finalization RPC owns
the advisory lock, tombstone insert, and exact fenced user delete atomically.
Retries after a lost delete response are idempotent.

Clerk identity sync stores the provider's nonnegative millisecond `updated_at` in
`v2_users.clerk_updated_at_ms`. Newer source versions update the canonical email,
display name, and avatar; an equal version is an idempotent no-op and an older version
returns a typed stale outcome with the current row. Deletion remains terminal regardless
of source version.

Project, thread, and message lists use versioned keyset cursors with stable timestamp/segment/id
ordering; invalid or cross-collection cursors fail instead of restarting at page one.
Message traversal starts at the latest page and continues toward older records, while the
gateway reverses each page into chronological rendering order.
Model-context traversal is a separate chronological suffix query: PostgreSQL groups physical
segments by logical run, skips a turn that cannot fit, and applies both its logical-turn count
and cumulative serialized-row byte limits before returning data through Hyperdrive. The Worker
therefore receives complete logical messages only and coalesces within the existing byte bound.
Project workspace slugs use a filesystem-safe display-name base of at most 27 bytes followed
by a hyphen and the project's full UUID. The validated ownership check makes the UUID suffix
mandatory while still allowing project renames without moving an immutable folder. User-scoped
advisory locks serialize project/thread/run lifecycle mutations. Project and thread deletion
use millisecond tombstones consumed by the object-first resource-deletion Workflow. Durable job
rows hold the exact generation, phase, cursor, continuation, lease, and failure state; successful
and stale jobs are removed, while only quarantined failures remain for operator review. Every
destructive action renews the exact resource generation and NULL-safe phase/cursor position;
advancement is a transition-checked compare-and-swap, so stale Workflow steps cannot regress or
act from a prior page. Daytona is the sole durable owner of each per-user workspace; Postgres
records only the immutable project workspace slug.

Agent-run creation persists SHA-256 idempotency-key and request-body identities under a
per-key advisory lock and unique user/key constraint. Confirmed-absent Durable Object starts
are compensated by locking the run row, terminalizing a nonterminal run, and clearing only
the matching thread pointer in the same transaction. Assistant transcripts use ordered,
byte-bounded rows unique by run/segment plus one unique final marker. Incomplete runs remain
invisible; conflict handling compares bounded JSONB in PostgreSQL, so object-key order does not
change replay identity. Account-deletion run and integration identifiers are read in bounded keyset
pages rather than materialized into one Workflow payload.

Permanent database checks mirror those domain transitions: thread launch intent is project-less
and one-shot, active runs require a materialized project, run terminal state and `finished_at` are
equivalent, quota/archive state moves as one pair, Polar subscription identities are globally
unique, and provider fingerprints are exact lowercase 12-hex projections. JSONB columns retain
their object/array containers and canonical logical-model IDs at the database boundary. Message
pagination is indexed by its complete `(created_at, agent_run_segment, id)` cursor, while worked-time
and active-run foreign-key paths have dedicated partial indexes. Generated-output R2 keys bind the
user, project-shaped UUID segment, run, output, and filename; transcript rows restrict run deletion
so their segment identity cannot be silently nulled. Raw post-deploy migration `0057` owns the
closed-gate repair/validation and removes the now-redundant workspace-slug uniqueness index.
It also installs the postgres-owned `ensure_v2_audit_partitions()` maintenance function and one
named daily `pg_cron` job. The function serializes DDL with an advisory lock, maintains only the
current month plus three future partitions, and grants execution to no application or Data API
role. The production target validates the exact function implementation, job owner/schedule/SQL,
and attached current/next partition runway.

## Code Checks

```bash
pnpm --filter @cheatcode/db typecheck
```

## Migrations

```bash
pnpm --filter @cheatcode/db db:generate
pnpm tsx scripts/migrate.ts --dry-run
# Compose-local applies only:
pnpm tsx scripts/migrate.ts --apply --phase=pre-deploy
pnpm tsx scripts/migrate.ts --apply --phase=post-deploy
pnpm tsx scripts/migrate.ts --apply --phase=release-finalization
```

Non-local applies are rejected outside the protected `Production Release`
workflow. Production releases prepare the immutable Vercel artifact, run
`--phase=pre-deploy`, close and reconcile the exact-SHA Cloudflare backend, then
run `--phase=post-deploy` behind that barrier. OPEN promotes the verified Vercel
artifact, deploys the three dedicated-role Workers CLOSED, proves all three
role-specific signed database paths, applies the isolated
`--phase=release-finalization`, proves the exact final database target and all
three paths again, and only then opens writers. The default `all` phase is for
read-only planning; mutating multiple phases in one invocation is intentionally
refused. The migration runner pins the database host/database/role/system ID,
holds the shared database-maintenance advisory lock, verifies raw and Drizzle
history identities, executes the Drizzle journal through that same pinned
session, and refuses contractions until the complete pre-deploy phase is
recorded. Release finalization additionally refuses to start until every
post-deploy contraction is recorded. After taking that shared lock it also refuses to plan or apply DDL
while any durable resource-deletion job remains leased. Foundations, pre-deploy
expansions, post-deploy contractions, and the protected finalization each retain
their own monotonic stream; a completed contraction wave does not prevent a
later release from adding a new expansion wave.

Workspace canonicalization is a cross-system maintenance transition, not an ordinary schema
backfill. No account or project is hard-coded, tombstoned, or deleted to make the transition pass.
During the exact-SHA closed-writer phase, the ops Workflow discovers every active owner and derives
each destination from the current canonical generator. Owner discovery returns compact IDs only;
each durable step reloads the exact owner's project inventory locally so Workflow history never
serializes a multi-owner project page. Bounded keyset generations carry their cursor and cumulative
evidence digest until every owner is complete. The user's
`ProjectSandbox` Durable Object drains and fences workspace operations, stops affected processes,
collision-checks and renames Daytona folders, reconciles durable process/port state, and records
prepare evidence. A maintenance-locked Postgres transaction then compare-and-swaps the complete
owner inventory before the Durable Object verifies and finalizes that same transition. Only after
every owner has produced exact release evidence may migration `0050` validate all remaining rows
and install the canonical ownership check. Neither the Workflow nor migration contains an owner,
project, or workspace mapping.

Pre-deploy migration `0051` installs the durable resource-deletion job table before the new
webhooks Worker is deployed. Job claims remain fail-closed until generated outputs all have run
ownership, `0050` has validated the canonical workspace contract, and the shared database
maintenance advisory lock is available. This lets staged jobs exist safely across the release
barrier without racing post-deploy DDL or cascading ownerless output rows.

The protected OPEN release creates and verifies an encrypted pre-contraction
backup before it may run any post-deploy migration. The archive contains a
custom-format dump of the `drizzle`, `public`, and `vault` schemas, an explicit
Vault plaintext export inside that encrypted envelope, database identity
evidence, and file checksums. The gate decrypts the artifact, verifies all
checksums, and makes `pg_restore` parse the entire dump. The encryption key stays
in the protected GitHub environment and is never available to a Worker.

Post-deploy migration `0052` contracts generated-output identity to the object key in the single
`cheatcode-outputs` R2 bucket and removes the write-only billing-event diagnostic table. Polar
webhook acceptance, replay, and idempotency remain authoritative in `WebhookIdempotencyStore`;
current customer state and entitlements remain authoritative in Polar and `v2_entitlements`.

Every raw-ledger row has a required SHA-256 identity. Missing identities,
modified executable migrations, and retired-manifest mismatches all fail closed;
the runner has no checksum repair or adoption mode.

Raw migration `0046` is the only member of the protected
`release-finalization` stream and is additionally guarded by an external-cleanup
attestation whenever `public.projects` still exists. The JSON envelope is supplied
through the production-only `CHEATCODE_MIGRATION_ATTESTATIONS` secret under the
`v1-external-cleanup` key. Its exact payload binds the current database name and
system identifier, the live full-row V1 project inventory count/SHA-256, and the
current, unchanged `0046` file SHA-256. Daytona and Vercel proofs must each be
`verified-clean`, cover exactly 297 and 9 referenced resources respectively,
report zero remaining references, identify an immutable evidence artifact and its
nonzero SHA-256, and have been checked within seven days. The envelope must expire
within seven days. The runner validates this contract before planning or applying
release-finalization plan and passes the verified payload through transaction-local
Postgres settings; `0046` independently revalidates it before dropping anything.
Fresh V2-only databases bypass the one-time proof because they have no V1 project
inventory. Remove the protected secret after `0046` is recorded in the raw ledger.
The protected value has this envelope shape (replace every placeholder from the
reviewed database/provider evidence; do not commit the completed payload):

```json
{
  "v1-external-cleanup": {
    "schemaVersion": 1,
    "scope": "v1-external-cleanup",
    "migration": "infra/supabase/migrations/post/0046_remove_v1_database_surface.sql",
    "migrationSha256": "<current-file-sha256>",
    "database": {
      "name": "<database-name>",
      "systemIdentifier": "<postgres-system-identifier>"
    },
    "inventory": { "count": 300, "sha256": "<live-v1-project-inventory-sha256>" },
    "providers": {
      "daytona": {
        "status": "verified-clean",
        "checkedAt": "<iso-utc-with-milliseconds>",
        "referencedResourceCount": 297,
        "remainingResourceCount": 0,
        "evidenceReference": "<immutable-evidence-reference>",
        "evidenceSha256": "<evidence-sha256>"
      },
      "vercel": {
        "status": "verified-clean",
        "checkedAt": "<iso-utc-with-milliseconds>",
        "referencedResourceCount": 9,
        "remainingResourceCount": 0,
        "evidenceReference": "<immutable-evidence-reference>",
        "evidenceSha256": "<evidence-sha256>"
      }
    },
    "expiresAt": "<iso-utc-with-milliseconds>"
  }
}
```

Provision `app_gateway`, `app_agent`, and `app_webhooks` with three distinct managed credentials
before creating their matching production Hyperdrives. The production target validates their exact
table-operation, read/update-column, function, schema, database, role-attribute, membership,
default-ACL, and RLS-policy matrix. Full-table reads remain only where aggregate callers consume the
whole record; partial callers receive exact column-level `SELECT`. All three are `LOGIN`, `NOINHERIT`,
`NOBYPASSRLS`, and free of elevated capabilities. The historical `app_worker` identity remains
`NOLOGIN` only during the staged transition and is dropped by post-deploy finalization. Production
readiness fails if that role still exists. Password creation and rotation never belong in
version-controlled operations.

The Agent role's exact `v2_users` read projection includes `deletion_fence` because
account/run Durable Object cleanup must compare the signed lifecycle request with the
current irreversible deletion generation. It receives no broader user-row access.

Every tenant-owned V2 table has forced RLS. `createDb` requires the Worker's exact
database audience and role-specific signing binding; `withUserContext` resolves that
binding request-locally, signs the audience, canonical user UUID, epoch-millisecond issue
time, and random nonce, and installs the tuple with transaction-local settings. The
postgres-owned `current_app_user()` function selects the exact Vault key for
`session_user`, enforces a 15-second past/2-second future freshness window, and compares
the HMAC in fixed work before any tenant policy can resolve. `SET LOCAL` clears the tuple
at transaction end. The nonce provides per-request domain separation rather than a
database replay ledger, so a fully disclosed tuple is valid only inside that short
freshness window; signed tuples never cross the Worker/database boundary or enter logs.

The three Cloudflare Secrets Store bindings must hold values identical to their matching
Supabase Vault entries, with no shared fallback:

- `DATABASE_CONTEXT_SIGNING_SECRET_GATEWAY` ↔
  `cheatcode-database-context-app-gateway-v1`
- `DATABASE_CONTEXT_SIGNING_SECRET_AGENT` ↔
  `cheatcode-database-context-app-agent-v1`
- `DATABASE_CONTEXT_SIGNING_SECRET_WEBHOOKS` ↔
  `cheatcode-database-context-app-webhooks-v1`

Each value is distinct and at least 32 bytes. Fleet maintenance crosses tenants only
through postgres-owned, bounded, role-specific RPCs; runtime roles cannot directly read
the tombstone or audit surfaces. Pre-deploy migration `0060` installs those bounded RPCs
and rejects missing/misdescribed Vault keys. Post-deploy migration `0061` installs the
signed verifier, forces RLS, removes prior policies, and regrants the exact final role
matrix. The closed-release database-readiness probe signs a fixed non-tenant sentinel and
verifies both `current_app_user()` and `session_user`; it reads or mutates no tenant row.

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
Drizzle migration `0040_tiresome_jack_murdock.sql` adds the bounded account-deletion
due index. Drizzle migration `0041_great_adam_warlock.sql` adds the durable deletion-job
aggregate. Pre-deploy overlay `0062_user_deletion_jobs.sql` installs its least-privilege
RLS and bounded discovery/claim RPCs; post-deploy `0063_remove_legacy_user_deletion_admission.sql`
removes the superseded due-page RPC and restores only the reviewed steady-state grants
after the global role contraction. Post-deploy `0065_enforce_terminal_clerk_deletion.sql`
makes the first accepted Clerk deletion and its generation irreversible to delayed sync or
replayed delete events.
Drizzle migration `0043_third_sleeper.sql` adds the bounded Clerk source-version column and
widens user-deletion generations from millisecond to microsecond timestamp precision without
changing their epoch-millisecond external fence. Post-deploy `0066_enforce_monotonic_clerk_identity_sync.sql`
removes the temporary backfill default, drops the superseded four-argument sync function,
installs the version-aware function, and makes database fence derivation truncate exactly like
JavaScript `Date` rather than round sub-millisecond timestamps.
Drizzle migration `0027_remove_project_backup_scaffolding.sql` records the schema snapshot
contraction without executing destructive SQL before deployment. Post-deploy migration
`0036_remove_project_backup_scaffolding.sql` removes `v2_projects.container_backup` only after
Workers that no longer read or write the obsolete backup handle have been verified.
Drizzle migration `0032_finalize_agent_run_model_attribution.sql` records the required agent-run model
attribution schema without executing its contraction before deployment. After Workers
persist a canonical logical model on every run, raw post-deploy migration
`0041_finalize_agent_run_model_attribution.sql` attributes historical automatic runs and
makes `v2_agent_runs.model_id` physically non-null.
Drizzle migration `0034_broken_nighthawk.sql` adds the bounded assistant-segment columns,
indexes, and integrity checks after refusing any historical row above the database unit bound.
It deliberately retains the former one-row-per-run index for old-Worker rollout safety. With
the gateway closed and AgentRuns drained, post-deploy migration
`0053_finalize_assistant_transcript_segments.sql` locks run/message writes and removes that old
index. Until the contraction lands, multi-segment finalization remains hidden and durably retries.
Drizzle migration `0038_pretty_nocturne.sql` adds the exact user/assistant role check without
scanning historical rows; post-deploy migration `0055_finalize_message_roles.sql` removes obsolete
experimental-role rows and validates it. Post-deploy migration
`0056_remove_unused_llamaparse_provider.sql` deletes the unused provider and its owned Vault secret,
reranks tier-slot state for affected users without clearing provider-invalid disables, and contracts
both the provider table check and Vault write RPC to the seven live providers.

Audit retention uses a resumable detach/archive/purge state machine. Daily database-owned
partition creation is deliberately separate from archival and does not grant DDL to a Worker.
Detach and
its recovery manifest commit atomically; R2 objects are content-addressed and
download-verified. The version-1 NDJSON envelope retains event/time/type
evidence but omits user IDs, resource IDs, metadata, IP addresses, and user
agents. A failed upload leaves the full detached table available for the next
run. Database copies may be purged only in a separate run after at least 30
verified days and a typed confirmation; the R2 object is re-verified and is not
deleted.

Production archive planning and apply run only through the protected manual
`Audit Archive` workflow. Select `dry-run` with `PLAN_AUDIT_ARCHIVE`, or `apply`
with `APPLY_AUDIT_ARCHIVE`. Purge additionally requires
`DROP_VERIFIED_AUDIT_PARTITIONS`. A local Compose database may run the command in
dry-run mode only; laptop apply and all non-workflow production access are
rejected.

`packages/db/src/schema/drizzle.ts` is the Drizzle migration-generation barrel.
It intentionally omits `auditLog`, because `v2_audit_log` is partitioned and owned
by `infra/supabase/migrations/pre/0003_audit_log_partitioned.sql`.

## Env

- Workers pass `env.HYPERDRIVE.connectionString`.
- Each database-backed Worker passes only its matching
  `DATABASE_CONTEXT_SIGNING_SECRET_GATEWAY`,
  `DATABASE_CONTEXT_SIGNING_SECRET_AGENT`, or
  `DATABASE_CONTEXT_SIGNING_SECRET_WEBHOOKS` binding to `createDb`.
- Migration scripts read `SUPABASE_MIGRATION_URL` from root `.env.local` in
  Compose or protected process environment variables in production. Wrangler's
  generated local configs do not bind it into a Worker.
- Audit archive production operations receive `CLOUDFLARE_ACCOUNT_ID` and the
  protected `AUDIT_ARCHIVE_CLOUDFLARE_API_TOKEN`. Scope that token only to
  `Workers R2 Storage Bucket Item Write` on the `cheatcode-audit` bucket; it is
  exposed to Wrangler as `CLOUDFLARE_API_TOKEN` only inside the workflow job.
