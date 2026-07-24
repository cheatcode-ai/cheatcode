# @cheatcode/agent-worker

Agent loop Worker with `AgentRun`, its durable `AgentRunWorkflow` owner,
user-scoped `ProjectSandbox`, and the Daytona sandbox adapter.

Each run Durable Object is keyed by run UUID. Each sandbox Durable Object is keyed by a
one-way digest of the internal user UUID, so every project for that user shares one isolated
Daytona computer. Requests must arrive through the gateway path that supplies the internal
user header.

The Worker implements the provider-neutral sandbox and artifact ports from
`@cheatcode/sandbox-contracts`. Daytona control-plane and toolbox details remain
behind `@cheatcode/tools-code` and do not leak into peer tool packages.

Generated artifacts use a crash-consistent Postgres/R2 protocol. Content determines the output
UUID, object key, and SHA-256 metadata. The Worker durably reserves that identity,
revalidates the live run/project ownership graph, and writes R2 with a create-only precondition;
an existing object is accepted only when its size, checksum, and complete custom identity match.
Reservation and pre-write guard each move a two-hour `cleanup_not_before` fence forward; it is a
remote-side-effect grace deadline, not an ownership token. The final database transaction inserts
the public output and removes the intent. Any post-write result other than committed deletes that
exact object before failing. A committed replay under a still-active run atomically renews output
retention before the output can be exposed through a fresh download capability. A terminal replay
can acknowledge only the same unexpired output and never renews it; every committed replay verifies
the exact R2 object again before returning. Terminal run
persistence records upload quiescence only after its execution promise has settled, while deletion
RPCs abort and join the same promise before returning.

Artifact messages persist only the output UUID and presentation metadata. The authenticated
`POST /v1/outputs/:outputId/download-url` path rechecks tenant ownership, retention, and R2
existence before minting a one-hour HMAC capability; the public signed download route is only the
streaming second hop. Expiring capabilities and internal R2 keys are never stored in transcripts or
returned by artifact tools.

User uploads are durable project files rather than prompt text. The authenticated project-file
route accepts one bounded raw file at a time, validates its filename, extension, UTF-8 or binary
signature, and tenant/project write state, then derives deterministic file and version UUIDs from
the project path and content digest. R2 stores immutable bytes under the existing
`user/project/` lifecycle prefix with create-only checksum verification. ProjectSandbox stores the
small current/version namespace records and mirrors the current version to
`/workspace/<workspaceSlug>/uploads/` on the user's persistent Daytona volume before exposing it.
An exact replay is idempotent; uploading new bytes at the same path creates a retained version and
updates the working copy. Project deletion removes the namespace during fenced workspace cleanup
and the existing resource-deletion prefix sweep removes every immutable object. Account deletion
clears both through the existing account state and R2 lifecycle phases.

Run creation validates the gateway payload with the shared `CreateRunSchema` from
`packages/types` before selecting the run-scoped `AgentRun` Durable Object. The
database binds a gateway-hashed idempotency key to the exact body and thread. After the
pending run and thread pointer commit, start delivery is retried and then reconciled through
an ordered run-key presence probe. A present object reconnects its stream (and finalizes a
durable Workflow admission first); only an authoritative empty response fails the nonterminal database run
and clears the matching thread pointer in one transaction. Transport or reconnect ambiguity
leaves the pointer intact for the next idempotent replay. Active-run conflicts use the same
reconciliation path instead of blindly returning a conflict.

Each admitted semantic run has a deterministic chain of Cloudflare Workflow generations. A
generation keeps the Durable Object execution request attached in four-minute ownership epochs,
then checkpoints and renews the same in-memory coroutine. At 20,000 epochs (about 55 days), it
atomically reserves `generation + 1` in the run-keyed Durable Object and creates the deterministic
successor, leaving almost 5,000 steps below Cloudflare's configured 25,000-step platform ceiling.
The successor's first execution atomically promotes its exact generation, input hash, and instance
ID; any late callback from the predecessor becomes a no-op. A pending successor is recovered by
the existing admission alarm if creation was ambiguous. `draining` permits that continuation,
while `closed` fences it. Generations are an operational rollover mechanism, not a run-duration,
step, token, or cost limit.

A persisted execution-start fence makes retries at-most-once: a warm retry joins the exact
promise, while a restart that lost that promise terminalizes the run instead of replaying model
calls, tools, or other non-idempotent external side effects. An alarm-backed lease also
terminalizes an admission or execution whose current Workflow owner stops renewing it.
Before a Worker release, the closed gateway plus draining agent gate requires every retained
`cheatcode-agent-runs` instance to be complete. Errored and terminated instances
remain restartable on their pinned Worker version, so they block deployment until
the exact retained instance has expired or been purged.

