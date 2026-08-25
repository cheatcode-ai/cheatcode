# @cheatcode/observability

Structured logging, redaction, error response helpers, and Workers Analytics
Engine emitters.

Performance metrics use the locked `cc_performance_metrics` column order enforced in
`src/analytics.ts`. `index1` is route. Blobs 1-12 are worker, environment,
release/version, status class, metric name, colo, placement, reconnect state,
provider, logical model, experiment variant, and cold-state label. Doubles 1-20
are legacy TTFT, total, DB query, sandbox, LLM, queue wait, secret resolution,
JWT verification, user lookup, rate limit, DB connection, DB context, Service
Binding, Durable Object, Workflow acceptance, response headers, first status,
first model text, final token, and run completion.
The generic Worker middleware labels the first request observed by each isolate
as `cold` and subsequent requests as `warm`; it is an isolate-start correlation
signal, not a claim that Cloudflare created a new process or machine.
User funnel events use the locked `cc_user_events` order. Blob 9 contains the
planned logical model for admission events and the resolved logical model for
stream-attempt/completion events. Pre-attempt failures retain planned attribution;
provider-local transport IDs stay in structured logs. Model token counts and
model costs are not collected.
The `retention_d7`, `retention_d28`, and `first_week_mau` cohorts are no longer emitted.
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
- `findAPIError` and `toAPIError` recover repository-owned error codes, status,
  retry policy, and bounded messages after framework wrapping or serialization;
  unrecognized exceptions remain internal errors
- `safeErrorTelemetry` for allowlisted error metadata (`name`, `code`,
  `constraint`, `status`, and `retriable`) without messages, stacks, SQL, or
  query parameters
- `createWorkerRuntime` for one request-ID, error-formatting, logging, error
  event, and optional performance-metric boundary per Worker
- `createPerformanceMetricMiddleware`, `requestId`, `routeName`, and
  `routeWorkerError`
- `createPerformanceRecorder` and `safeServerTiming` for request-scoped phase
  measurement and a safe aggregate browser header
- bounded request/response readers: `readJsonRequest`, `readBoundedRequestBytes`,
  `readBoundedRequestText`, `readBoundedResponseText`, and `readBoundedResponseJson`
- `withBoundedResponseBody` for enforcing response limits before an SDK parser
  consumes the stream
- `emitAgentMetric`, `emitUserEvent`, `emitErrorEvent`, `emitPerformanceMetric`

Analytics emitters are best-effort by contract: a missing binding, account
quota, or per-invocation write allowance cannot fail the product operation that
produced the telemetry. Callers therefore do not add local error handling or
make correctness decisions from an Analytics Engine write.
Percentile query templates and dashboard column aliases live under
`infra/cloudflare/analytics`; weighted quantiles account for Analytics Engine
sampling and filter unset zero placeholders per metric.

Error Analytics Engine rows intentionally contain only categorical metadata.
Raw error messages and stack traces are never written to Analytics Engine, and
the structured logger suppresses error-message, stack, SQL, parameter, body,
prompt, content, and command-output fields at its sink.
Agent Workflow terminal failures and pre-tool infrastructure failures emit run-scoped rows through
this same safe projection, so an exhausted retry retains source and cause classifications without
persisting prompts, commands, provider responses, or credentials.

## Code Checks

```bash
pnpm --filter @cheatcode/observability typecheck
```

## Env

None.
