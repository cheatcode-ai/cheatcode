# @cheatcode/types

Shared branded IDs, Zod API schemas, provider response trust-boundary parsers,
capability discovery contracts, error codes, and UI message types.

## Public exports

- `ids.ts`: branded entity identifiers
- `@cheatcode/types/api`: public API request/response schemas and limits
- `@cheatcode/types/artifacts`: canonical artifact kinds and output IDs plus the safe short-lived
  download-URL response trust-boundary schema
- `@cheatcode/types/billing`: canonical billing-tier values, schemas, ordering, and rank helper
- `@cheatcode/types/capabilities`: framework-free agent/tool discovery catalog,
  sandbox/artifact runtime traits, and exact runtime name types
- `@cheatcode/types/daytona-preview`: pure Daytona preview host allowlist and
  response URL validation without loading the general API contract barrel
- `errors.ts`: locked error code catalog
- `@cheatcode/types/integrations`: canonical open Composio toolkit-slug schema and constraints
- `@cheatcode/types/internal`: Worker-only Gateway-to-Agent route manifest,
  service-binding deletion contracts, and workspace/sandbox-transition evidence
- `models.ts`: catalog IDs plus the open provider-prefixed logical-model schema
- `@cheatcode/types/quota`: the single QuotaTracker RPC contract, typed
  capability-scoped WorkerEntrypoint projections, strict request/response
  contracts, and canonical quota feature identifiers
- `sandbox-wire.ts`: canonical sandbox file-entry fields and exec-result base
  used by API, runtime-port, and code-tool schemas
- `skill-runtime.ts`: canonical skill-runtime capability scopes and schema
- `ui-message.ts`: the exact AI SDK UI message data-part contract persisted in
  Postgres and replayed to the web client, including the app-preview content-readiness transition
  that keeps internal scaffolds out of the user-facing Browser surface

The `./api` subpath also exports the canonical user-message character budget, project-file
upload/batch/namespace limits and schemas, the discriminated upload/generated-Deliverable project
file catalog plus deterministic Deliverable path builder, and finalized project-archive byte
limit so browser and Worker boundaries cannot drift.

## Code Checks

```bash
pnpm --filter @cheatcode/types typecheck
```

## Env

None.
