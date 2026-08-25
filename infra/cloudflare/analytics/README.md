# Performance dashboards

The `cc_performance_metrics` dataset is the shared request/run/browser latency
source. Configure saved Analytics Engine SQL queries for 24-hour and 7-day
windows, then graph p50/p75/p95 by route, Worker, release, colo, placement,
reconnect state, provider, and logical model.

Analytics Engine stores missing doubles as zero to preserve the locked column
order. Every percentile query must therefore filter the selected double above
zero. Use `QUANTILEEXACTWEIGHTED(value, percentile, _sample_interval)` so read
or write sampling remains statistically represented.

Column aliases:

| Dimension | Column |
|---|---|
| route | `index1` |
| Worker | `blob1` |
| release/version | `blob3` |
| metric name | `blob5` |
| colo | `blob6` |
| placement | `blob7` |
| reconnect state | `blob8` |
| provider | `blob9` |
| logical model | `blob10` |
| total request/browser milestone | `double2` |
| DB query | `double3` |
| DB connection/context | `double11` / `double12` |
| Service Binding / Durable Object | `double13` / `double14` |
| Workflow acceptance / response headers | `double15` / `double16` |
| first status / first model text | `double17` / `double18` |
| final token / run completion | `double19` / `double20` |

The saved query templates cover request totals, browser milestones, streaming
targets, and the Smart Placement canary. Correlate regressions with Workers
automatic traces, Hyperdrive connection/query metrics, Durable Object request
metrics, and the release/version dimension. Alert targets are create-run
response headers p75 < 500 ms, first status p75 < 750 ms, and first model text
p75 < 2.5 s segmented by provider.
