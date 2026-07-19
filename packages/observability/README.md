# @cheatcode/observability

Structured logging, redaction, error response helpers, and Workers Analytics
Engine emitters.

Performance metrics use the `cc_performance_metrics` column order enforced in `src/analytics.ts`:
`ttftMs`, `totalMs`, `dbQueryMs`, `sandboxMs`, `llmMs`, and `queueWaitMs`.
User funnel events use the locked `cc_user_events` order. Blob 9 contains the
planned logical model for admission events and the resolved logical model for
stream-attempt/completion events. Pre-attempt failures retain planned attribution;
provider-local transport IDs stay in structured logs. Daily activation cohorts emit
`retention_d7`, `retention_d28`, and
`first_week_mau` in 200-point Workflow pages and bind the logical cohort event to
its UTC day in blob 13. Their deterministic `activation:<day>:<event>:<user>`
identity occupies blob 6 (the run-identity position used by other events). Because
Analytics Engine writes are append-only and Workflow steps are replayable, every
activation cohort query must count `DISTINCT blob6`; raw row counts and sampled
counts are not valid cohort totals. Model token counts and model costs are not collected.
Mastra chunk telemetry adds step/tool/skill fields while staying within the
Workers Analytics Engine 20-blob/20-double limit.
Error events reserve blobs 7-14 for the safe error name, source code,
constraint, cause name/code/constraint, and direct/cause retriable flags;
doubles 4-5 hold direct/cause status codes. Blobs 1-6 and doubles 1-3 retain
their existing category/code/route/identity/release and HTTP/retry/duration
positions.

## Public exports

- `createLogger` and the `Logger` contract
- `redactSecrets`
- `APIError`
- `safeErrorTelemetry` for allowlisted error metadata (`name`, `code`,
  `constraint`, `status`, and `retriable`) without messages, stacks, SQL, or
  query parameters
- `withErrorHandler`
- bounded request/response readers: `readJsonRequest`, `readBoundedRequestText`,
  `readBoundedResponseText`, and `readBoundedResponseJson`
- `withBoundedResponseBody` for enforcing response limits before an SDK parser
  consumes the stream
- `emitAgentMetric`, `emitUserEvent`, `emitErrorEvent`, `emitPerformanceMetric`

Error Analytics Engine rows intentionally contain only categorical metadata.
Raw error messages and stack traces are never written to Analytics Engine, and
the structured logger suppresses error-message, stack, SQL, parameter, body,
prompt, content, and command-output fields at its sink.

## Code Checks

```bash
pnpm --filter @cheatcode/observability typecheck
```

## Env

None.
