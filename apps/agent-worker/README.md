# @cheatcode/agent-worker

Agent loop Worker with `AgentRun`, its durable `AgentRunWorkflow` owner,
user-scoped `ProjectSandbox`, agent-owned `QuotaTracker`, and the Daytona
sandbox adapter.

Each run Durable Object is keyed by run UUID. Each sandbox Durable Object is keyed by a
one-way digest of the internal user UUID, so every project for that user shares one isolated
Daytona computer. Requests must arrive through the gateway path that supplies the internal
user header.

The Worker implements the provider-neutral sandbox and artifact ports from
`@cheatcode/sandbox-contracts`. Daytona control-plane and toolbox details remain
behind `@cheatcode/agent-core/tools/code` and do not load the root Mastra surface.

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
persistence records upload quiescence only after the Workflow-owned tool steps have settled, while
deletion RPCs terminate the run's Workflow before removing its durable state.

Artifact messages persist only the output UUID and presentation metadata. The authenticated
`POST /v1/outputs/:outputId/download-url` path rechecks tenant ownership, retention, and R2
existence before minting a one-hour HMAC capability; the public signed download route is only the
streaming second hop. Expiring capabilities and internal R2 keys are never stored in transcripts or
returned by artifact tools.

The project file catalog merges uploaded-file metadata with the newest durable generated-output
records without starting Daytona. Generated entries use an ID-backed
`deliverables/<output-id>/<filename>` path, so duplicate names remain unambiguous. When a user
actually references one, the run rechecks user/project ownership, validates the R2 object's exact
identity and checksum metadata, and restores only that output to its deterministic workspace path
before model execution. Opening the slash menu therefore stays cheap, while old Deliverables remain
usable after sandbox idle stops or workspace-file loss.

User uploads are durable project files rather than prompt text. The authenticated project-file
route accepts one bounded raw file at a time, validates its filename, extension, UTF-8 or binary
signature, and tenant/project write state, then derives deterministic file and version UUIDs from
the project path and content digest. R2 stores immutable bytes under the existing
`user/project/` lifecycle prefix with create-only checksum verification. ProjectSandbox stores the
small current/version namespace records and mirrors the current version to
`/workspace/<workspaceSlug>/uploads/` on the user's persistent Daytona volume before exposing it.
An exact replay is idempotent; uploading new bytes at the same path creates a retained version and
updates the working copy. First-run app scaffolding preserves the `uploads/` directory, and restored
template projects reuse immutable snapshot runtimes or restore project-specific dependencies to the
sandbox's local disk instead of copying generated package trees to persistent object-store FUSE.
The working copy is a reserved cache: every project-bound run
verifies its current file set before model access, restores missing, replaced, or modified files from
the checksum-verified R2 version, records the exact workspace materialization separately from the
immutable user-facing file metadata, and repeats that repair when the run exits. File write/delete
tools reject the reserved directory, while the system contract requires shell work to copy an upload
elsewhere before transforming it. The mounted Daytona volume does not provide a portable
ownership/mode boundary, so application guards and R2 repair—not advisory FUSE permissions—enforce
the contract. Template scaffolding and repository imports both retain the reserved directory.
Project deletion removes the namespace during fenced workspace cleanup and the existing
resource-deletion prefix sweep removes every immutable object. Account deletion clears both through
the existing account state and R2 lifecycle phases.

Run creation validates the gateway payload with the shared `CreateRunSchema` from
`packages/types` before selecting the run-scoped `AgentRun` Durable Object. The
database binds a gateway-hashed idempotency key to the exact body and thread. After the
pending run and thread pointer commit, start delivery is retried and then reconciled through
an ordered run-key presence probe. A present object reconnects its stream (and finalizes a
durable Workflow admission first); only an authoritative empty response fails the nonterminal database run
and clears the matching thread pointer in one transaction. Transport or reconnect ambiguity
leaves the pointer intact for the next idempotent replay. Active-run conflicts use the same
reconciliation path instead of blindly returning a conflict.

Each admitted semantic run has one deterministic Cloudflare Workflow instance. The Workflow owns
the agent loop and checkpoints preparation, every model turn, every tool invocation, transcript
publication, completion, and cleanup as separate steps. Its state contains only validated JSON;
provider keys and sandbox capabilities are reacquired inside the active step and never enter
Workflow storage. A Worker isolate or Durable Object eviction therefore resumes from the last
completed step instead of losing an in-memory coroutine. Transcript publication uses deterministic
event keys and an atomic SQLite receipt, so Workflow step replay cannot duplicate visible parts.
There is no application step, token, duration, or cost ceiling; semantic completion ends the loop,
while per-operation timeouts and the platform Workflow limit remain operational safeguards.
The Worker pins Cloudflare's paid-plan maximum subrequest allowance because external provider,
Daytona, Hyperdrive, R2, and Durable Object requests share one Workflow-instance budget. That
platform transport budget must accommodate the configured 25,000 durable steps rather than become
an earlier, workload-dependent product limit.
Successful deep-research tools are terminal response producers: the Workflow suppresses the model's
pre-tool narration, publishes the tool's validated canonical Markdown directly as the assistant text,
and completes without asking a second model turn to copy or summarize it. The same Markdown is the
input to the PDF renderer, so chat and deliverable content cannot diverge by model behavior.

