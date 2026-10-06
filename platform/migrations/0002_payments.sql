CREATE TABLE IF NOT EXISTS platform_payments (
 operation_id TEXT PRIMARY KEY,
 product_id TEXT NOT NULL, version TEXT NOT NULL, key_hash TEXT NOT NULL,
 fingerprint TEXT NOT NULL, payment_digest TEXT NOT NULL,
 network TEXT NOT NULL, asset TEXT NOT NULL, payer TEXT NOT NULL, nonce TEXT NOT NULL,
 amount_atomic TEXT NOT NULL, receiver TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('executing','outcome_ready','settling','settled','failed','unknown')),
 result_json TEXT, settlement_json TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 sample_kind TEXT NOT NULL CHECK(sample_kind IN ('synthetic','unclassified')),
 UNIQUE(product_id,version,key_hash),
 UNIQUE(network,asset,payer,nonce)
);
CREATE TABLE IF NOT EXISTS platform_payment_ledger (
 event_id TEXT PRIMARY KEY, operation_id TEXT NOT NULL, product_id TEXT NOT NULL,
 version TEXT NOT NULL, event TEXT NOT NULL,
 network TEXT NOT NULL, asset TEXT NOT NULL, amount_atomic TEXT NOT NULL,
 transaction_hash TEXT, sample_kind TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS platform_ledger_no_update BEFORE UPDATE ON platform_payment_ledger BEGIN SELECT RAISE(ABORT,'append_only'); END;
CREATE TRIGGER IF NOT EXISTS platform_ledger_no_delete BEFORE DELETE ON platform_payment_ledger BEGIN SELECT RAISE(ABORT,'append_only'); END;
