# @cheatcode/agent-worker

Agent loop Worker with `AgentRun`, user-scoped `ProjectSandbox`, and the Daytona
sandbox adapter.

Each run Durable Object is keyed by run UUID. Each sandbox Durable Object is keyed by a
one-way digest of the internal user UUID, so every project for that user shares one isolated
Daytona computer. Requests must arrive through the gateway path that supplies the internal
user header.

The Worker implements the provider-neutral sandbox and artifact ports from
`@cheatcode/sandbox-contracts`. Daytona control-plane and toolbox details remain
behind `@cheatcode/tools-code` and do not leak into peer tool packages.

Run creation validates the gateway payload with the shared `CreateRunSchema` from
`packages/types` before selecting the user-scoped `AgentRun` Durable Object. The
database binds a gateway-hashed idempotency key to the exact body and thread. After the
pending run and thread pointer commit, start delivery is retried and then reconciled through
an ordered run-key presence probe. A present object reconnects its stream (and finalizes a
detached run first); only an authoritative empty response fails the nonterminal database run
and clears the matching thread pointer in one transaction. Transport or reconnect ambiguity
leaves the pointer intact for the next idempotent replay. Active-run conflicts use the same
reconciliation path instead of blindly returning a conflict.

There is no periodic stale-pending scheduler. A Worker termination after the database commit
but before the first Durable Object dispatch is repaired by the next idempotent replay or
active-run attempt; adding time-based repair requires a separately owned durable scheduler.

Normal chat runs resolve provider credentials from Supabase Vault through `packages/byok`,
pass only the request-scoped transport credential to Mastra, and execute tools against the
project folder inside the user's Daytona sandbox. The product-level logical model ID remains
separate from the provider-local transport provider/model pair: direct and OpenRouter-routed
requests retain the requested logical ID, while included DeepSeek and approved OpenAI fallback
attempts use their own canonical IDs. AgentRun writes that resolved logical ID to Postgres and
its Durable Object immediately before every stream attempt.

Before model execution, AgentRun loads the newest complete user/assistant transcript suffix
under the caller's Postgres context. PostgreSQL bounds the result to 33 persisted messages and
256 KiB of serialized records before they cross Hyperdrive; the Worker then validates every
record with the canonical UI-message schema and converts it with AI SDK
`convertToModelMessages`. The current run's user message must be last and carry that run ID.
Ephemeral app-builder context is appended only to that current model turn and is never stored.

`AgentRun` is the Durable Object coordination shell rather than the implementation home for
every concern. Its HTTP adapter owns bounded request parsing and route dispatch; the run
lifecycle module owns progress, terminal persistence, and sandbox-lease cleanup; the run-path
module selects general or app-builder execution; and the output component owns replay and
answer segmentation. The shell retains only Durable Object identity, cancellation, approvals,
status, and dependency wiring.

Composio actions use the app-level `COMPOSIO_API_KEY`, active rows in
`v2_user_integrations`, and the gateway-owned `QuotaTracker` Durable Object before
executing against a user-connected OAuth account.

ProjectSandbox records elapsed sandbox-hours to the same `QuotaTracker` as a soft
meter so Settings can show real monthly sandbox consumption without blocking
sandbox file/process work.

Each user has one durable Daytona sandbox. Projects are lexically confined to their
folders under `/workspace`, and run leases keep the sandbox active while the agent is
working. Project folders share the sandbox's Unix identity, so this prevents accidental
cross-project access but is not an operating-system security boundary within one user.
Sandbox lookup validates the Daytona name and ownership labels before trusting a cached
ID. A duplicate live label match fails closed for operator reconciliation instead of
deleting an arbitrary sandbox, and snapshot drift is emitted as structured operational
telemetry while an existing data-bearing sandbox remains usable. Newly created sandboxes
also carry their immutable snapshot name as a label. Destruction resolves that same
validated identity and deletes only the exact Daytona ID; name-based multi-delete cleanup
is deliberately forbidden.

Preview URLs carry a 60-second `handoff` capability minted by `@cheatcode/auth`.
Both the production preview Worker and local preview path exchange it for a
distinct host-only, HttpOnly `session` capability capped at 10 minutes. Local
preview does not accept legacy tokens, referrer-carried credentials, or implicit
child credentials.