The run-keyed Durable Object is the authoritative status, cancellation, transcript, and stream
store. It validates every Workflow callback against the stored input hash and deterministic
instance ID, and late callbacks become terminal no-ops. Admission ambiguity is recovered by the
existing alarm. Cancellation terminates the Workflow before committing terminal state. Before a
Worker release, the closed gateway plus draining agent gate requires every retained
`cheatcode-agent-runs` instance to be complete. Workflow retries resume individual model and tool
steps from their durable checkpoints. An exhausted or externally terminated instance is never
blindly restarted from the beginning because doing so could repeat an external tool side effect;
the run object reconciles that terminal mismatch into a visible, retryable failure instead.

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

`AgentRun` is the Durable Object coordination shell rather than the implementation home for every
concern. Its HTTP adapter owns bounded request parsing and route dispatch; the Workflow runtime
owns model/tool step preparation and sandbox-lease cleanup; the app-builder path owns scaffold and
preview setup; and the output component owns idempotent transcript publication plus resumable
streams. The Workflow controller owns admission, callback identity, and cancellation. The shell
retains only durable run identity, status, transcript, cancellation, and dependency wiring.

An explicit app-builder mode remains authoritative. In a projectless chat, a narrowly
matched imperative such as “build a website,” “create a pomodoro app,” or “create a mobile app”
also enters the matching app-builder path before model execution. A generic app defaults to the
web path unless the request carries an explicit mobile or non-web runtime signal. That
high-confidence fallback materializes the project, scaffolds its canonical workspace, and
registers the managed preview even when the selected model would otherwise attempt generic shell
work and finish without a Computer target.
The starter page is an internal server-readiness target, not user-facing generated content. A
fresh template run emits the typed `app-preview-status` transition from `building` to `ready` only
after model execution (and the mobile preview restart, when applicable), so the web client can keep
the branded loading surface over the scaffold without relying on timers or iframe inspection.
The canonical app source remains on the durable `/workspace` volume. Managed Next.js previews
compile from a sandbox-local one-way mirror because Daytona's object-store FUSE mount can stall
webpack compilation even after the listening socket opens. A baked Python synchronizer performs a
full refresh on every process start and mirrors subsequent writes and deletions within one second,
including shell-based edits. The local source, dependency tree, and build cache are disposable;
wake and restart reconstruct them from the durable project without changing the Files surface.

AgentRun keeps one compact exact SQLite shape for run identity, replay parts, and
coordination state. Dormant objects are reconciled transactionally on activation;
target detection checks column order, affinity, nullability, primary keys, and
defaults before accepting a table as current. Every persisted/replayed UI event is
losslessly normalized to at most 64 KiB, and SQLite reads return at most 32 rows and
256 KiB. Each run accepts at most eight concurrent replay/live streams, with a
256 KiB byte-based queue per stream; a slow client is disconnected and resumes from
its persisted sequence cursor instead of growing isolate memory.

Composio actions use the app-level `COMPOSIO_API_KEY`, active rows in
`v2_user_integrations`, and the local agent-owned `QuotaTracker` Durable Object
before executing against a user-connected OAuth account.

ProjectSandbox records elapsed sandbox-hours to the same `QuotaTracker` as a soft
meter so Settings can show real monthly sandbox consumption without blocking
sandbox file/process work.

Agent code reaches `QuotaTracker` through its local namespace. External quota
access is split across named, property-validated WorkerEntrypoints:
`GatewayQuotaEntrypoint` exposes only `peek`, `history`, and `setLimit` to the
gateway, while `QuotaDeletionEntrypoint` exposes only `deleteAllState` to the
webhooks account-deletion workflow. The Durable Object shell composes
`@cheatcode/billing/quota-runtime`, which owns RPC input validation, SQLite
storage, retention, and alarm behavior.

Postgres is authoritative for user-authored skill metadata and R2 is authoritative
for each versioned skill package. ProjectSandbox mirrors the complete selected
package to `/workspace/.cheatcode/skills/<slug>/` so users can inspect and edit its
instructions, source, schemas, templates, and assets in Files. A hidden mirror
manifest avoids rewriting unchanged packages and limits cleanup to files previously
managed by that package, preserving local dependencies and generated output. Curated
default skills are immutable snapshot files under `/home/node/.cheatcode/default-skills/`.
Agent-worker owns the custom-skill capacity decision and applies it inside the database's
per-user locked catalog transaction before inserting a new skill.