Normal chat runs resolve provider credentials from Supabase Vault through `packages/byok`,
pass only the request-scoped transport credential to Mastra, and execute tools against the
project folder inside the user's Daytona sandbox. The product-level logical model ID remains
separate from the provider-local transport provider/model pair: direct and OpenRouter-routed
requests retain the requested logical ID, while included DeepSeek and automatic OpenAI fallback
attempts use their own canonical IDs. AgentRun writes that resolved logical ID to Postgres and
its Durable Object immediately before every stream attempt.

Before model execution, AgentRun loads the newest complete user/assistant transcript suffix
under the caller's Postgres context. PostgreSQL skips an individually oversized logical turn,
then bounds the result to 33 complete turns and 256 KiB of serialized segment records before
they cross Hyperdrive; the Worker coalesces segments only inside that bound, validates every
record with the canonical UI-message schema, and converts it with AI SDK
`convertToModelMessages`. The current run's user message must be last and carry that run ID.
Ephemeral app-builder context is appended only to that current model turn and is never stored.

`AgentRun` is the Durable Object coordination shell rather than the implementation home for
every concern. Its HTTP adapter owns bounded request parsing and route dispatch; the run
lifecycle module owns progress, terminal persistence, and sandbox-lease cleanup; the run-path
module selects general or app-builder execution; and the output component owns replay and
answer segmentation. The Workflow controller owns admission, execution identity, the
at-most-once fence, and ownership leases. The shell retains only Durable Object identity,
cancellation, status, and dependency wiring.

AgentRun keeps one compact exact SQLite shape for run identity, replay parts, and
coordination state. Dormant objects are reconciled transactionally on activation;
target detection checks column order, affinity, nullability, primary keys, and
defaults before accepting a table as current. Every persisted/replayed UI event is
losslessly normalized to at most 64 KiB, and SQLite reads return at most 32 rows and
256 KiB. Each run accepts at most eight concurrent replay/live streams, with a
256 KiB byte-based queue per stream; a slow client is disconnected and resumes from
its persisted sequence cursor instead of growing isolate memory.

Composio actions use the app-level `COMPOSIO_API_KEY`, active rows in
`v2_user_integrations`, and the gateway-owned `QuotaTracker` Durable Object before
executing against a user-connected OAuth account.

ProjectSandbox records elapsed sandbox-hours to the same `QuotaTracker` as a soft
meter so Settings can show real monthly sandbox consumption without blocking
sandbox file/process work.

Postgres is authoritative for user-authored skill metadata and R2 is authoritative
for each versioned skill package. ProjectSandbox mirrors the complete selected
package to `/workspace/.cheatcode/skills/<slug>/` so users can inspect and edit its
instructions, source, schemas, templates, and assets in Files. A hidden mirror
manifest avoids rewriting unchanged packages and limits cleanup to files previously
managed by that package, preserving local dependencies and generated output. Curated
default skills are immutable snapshot files under `/home/node/.cheatcode/default-skills/`.

ProjectSandbox also writes `/workspace/.cheatcode/runtime.json` as an atomic,
generated projection of managed app-preview processes. The Durable Object process
records remain authoritative; the file is only an inspectable runtime manifest.

Managed processes use required stable IDs and a maximum of 32 live metadata slots per user
sandbox. Reusing an ID atomically replaces that slot. At capacity, ProjectSandbox reconciles the
bounded record set against Daytona, removes missing or completed sessions and their port state,
and rejects a new distinct slot only when all 32 remain live.

Each user has one durable Daytona sandbox. Projects are lexically confined to their
folders under `/workspace`, and run leases keep the sandbox active while the agent is
working. Project folders share the sandbox's Unix identity, so this prevents accidental
cross-project access but is not an operating-system security boundary within one user.
Sandbox lookup validates canonical ownership labels before trusting a cached ID; the
physical Daytona name is deliberately not identity because a promoted replacement has a
release-scoped name. A missing/stale Durable Object cache therefore recovers the one
canonical sandbox by labels, while duplicate live canonical matches fail closed. New
sandboxes pin the configured immutable snapshot and mount the environment's shared Daytona
volume at `/workspace` with the user sandbox name as its isolated subpath. Canonical and
candidate checks require the provider's actual mount tuple as well as the matching labels; labels
alone cannot attest durable storage. A noncurrent
sandbox is maintenance-only and cannot serve product work.

