PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS recoveries (
  id TEXT PRIMARY KEY, idem_hash TEXT NOT NULL UNIQUE, request_hash TEXT NOT NULL,
  created_ms INTEGER NOT NULL, expires_ms INTEGER NOT NULL, delete_after_ms INTEGER NOT NULL,
  recoverable INTEGER NOT NULL CHECK(recoverable IN (0,1)), decision_json TEXT NOT NULL,
  evidence_type TEXT NOT NULL, attempts_before INTEGER NOT NULL,
  agent_hash TEXT, discovery_source TEXT NOT NULL, latency_ms INTEGER NOT NULL,
  operation_hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS recovery_retention ON recoveries(delete_after_ms);
CREATE TABLE IF NOT EXISTS acceptances (
  recovery_id TEXT PRIMARY KEY REFERENCES recoveries(id) ON DELETE CASCADE,
  accepted INTEGER NOT NULL CHECK(accepted IN (0,1)), cap_atomic INTEGER NOT NULL CHECK(cap_atomic >= 0),
  created_ms INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS results (
  recovery_id TEXT PRIMARY KEY REFERENCES recoveries(id) ON DELETE CASCADE,
  fingerprint TEXT NOT NULL, created_ms INTEGER NOT NULL,
  outcome TEXT NOT NULL, eligible INTEGER NOT NULL CHECK(eligible IN (0,1)),
  evidence_type TEXT NOT NULL, evidence_hash TEXT, result_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS feedback (
  recovery_id TEXT PRIMARY KEY REFERENCES recoveries(id) ON DELETE CASCADE,
  fingerprint TEXT NOT NULL, created_ms INTEGER NOT NULL,
  helpful INTEGER NOT NULL CHECK(helpful IN (0,1)), reason TEXT NOT NULL, operator_effort_ms INTEGER
);
-- Separate, minimal payment-relevant records. No body, raw input, keys or signatures.
-- Dev-only schema prevents even a configuration mistake recording live revenue.
CREATE TABLE IF NOT EXISTS payment_events (
  event_id TEXT PRIMARY KEY, time_ms INTEGER NOT NULL, recovery_id TEXT NOT NULL,
  product TEXT NOT NULL DEFAULT 'retry-gate', version TEXT NOT NULL DEFAULT '0.1.0',
  event_type TEXT NOT NULL, mode TEXT NOT NULL DEFAULT 'dev' CHECK(mode = 'dev'),
  network TEXT, asset TEXT NOT NULL DEFAULT 'USDC',
  quoted_atomic INTEGER NOT NULL DEFAULT 0 CHECK(quoted_atomic = 0),
  settled_atomic INTEGER NOT NULL DEFAULT 0 CHECK(settled_atomic = 0),
  payer TEXT, receiver TEXT, facilitator_reference TEXT, transaction_hash TEXT, evidence_hash TEXT
);
CREATE TRIGGER IF NOT EXISTS ledger_no_update BEFORE UPDATE ON payment_events
BEGIN SELECT RAISE(ABORT, 'append_only_ledger'); END;
CREATE TRIGGER IF NOT EXISTS ledger_no_delete BEFORE DELETE ON payment_events
BEGIN SELECT RAISE(ABORT, 'append_only_ledger'); END;
CREATE TRIGGER IF NOT EXISTS quoted_event AFTER INSERT ON recoveries BEGIN
  INSERT INTO payment_events(event_id,time_ms,recovery_id,event_type)
  VALUES(NEW.id || ':quoted',NEW.created_ms,NEW.id,'quoted');
END;
CREATE TRIGGER IF NOT EXISTS accepted_event AFTER INSERT ON acceptances BEGIN
  INSERT INTO payment_events(event_id,time_ms,recovery_id,event_type)
  VALUES(NEW.recovery_id || ':accepted',NEW.created_ms,NEW.recovery_id,CASE WHEN NEW.accepted = 1 THEN 'accepted_dev' ELSE 'declined' END);
END;
CREATE TRIGGER IF NOT EXISTS result_event AFTER INSERT ON results BEGIN
  INSERT INTO payment_events(event_id,time_ms,recovery_id,event_type,evidence_hash)
  VALUES(NEW.recovery_id || ':result',NEW.created_ms,NEW.recovery_id,
    CASE WHEN NEW.eligible = 1 THEN 'eligible_dev_no_charge' ELSE 'result_no_charge' END,NEW.evidence_hash);
END;
