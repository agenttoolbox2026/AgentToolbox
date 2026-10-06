-- Additive pricing/preview state. Amounts are canonical decimal TEXT, never SQL money arithmetic.
ALTER TABLE platform_payments ADD COLUMN request_hash TEXT;
ALTER TABLE platform_payments ADD COLUMN requirements_json TEXT;
ALTER TABLE platform_payments ADD COLUMN minimum_policy TEXT;
ALTER TABLE platform_payments ADD COLUMN quote_id TEXT;
ALTER TABLE platform_payments ADD COLUMN prepared_id TEXT;
CREATE TABLE platform_preparations (
 prepared_id TEXT PRIMARY KEY, product_id TEXT NOT NULL, version TEXT NOT NULL,
 request_hash TEXT NOT NULL, request_key_hash TEXT NOT NULL, capability_hash TEXT NOT NULL,
 client_hash TEXT NOT NULL, input_hash TEXT NOT NULL, result_hash TEXT,
 result_json TEXT, preview_json TEXT,
 state TEXT NOT NULL CHECK(state IN ('preparing','ready','failed','claimed')),
 operation_id TEXT UNIQUE, created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
 UNIQUE(product_id,version,request_key_hash)
);
CREATE INDEX platform_prepare_budget ON platform_preparations(created_at,client_hash);
CREATE TABLE platform_quotes (
 quote_id TEXT PRIMARY KEY, product_id TEXT NOT NULL, version TEXT NOT NULL,
 input_hash TEXT NOT NULL, result_hash TEXT, prepared_id TEXT REFERENCES platform_preparations(prepared_id),
 capability_hash TEXT, amount_atomic TEXT NOT NULL, minimum_policy TEXT NOT NULL,
 requirements_json TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
 operation_id TEXT UNIQUE, payer TEXT
);
CREATE INDEX platform_quote_budget ON platform_quotes(created_at);
CREATE TRIGGER platform_quote_immutable BEFORE UPDATE OF product_id,version,input_hash,result_hash,prepared_id,capability_hash,amount_atomic,minimum_policy,requirements_json,created_at,expires_at ON platform_quotes
BEGIN SELECT RAISE(ABORT,'immutable_quote'); END;
-- The insert and both claims commit or roll back together, including uniqueness failures.
CREATE TRIGGER platform_claim_quote AFTER INSERT ON platform_payments WHEN NEW.quote_id IS NOT NULL
BEGIN
 UPDATE platform_quotes SET operation_id=NEW.operation_id,payer=NEW.payer
 WHERE quote_id=NEW.quote_id AND operation_id IS NULL AND product_id=NEW.product_id AND version=NEW.version
 AND amount_atomic=NEW.amount_atomic AND requirements_json=NEW.requirements_json
 AND minimum_policy=NEW.minimum_policy AND expires_at>NEW.created_at;
 SELECT RAISE(ABORT,'quote_already_claimed') WHERE changes()<>1;
 UPDATE platform_preparations SET state='claimed',operation_id=NEW.operation_id
 WHERE NEW.prepared_id IS NOT NULL AND prepared_id=NEW.prepared_id AND state='ready' AND expires_at>NEW.created_at
 AND prepared_id=(SELECT prepared_id FROM platform_quotes WHERE quote_id=NEW.quote_id);
 SELECT RAISE(ABORT,'prepared_already_claimed') WHERE NEW.prepared_id IS NOT NULL AND changes()<>1;
END;
CREATE TRIGGER platform_payment_terms_immutable BEFORE UPDATE OF request_hash,requirements_json,minimum_policy,quote_id,prepared_id ON platform_payments
BEGIN SELECT RAISE(ABORT,'immutable_payment_terms'); END;