Preview URLs carry a 60-second `handoff` capability minted by `@cheatcode/auth`.
The preview-proxy Worker exchanges it for a distinct host-only, HttpOnly
`session` capability capped at 10 minutes in both production and local
development. Local Compose service-binds that same Worker behind
`*.localhost:8787`; the agent has no second proxy implementation. The shared
proxy injects only bounded code-server workbench HTML and pins parent messaging
to the environment's exact app origin; generated-app preview HTML remains
streamed.

AgentRun does not count, persist, bill, or emit model-token or model-cost data,
and it does not apply per-run or daily dollar caps. Provider usage remains an
opaque SDK concern.

AgentRun writes Workers Analytics Engine agent-run metrics on terminal statuses and emits
a first-visible-chunk TTFT performance metric for the analytics watchdog. Run
admission events carry the planned logical model, while stream-attempt/completion events carry
the resolved logical model. A failure before any stream attempt keeps planned attribution instead;
provider-local transport IDs remain structured-log context. R2-backed artifact
persistence also atomically claims the user's durable first-artifact timestamp before emitting the
`first_generated_artifact` activation signal, so later project or account cleanup cannot make it
fire twice.
Terminal database status updates are persisted or durably queued in AgentRun's
SQLite storage; alarms retry transient database failures with bounded exponential delay
until the database accepts the update. A terminal Postgres status is deliberately held
behind the final transcript outbox: the alarm flushes the transcript first and only then
publishes the terminal status. Production drain can therefore treat every nonterminal
Postgres run as the complete set of unfinished transcript/database work. A closed release
gate performs no write but keeps an outstanding active-run/outbox alarm rearmed for a
same-SHA draining recovery.
Final assistant transcript persistence is run-idempotent. The Durable Object pages its
SQLite log into ordered JSONB segments of at most 128 KiB, using its terminal `completed_at`
as every segment's logical timestamp. PostgreSQL publishes a run only when its unique final
segment exists; retries compare each segment's JSONB, final marker, timestamp, and tenant
identity. Oversized structured parts use lossless bounded fragment envelopes rather than
truncation, and there is no transcript-length, step, token, or cost ceiling.
Mastra tool-call chunks also emit `step_started`, `step_completed`,
`tool_invoked`, and `skill_invoked` events when those chunks are present in the
live stream. If the last stream subscriber disconnects while a run is still
running, AgentRun emits `run_abandoned` for the watchdog/funnel trail.

AgentRun also emits `data-plan` and `data-task-status` UI chunks so the web app can
render task progress without polling a separate status endpoint.

Project deletion first fences project/thread mutations, refuses an active run, records a
durable cleanup request, then removes that project's workspace folder. The database marks
cleanup complete only after the Agent service succeeds, so a repeated DELETE retries a
failed cleanup instead of silently leaking storage. Filesystem operations with an exact canonical
path remain concurrent across unrelated projects, but arbitrary code, shell execution, and process
launch always take a non-exclusive global lease because path parsing cannot prove their runtime
filesystem scope. Project cleanup fences and drains that lease, terminates every managed and
same-user untracked sandbox process, and only then removes the folder. Account deletion destroys shared
sandbox state once and removes run Durable Objects in bounded pages. The account cleanup
RPC synchronously fences new sandbox work, drains operations that already started, records
final sandbox usage, clears the user's Daytona volume subpath, and deletes every validated
sandbox. A temporary durable tombstone makes an interrupted cleanup resume behind the same
fence. Once external cleanup succeeds, the configured 2026-07-15 Workers compatibility contract
lets one atomic `deleteAll()` remove that tombstone, owner keys, workspace SQLite schema, and
alarm so the object ceases to occupy storage.

Constructors inspect existing identity and SQLite metadata without materializing an empty store.
An object with no registered owner absorbs late lease/alarm cleanup and rejects every other
operational RPC. Its only creation path first checks the exact user through the signed
`app_agent` database context, then persists the owner and workspace schema. Clerk deletion makes
gateway identity resolution fail immediately; the account Workflow later aborts and joins every
run before sandbox deletion, while the sandbox fence drains RPCs admitted by the current isolate.
After eviction, a deleted or missing Postgres user cannot register the empty object again, so a
late request cannot resurrect Daytona or durable state. Per-project workspace tombstones remain
durable for active accounts in one `STRICT` table whose checks bind each canonical slug to its
project UUID and enforce ordered millisecond timestamps. Every destructive maintenance request uses
the isolated `ccm2` agent-lifecycle capability and the exact `agent.internal` host. Before any
Durable Object or Daytona mutation, the Worker validates the account deletion fence or exact
project/thread soft-delete generation and verifies that every requested run belongs to that
scope. The 30-second signature window is therefore safe to retry and cannot authorize stale or
cross-tenant destruction; no shared key or legacy signature fallback exists.

