# @cheatcode/types

Shared branded IDs, Zod API schemas, provider response trust-boundary parsers,
capability discovery contracts, error codes, and UI message types.

## Public exports

- `ids.ts`: branded entity identifiers
- `api.ts`: API request/response schemas
- `@cheatcode/types/artifacts`: canonical artifact kinds and output IDs plus the safe short-lived
  download-URL response trust-boundary schema
- `@cheatcode/types/billing`: canonical billing-tier values, schemas, ordering, and rank helper
- `@cheatcode/types/capabilities`: framework-free agent/tool discovery catalog,
  sandbox/artifact runtime traits, and exact runtime name types
- `@cheatcode/types/daytona-preview`: pure Daytona preview host allowlist and
  response URL validation without loading the general API contract barrel
- `errors.ts`: locked error code catalog
- `@cheatcode/types/integrations`: canonical open Composio toolkit-slug schema and constraints
- `internal-maintenance.ts`: strict deletion, workspace/sandbox-transition evidence, and
  closed-release database-readiness request/response contracts
- `models.ts`: catalog IDs plus the open provider-prefixed logical-model schema
- `@cheatcode/types/quota`: strict cross-Worker QuotaTracker request/response
  contracts and canonical quota feature identifiers
- `ui-message.ts`: the exact AI SDK UI message data-part contract persisted in
  Postgres and replayed to the web client

`api.ts` also exports the canonical user-message character budget (including inlined
attachment text) and finalized project-archive byte limit so browser and Worker
boundaries cannot drift.

## Code Checks

```bash
pnpm --filter @cheatcode/types typecheck
```

## Env

None.