Managed processes use required stable IDs and a maximum of 32 live metadata slots per user
sandbox. Reusing an ID atomically replaces that slot. At capacity, ProjectSandbox reconciles the
bounded record set against Daytona, removes missing or completed sessions and their port state,
and rejects a new distinct slot only when all 32 remain live.
App-preview identity and port allocation derive from the canonical project workspace root, while
the launch command may run in any descendant folder. Nested app layouts therefore retain the same
project-scoped wake, console, cleanup, and restart identity after Daytona idle-stops the sandbox.

Each user has one durable Daytona sandbox. Projects are lexically confined to their
folders under `/workspace`, and run leases keep the sandbox active while the agent is
working. Project folders share the sandbox's Unix identity, so this prevents accidental
cross-project access but is not an operating-system security boundary within one user.
The validated `runCode` source contract remains separate from the smaller public `exec`
argv contract: the Worker base64-chunks source into bounded, reserved request environment
variables and pipes it to the selected interpreter over stdin. Large code therefore does
not exceed an argv element limit or leave a temporary source file on the persistent volume.
Sandbox lookup validates canonical ownership labels before trusting a cached Daytona
resource ID. A missing/stale Durable Object cache therefore recovers the one canonical
sandbox by labels, while duplicate live canonical matches fail closed. New sandboxes pin
the configured immutable snapshot and mount the environment's shared Daytona volume at
`/workspace` with the user sandbox name as its isolated subpath. Canonical and candidate
checks require the provider's actual mount tuple as well as the matching labels; labels
alone cannot attest durable storage. When the configured snapshot or target changes, the
first operation after active work drains replaces only the stale container and remounts
that same volume subpath. New operations are fenced during replacement, stale process
projections are cleared, and project files plus user-installed skills remain durable.
Identity, snapshot-label, or storage-mount ambiguity still fails closed.

Preview URLs carry a 60-second `handoff` capability minted by `@cheatcode/auth`.
The preview-proxy Worker exchanges it for a distinct host-only, HttpOnly
`session` capability capped at 10 minutes in both production and local
development. Local Compose service-binds that same Worker behind
`*.localhost:8787`; the agent has no second proxy implementation. The shared
proxy injects only bounded code-server workbench HTML and pins parent messaging
to the environment's exact app origin; generated-app preview HTML remains
streamed.

Opening Files starts code-server directly against the requested workspace. It does not recursively
enumerate the project first, so dependency trees and large generated projects are outside the cold
start critical path. After an idle stop, a current tracked code-server session is relaunched from its
durable command instead of repeating installation and cleanup probes. A project with no tracked
app-preview record returns the terminal `none` state without starting Daytona or entering the
preview wake polling loop. Files URLs include the Worker release SHA so code-server's service worker
cannot reuse a workbench document containing an older injected parent bridge after a deployment.

AgentRun does not count, persist, bill, or emit model-token or model-cost data,
and it does not apply per-run or daily dollar caps. Provider usage remains an
opaque SDK concern.

AgentRun writes Workers Analytics Engine agent-run metrics on terminal statuses and emits
a first-visible-chunk TTFT performance metric. Run
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
Checkpointed tool steps emit `step_started`, `step_completed`, `tool_invoked`, and
`skill_invoked` events independently of the live stream. If the last stream subscriber disconnects while a run is still
running, AgentRun emits `run_abandoned` for the funnel trail.

Project deletion first fences project/thread mutations, refuses an active run, records a
durable cleanup request, then removes that project's workspace folder. The database marks
cleanup complete only after the Agent service succeeds, so a repeated DELETE retries a
failed cleanup instead of silently leaking storage. Filesystem operations with an exact canonical
path remain concurrent across unrelated projects, but arbitrary code, shell execution, and process
launch always take a non-exclusive global lease because path parsing cannot prove their runtime
filesystem scope. Project cleanup fences and drains that lease, terminates every managed and
same-user untracked sandbox process, and only then removes the folder. Account
deletion destroys shared sandbox state once and removes run Durable Objects in
bounded pages. The account cleanup RPC synchronously fences new sandbox work,
drains operations that already started, records final sandbox usage, clears the
user's Daytona volume subpath, and deletes every validated sandbox. A temporary
durable tombstone makes an interrupted cleanup resume behind the same fence.
Once external cleanup succeeds, one atomic `deleteAll()` removes the tombstone,
owner keys, workspace SQLite schema, and alarm so the object ceases to occupy
storage.

