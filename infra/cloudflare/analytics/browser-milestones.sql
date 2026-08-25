SELECT
  blob5 AS milestone,
  index1 AS route,
  QUANTILEEXACTWEIGHTED(double2, 0.50, _sample_interval) AS p50_ms,
  QUANTILEEXACTWEIGHTED(double2, 0.75, _sample_interval) AS p75_ms,
  QUANTILEEXACTWEIGHTED(double2, 0.95, _sample_interval) AS p95_ms,
  SUM(_sample_interval) AS samples
FROM cc_performance_metrics
WHERE timestamp > NOW() - INTERVAL '1' DAY
  AND blob1 = 'web'
  AND blob5 IN ('run_response_headers', 'run_first_status', 'run_first_model_text', 'run_stream_finished')
  AND double2 > 0
GROUP BY milestone, route
ORDER BY milestone, p95_ms DESC
