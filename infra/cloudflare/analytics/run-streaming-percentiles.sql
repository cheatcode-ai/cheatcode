SELECT
  blob9 AS provider,
  blob10 AS logical_model,
  QUANTILEEXACTWEIGHTED(double18, 0.50, _sample_interval) AS p50_ms,
  QUANTILEEXACTWEIGHTED(double18, 0.75, _sample_interval) AS p75_ms,
  QUANTILEEXACTWEIGHTED(double18, 0.95, _sample_interval) AS p95_ms,
  SUM(_sample_interval) AS runs
FROM cc_performance_metrics
WHERE timestamp > NOW() - INTERVAL '1' DAY
  AND index1 = '/internal/runs/start'
  AND double18 > 0
GROUP BY provider, logical_model
ORDER BY p95_ms DESC