Constructors inspect existing identity and SQLite metadata without materializing an empty store.
An object with no registered owner absorbs late lease/alarm cleanup and rejects every other
operational RPC. Its only creation path first checks the exact user through the signed
`app_agent` database context, then persists the owner and workspace schema. Clerk deletion makes
gateway identity resolution fail immediately; the account Workflow later aborts and joins every
run before sandbox deletion, while the sandbox fence drains RPCs admitted by the current isolate.
After eviction, a deleted or missing Postgres user cannot register the empty object again, so a
late request cannot resurrect Daytona or durable state. Per-project workspace tombstones remain
durable for active accounts in one `STRICT` table whose checks bind each canonical slug to its
project UUID and enforce ordered millisecond timestamps. Before any Durable
Object or Daytona mutation, the Worker validates the account deletion fence or
exact project/thread soft-delete generation and verifies that every requested
run belongs to that scope. The operation is not an HTTP route: webhooks holds the
named `AgentLifecycleEntrypoint` Service Binding, and Cloudflare-authenticated
binding properties pin the `webhooks` caller and `agent-lifecycle` capability.
The gateway's default agent binding cannot invoke this entrypoint, and no shared
application secret is required.

Every ProjectSandbox uses the one configured immutable Daytona snapshot and the
one configured shared workspace volume. Existing sandbox identity is accepted
only when its owner, canonical labels, snapshot, volume, and mount contract all
match. A stale snapshot or target is replaced automatically only when canonical
ownership and the persistent mount are unambiguous and no other operation or run
lease is active. All other contract mismatches fail closed. New and replacement
sandboxes mount the user's isolated volume subpath directly at `/workspace`.
Generated dependency and compiler-cache state lives under the matching project-scoped
`/home/node/.cheatcode/projects/<workspaceSlug>/` directory and is deleted with the project.
Account deletion clears that subpath before deleting all exactly owned sandboxes,
so persistent volume data does not outlive the account.

Production deploys bind one immutable `CHEATCODE_RELEASE_SHA`. Health responses
expose that identity so the deployment workflow can verify that service
bindings converge on the same reviewed revision. Database migrations retain
their independent target, role, lock, and schema validation.

Project ZIP generation and streaming share the exact
`PROJECT_ARCHIVE_MAX_OUTPUT_BYTES` contract from `@cheatcode/types` (640 MiB). The
sandbox deletes an oversized archive before it can be returned, and the Worker enforces
the same bound while streaming.

## Public exports

- `agentApp`
- `AgentLifecycleEntrypoint`
- `AgentRun`
- `AgentRunWorkflow`
- `GatewayQuotaEntrypoint`
- `ProjectSandbox`
- `QuotaDeletionEntrypoint`
- `QuotaTracker`

## Code Checks

```bash
pnpm --filter @cheatcode/agent-worker typecheck
```

## Env

- `CHEATCODE_ENVIRONMENT` (`production` in committed Wrangler config; local generated config overrides it)
- `CHEATCODE_RELEASE_SHA` (required for production deployments)
- `CF_VERSION_METADATA`
- `AGENT_RUN`
- `AGENT_RUN_WORKFLOW`
- `PROJECT_SANDBOX`
- `HYPERDRIVE` (dedicated config whose database login is exactly `app_agent`)
- `DATABASE_CONTEXT_SIGNING_SECRET_AGENT` (role-specific Secrets Store binding;
  must match the `app_agent` Supabase Vault HMAC secret)
- `DAYTONA_API_KEY`
- `DAYTONA_API_URL`
- `DAYTONA_TARGET` (development override; defaults to `us`)
- `DAYTONA_SANDBOX_SNAPSHOT`
- `DAYTONA_WORKSPACE_VOLUME` (one shared environment volume; each user mounts only its sandbox-name subpath)
- `PREVIEW_TOKEN_SECRET`
- `COMPOSIO_API_KEY`
- `DEEPSEEK_PLATFORM_API_KEY`
- `OUTPUT_DOWNLOAD_SIGNING_SECRET` (Secrets Store binding)
- `OUTPUT_DOWNLOAD_BASE_URL` (development override; production defaults to the gateway origin)
- `PREVIEW_HOSTNAME` (development override; production derives the canonical app hostname)
- `QUOTA_TRACKER` (local agent-owned Durable Object namespace)
- `R2_AUDIT`
- `R2_OUTPUTS`
- `SANDBOX_STATE`
- `USER_EVENTS`, `AGENT_METRICS`, `ERROR_EVENTS`, `PERFORMANCE_METRICS`

Sandbox skills call the fixed public
`https://gateway.trycheatcode.com/skill-runtime` surface. The tenant-scoped
`v2_agent_runs` row stores only digests for independently scoped 15-minute
opaque capabilities, allowing local and production Workers to authorize the
same sandbox callback safely. The agent rotates the projected sandbox
configuration every 10 minutes and clears every capability at the terminal run
transition. No deployment-wide skill-runtime signing secret or configurable
backend URL exists.
