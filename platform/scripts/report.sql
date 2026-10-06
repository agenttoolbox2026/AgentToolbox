SELECT 'Request counts are not customer counts; unclassified traffic is not verified organic usage.' AS interpretation;
SELECT day,product_id,version,channel,event,sample_kind,count,duration_ms FROM platform_daily ORDER BY day,product_id,version,channel,event,sample_kind;
SELECT product_id,version,sample_kind,COUNT(*) AS reported_pseudonyms,SUM(completed_runs) AS completed_runs,SUM(CASE WHEN completed_runs>1 THEN 1 ELSE 0 END) AS repeat_pseudonyms FROM platform_callers GROUP BY product_id,version,sample_kind;
SELECT product_id,version,sample_kind,state,COUNT(*) AS retained_runs FROM platform_runs GROUP BY product_id,version,sample_kind,state;
SELECT product_id,version,sample_kind,state,COUNT(*) AS payment_operations FROM platform_payments GROUP BY product_id,version,sample_kind,state;
-- Monetary totals are calculated by report.js with exact BigInt arithmetic.
SELECT 'Facilitator reports are not reconciled on-chain revenue.' AS payment_interpretation;
SELECT product_id,version,sample_kind,outcome,COUNT(*) AS paid_outcome_reports FROM platform_payments WHERE outcome IS NOT NULL GROUP BY product_id,version,sample_kind,outcome;
SELECT * FROM platform_public_totals;
