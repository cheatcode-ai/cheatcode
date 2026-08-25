SELECT
  index1 AS route,
  blob1 AS worker,
  blob3 AS release,
  QUANTILEEXACTWEIGHTED(double2, 0.50, _sample_interval) AS p50_ms,
  QUANTILEEXACTWEIGHTED(double2, 0.75, _sample_interval) AS p75_ms,
  QUANTILEEXACTWEIGHTED(double2, 0.95, _sample_interval) AS p95_ms,
  SUM(_sample_interval) AS requests
FROM cc_performance_metrics
WHERE timestamp > NOW() - INTERVAL '1' DAY
  AND double2 > 0
GROUP BY route, worker, release
ORDER BY p95_ms DESC
