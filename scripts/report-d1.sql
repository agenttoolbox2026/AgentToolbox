-- Read-only aggregates. No recovery handles, caller identifiers or evidence hashes.
SELECT 'dev' AS payment_mode, started_at AS aggregate_coverage_start,
  'No historical backfill; counts are not customers or caller retention' AS caveat
FROM usage_coverage WHERE id=1;

SELECT * FROM daily_usage ORDER BY day DESC LIMIT 90;

-- Persistent no-charge ledger evidence; separate from usage and success reports.
SELECT strftime('%Y-%m-%d',time_ms/1000,'unixepoch') AS day,
  mode, event_type, COUNT(*) AS events, SUM(settled_atomic) AS settled_usdc_atomic
FROM payment_events GROUP BY day,mode,event_type ORDER BY day DESC;

-- Current schema prohibits live events and positive settlement; zero is mandatory.
SELECT 'dev_only_no_payment_integration' AS status,
  COALESCE(SUM(settled_atomic),0) AS simulated_settled_usdc_atomic,
  0 AS verified_mainnet_revenue_usdc_atomic FROM payment_events;

-- Current, unexpired learning sample only; not a durable history.
SELECT json_extract(decision_json,'$.reason') AS recommendation,
  json_extract(decision_json,'$.action') AS action, discovery_source,
  COUNT(*) AS quotes, AVG(latency_ms) AS mean_pre_database_decision_ms
FROM recoveries WHERE delete_after_ms > unixepoch('now')*1000
GROUP BY recommendation,action,discovery_source;
