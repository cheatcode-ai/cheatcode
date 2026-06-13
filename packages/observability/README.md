# @cheatcode/observability

Structured logging, redaction, error response helpers, lightweight timing spans, and Workers
Analytics Engine emitters.

Performance metrics use the locked `cc_performance_metrics` column order from `plan.md`:
`ttftMs`, `totalMs`, `dbQueryMs`, `sandboxMs`, `llmMs`, and `queueWaitMs`.
User funnel events use the locked `cc_user_events` order, including
run/template/model/status context for run telemetry plus secondary activation
signals. Cost-cap stops emit `silent_failure_detected` with
`detector=cost_spike` and confidence metadata. Daily usage rollups emit
`cost_aggregated_daily` with token and cost totals, and daily activation
cohorts emit `retention_d7`, `retention_d28`, and `first_week_mau`.
Mastra chunk telemetry adds step/tool/skill fields while staying within the
Workers Analytics Engine 20-blob/20-double limit.

## Public exports

- `logger`, `createLogger`
- `redactSecrets`
- `APIError`
- `normalizeUnknownError`
- `withErrorHandler`
- `emitAgentMetric`, `emitUserEvent`, `emitErrorEvent`, `emitPerformanceMetric`, `emitCostEvent`
- `span`

## Code Checks

```bash
pnpm --filter @cheatcode/observability typecheck
```

## Env

None.
