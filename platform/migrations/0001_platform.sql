CREATE TABLE IF NOT EXISTS platform_daily (
  day TEXT NOT NULL,
  product_id TEXT NOT NULL,
  version TEXT NOT NULL,
  channel TEXT NOT NULL CHECK(channel IN ('http','mcp','html')),
  event TEXT NOT NULL CHECK(event IN ('catalog_view','product_view','invoke_attempt','retired_rejected','execution_success','execution_failure','outcome_success','outcome_failure','outcome_unverifiable','payment_required','payment_verified','payment_settled','payment_failed')),
  sample_kind TEXT NOT NULL CHECK(sample_kind IN ('unclassified','synthetic')),
  count INTEGER NOT NULL DEFAULT 0 CHECK(count >= 0),
  duration_ms INTEGER NOT NULL DEFAULT 0 CHECK(duration_ms >= 0),
  PRIMARY KEY(day, product_id, version, channel, event, sample_kind)
);
CREATE TABLE IF NOT EXISTS platform_runs (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  version TEXT NOT NULL,
  idempotency_hash TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  caller_hash TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('running','completed','failed')),
  result_json TEXT,
  outcome TEXT CHECK(outcome IN ('success','failure','unverifiable')),
  sample_kind TEXT NOT NULL CHECK(sample_kind IN ('unclassified','synthetic')),
  UNIQUE(product_id, version, idempotency_hash)
);
CREATE INDEX IF NOT EXISTS platform_runs_expiry ON platform_runs(expires_at);
CREATE TABLE IF NOT EXISTS platform_callers (
  product_id TEXT NOT NULL, version TEXT NOT NULL, caller_hash TEXT NOT NULL,
  sample_kind TEXT NOT NULL,
  first_day TEXT NOT NULL, last_day TEXT NOT NULL, completed_runs INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(product_id,version,caller_hash,sample_kind)
);
