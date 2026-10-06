ALTER TABLE platform_payments ADD COLUMN is_live INTEGER NOT NULL DEFAULT 0 CHECK(is_live IN (0,1));
ALTER TABLE platform_payments ADD COLUMN result_expires_at TEXT;
ALTER TABLE platform_payments ADD COLUMN outcome TEXT CHECK(outcome IN ('success','failure','unverifiable'));
CREATE INDEX platform_payment_retention ON platform_payments(result_expires_at) WHERE result_json IS NOT NULL;
CREATE TABLE platform_paid_purchases (
 operation_id TEXT PRIMARY KEY REFERENCES platform_payments(operation_id),
 product_id TEXT NOT NULL, version TEXT NOT NULL, amount_atomic TEXT NOT NULL,
 transaction_hash TEXT NOT NULL, completed_at TEXT NOT NULL
);
CREATE TABLE platform_public_totals (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
INSERT INTO platform_public_totals VALUES('paid_purchases',0);
CREATE TRIGGER platform_count_paid_purchase AFTER UPDATE OF state ON platform_payments
WHEN NEW.state='settled' AND NEW.is_live=1 AND NEW.sample_kind='unclassified'
 AND NEW.payer<>NEW.receiver AND CAST(NEW.amount_atomic AS INTEGER)>0
BEGIN
 INSERT OR IGNORE INTO platform_paid_purchases
 SELECT NEW.operation_id,NEW.product_id,NEW.version,NEW.amount_atomic,l.transaction_hash,NEW.updated_at
 FROM platform_payment_ledger l WHERE l.operation_id=NEW.operation_id AND l.event='settlement_reported';
END;
CREATE TRIGGER platform_increment_paid_total AFTER INSERT ON platform_paid_purchases
BEGIN UPDATE platform_public_totals SET value=value+1 WHERE key='paid_purchases'; END;
CREATE TRIGGER platform_purchase_no_update BEFORE UPDATE ON platform_paid_purchases BEGIN SELECT RAISE(ABORT,'append_only'); END;
CREATE TRIGGER platform_purchase_no_delete BEFORE DELETE ON platform_paid_purchases BEGIN SELECT RAISE(ABORT,'append_only'); END;