The local code-server preview path shares its parent-frame bridge with the
production preview proxy through `@cheatcode/preview-bridge`. It injects only
bounded code-server workbench HTML and pins parent messaging to
`http://localhost:3000`; generated-app preview HTML remains streamed.

AgentRun does not count, persist, bill, or emit model-token or model-cost data,
and it does not apply per-run or daily dollar caps. Provider usage remains an
opaque SDK concern.

AgentRun writes Workers Analytics Engine agent-run metrics on terminal statuses and emits
a first-visible-chunk TTFT performance metric for the analytics watchdog. Run
admission events carry the planned logical model, while stream-attempt/completion events carry
the resolved logical model. A failure before any stream attempt keeps planned attribution instead;
provider-local transport IDs remain structured-log context. R2-backed artifact
persistence also atomically claims the user's durable first-artifact timestamp before emitting the
`first_generated_artifact` activation signal, so output retention cannot make it fire twice.
Terminal database status updates are first persisted or durably queued in AgentRun's
SQLite storage; alarms retry transient database failures with bounded exponential delay
until the database accepts the update.
Final assistant transcript persistence is also run-idempotent: PostgreSQL permits only
one assistant message per run and accepts a replay only when its JSONB content and tenant
identity are semantically identical.
Mastra tool-call chunks also emit `step_started`, `step_completed`,
`tool_invoked`, and `skill_invoked` events when those chunks are present in the
live stream. If the last stream subscriber disconnects while a run is still
running, AgentRun emits `run_abandoned` for the watchdog/funnel trail.

AgentRun also emits `data-plan` and `data-task-status` UI chunks so the web app can
render task progress without polling a separate status endpoint.

Project deletion first fences project/thread mutations, refuses an active run, records a
durable cleanup request, then removes that project's workspace folder. The database marks
cleanup complete only after the Agent service succeeds, so a repeated DELETE retries a
failed cleanup instead of silently leaking storage. Account deletion destroys shared
sandbox state once and removes run Durable Objects in bounded pages. The account cleanup
RPC synchronously fences new sandbox work, drains operations that already started, records
final sandbox usage, deletes the validated Daytona sandbox, and preserves only a durable
deletion tombstone. A restarted `ProjectSandbox` therefore cannot recreate resources for a
deleted account. Late lease renewal, lease release, and alarm delivery are safe no-ops after
the fence; every other sandbox RPC fails closed. Every destructive maintenance request is
verified through the shared `ccm1` method/path/millisecond-timestamp/body-hash contract
before the shared deletion payload schema is parsed.

Project ZIP generation and streaming share the exact
`PROJECT_ARCHIVE_MAX_OUTPUT_BYTES` contract from `@cheatcode/types` (640 MiB). The
sandbox deletes an oversized archive before it can be returned, and the Worker enforces
the same bound while streaming.

## Public exports

- `agentApp`
- `AgentRun`
- `ProjectSandbox`

## Code Checks

```bash
pnpm --filter @cheatcode/agent-worker typecheck
```

## Env

- `CHEATCODE_ENVIRONMENT` (`production` in committed Wrangler config; local generated config overrides it)
- `CHEATCODE_RELEASE_SHA` (required for production deployments)
- `CF_VERSION_METADATA`
- `AGENT_RUN`
- `PROJECT_SANDBOX`
- `HYPERDRIVE`
- `DAYTONA_API_KEY`
- `DAYTONA_API_URL`
- `DAYTONA_TARGET`
- `DAYTONA_SANDBOX_SNAPSHOT`
- `PREVIEW_TOKEN_SECRET`
- `COMPOSIO_API_KEY`
- `DEEPSEEK_PLATFORM_API_KEY`
- `OUTPUT_DOWNLOAD_SIGNING_SECRET` (Secrets Store binding)
- `OUTPUT_DOWNLOAD_BASE_URL`
- `INTERNAL_MAINTENANCE_SECRET`
- `PREVIEW_HOSTNAME`
- `QUOTA_TRACKER`
- `R2_AUDIT`
- `R2_OUTPUTS`
- `R2_OUTPUTS_BUCKET_NAME`
- `SANDBOX_STATE`
- `USER_EVENTS`, `AGENT_METRICS`, `ERROR_EVENTS`, `PERFORMANCE_METRICS`
