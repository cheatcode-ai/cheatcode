# @cheatcode/agent-worker

Agent loop Worker with `AgentRun`, project-scoped `ProjectSandbox`, and the Blaxel
sandbox adapter.

Run and sandbox Durable Object names are derived from the internal `users.id` UUID plus the
thread id. Stream resume requests must arrive through the gateway path that supplies that
internal user header.

Run creation validates the gateway payload with the shared `CreateRunSchema` from
`packages/types` before selecting the user-scoped `AgentRun` Durable Object.

Normal chat runs resolve the user's Anthropic BYOK key from Supabase Vault through
`packages/byok`, pass it to Mastra with request context, and execute tools against the
project-scoped Blaxel sandbox.

Composio actions use the app-level `COMPOSIO_API_KEY`, active rows in
`v2_user_integrations`, and the gateway-owned `QuotaTracker` Durable Object before
executing against a user-connected OAuth account.

ProjectSandbox records elapsed sandbox-hours to the same `QuotaTracker` as a soft
meter so Settings can show real monthly sandbox consumption without blocking
sandbox file/process work.

Each project sandbox creates one Blaxel persistent volume named `ccv-${sandboxId}`
and mounts it at `/workspace`. Blaxel standby preserves hot state between
runs, while the volume keeps project files recoverable if the sandbox is deleted
and recreated.

AgentRun estimates BYOK token spend from the locked model pricing table in
`plan.md` so the $5 default per-run hard cap, lower project/user caps, and
tier-based daily cost caps stop the stream before additional work continues.
The estimate is for user-visible caps and telemetry only; Cheatcode does not
charge LLM markup.

AgentRun writes Workers Analytics Engine agent-run metrics on terminal statuses and emits
a first-visible-chunk TTFT performance metric for the analytics watchdog. Run
start/completion events are emitted to `cc_user_events`, and R2-backed artifact
persistence also emits the `first_generated_artifact` activation signal.
Mastra tool-call chunks also emit `step_started`, `step_completed`,
`tool_invoked`, and `skill_invoked` events when those chunks are present in the
live stream. If the last stream subscriber disconnects while a run is still
running, AgentRun emits `run_abandoned` for the watchdog/funnel trail.

AgentRun also emits `data-plan` and `data-task-status` UI chunks so the web app can
render the V1-style task progress rail without polling a separate status endpoint.

## Public exports

- `agentApp`
- `AgentRun`
- `ProjectSandbox`

## Code Checks

```bash
pnpm --filter @cheatcode/agent-worker typecheck
```

## Env

- `AGENT_RUN`
- `PROJECT_SANDBOX`
- `HYPERDRIVE`
- `BL_API_KEY` (standard Worker secret)
- `BL_WORKSPACE` (standard Worker secret)
- `BL_REGION` (standard Worker secret)
- `BLAXEL_SANDBOX_IMAGE`
- `BLAXEL_SANDBOX_MEMORY_MB`
- `COMPOSIO_API_KEY`
- `OUTPUT_DOWNLOAD_SIGNING_SECRET` (standard Worker secret)
- `OUTPUT_DOWNLOAD_BASE_URL`
- `INTERNAL_MAINTENANCE_SECRET`
- `PREVIEW_HOSTNAME`
- `QUOTA_TRACKER`
- `R2_AUDIT`
- `R2_OUTPUTS`
- `R2_OUTPUTS_BUCKET_NAME`
- `USER_EVENTS`