Workspace and sandbox releases use a separate signed internal RPC. For one exact
release SHA, the closed release gate and an in-memory mutation lease reject concurrent
workspace operations. Preparation stops affected processes, collision-checks and renames
Daytona folders, reconciles process and port state, and records only temporary KV evidence for
the canonical folders that existed. Finalization reloads the already-canonical Postgres
inventory and requires the same physical evidence before snapshot work begins. The release
workflow drains all AgentRuns before this phase, so no stale run can recreate a replaced path.
Generic Durable Object reconciliation deliberately runs first: it contracts the permanent
SQLite schema to the project tombstone table and removes the one-time transition and retired-slug
tables; prepare and finalize do not depend on either table. An owner with no materialized sandbox
state uses only the in-memory maintenance lease plus the temporary evidence key, so successful
reconciliation does not leave an empty SQLite store behind.

Finalization also reconciles the user's existing Daytona sandbox to the exact configured
snapshot. Volume-backed replacements mount the same isolated subpath and compare complete tree
digests. The one-time adoption of a local-disk sandbox creates a deterministic archive and copies
it through durable 8 MiB chunks; there is no total workspace-size cap. A candidate never carries
the canonical label while the source does. After digest verification the source is retired, the
candidate receives the full canonical label set, the Durable Object atomically adopts its exact
ID, and only then is the old sandbox deleted. Every boundary is retryable by the temporary
upgrade phase and deterministic candidate identity. Once final verification succeeds, both the
workspace-transition evidence and snapshot-upgrade state are deleted; an ambiguous response can
therefore retry against the canonical physical state without leaving cutover residue. Account
deletion clears the user's shared-volume subpath before deleting all exact owned sandboxes, so
persistent volume data does not outlive the account.

Production binds `CHEATCODE_RELEASE_GATE` explicitly. `draining` rejects public
run, sandbox, preview, download, and deletion admission while allowing already
admitted AgentRun Workflow/DO callbacks, sandbox operations, and persistence to
finish. `closed` additionally fences those continuation paths and serves only
`/health` plus the exact signed canonical-workspace reconciliation RPC. Stable
drain proofs run at both gates before DDL.

Project ZIP generation and streaming share the exact
`PROJECT_ARCHIVE_MAX_OUTPUT_BYTES` contract from `@cheatcode/types` (640 MiB). The
sandbox deletes an oversized archive before it can be returned, and the Worker enforces
the same bound while streaming.

## Public exports

- `agentApp`
- `AgentRun`
- `AgentRunWorkflow`
- `ProjectSandbox`

## Code Checks

```bash
pnpm --filter @cheatcode/agent-worker typecheck
```

## Env

- `CHEATCODE_ENVIRONMENT` (`production` in committed Wrangler config; local generated config overrides it)
- `CHEATCODE_RELEASE_SHA` (required for production deployments)
- `CHEATCODE_RELEASE_GATE` (`open` in source; coordinated releases inject `draining` and then `closed` until migration/reconciliation complete)
- `CF_VERSION_METADATA`
- `AGENT_RUN`
- `AGENT_RUN_WORKFLOW`
- `PROJECT_SANDBOX`
- `HYPERDRIVE` (dedicated config whose database login is exactly `app_agent`)
- `DATABASE_CONTEXT_SIGNING_SECRET_AGENT` (role-specific Secrets Store binding;
  must match the `app_agent` Supabase Vault HMAC secret)
- `DAYTONA_API_KEY`
- `DAYTONA_API_URL`
- `DAYTONA_TARGET`
- `DAYTONA_SANDBOX_SNAPSHOT`
- `DAYTONA_WORKSPACE_VOLUME` (one shared environment volume; each user mounts only its sandbox-name subpath)
- `PREVIEW_TOKEN_SECRET`
- `COMPOSIO_API_KEY`
- `DEEPSEEK_PLATFORM_API_KEY`
- `OUTPUT_DOWNLOAD_SIGNING_SECRET` (Secrets Store binding)
- `OUTPUT_DOWNLOAD_BASE_URL`
- `WEBHOOKS_TO_AGENT_LIFECYCLE_SECRET` (ccm2 `agent-lifecycle` capability shared
  only with the webhooks caller)
- `RELEASE_DATABASE_READINESS_SECRET` (ccm2 `database-readiness` verifier only)
- `PREVIEW_HOSTNAME`
- `QUOTA_TRACKER`
- `R2_AUDIT`
- `R2_OUTPUTS`
- `SANDBOX_STATE`
- `USER_EVENTS`, `AGENT_METRICS`, `ERROR_EVENTS`, `PERFORMANCE_METRICS`
