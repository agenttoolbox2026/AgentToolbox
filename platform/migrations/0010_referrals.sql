-- First-party referral pilot. Accrued obligations only; no transfers or backfill.
CREATE TABLE platform_referrers (
 referral_code TEXT PRIMARY KEY, capability_hash TEXT NOT NULL UNIQUE,
 terms_version TEXT NOT NULL CHECK(terms_version='first-party-referrals-2026-10-07.v1'),
 share_bps INTEGER NOT NULL CHECK(share_bps=100), terms_json TEXT NOT NULL,
 created_at TEXT NOT NULL, client_hash TEXT NOT NULL,
 UNIQUE(referral_code,terms_version,share_bps)
);
CREATE INDEX platform_referral_registration_budget ON platform_referrers(created_at,client_hash);
CREATE TRIGGER platform_referrer_no_update BEFORE UPDATE ON platform_referrers BEGIN SELECT RAISE(ABORT,'immutable_referrer'); END;
CREATE TRIGGER platform_referrer_no_delete BEFORE DELETE ON platform_referrers BEGIN SELECT RAISE(ABORT,'append_only'); END;

ALTER TABLE platform_payments ADD COLUMN referral_code TEXT;
ALTER TABLE platform_payments ADD COLUMN referral_terms_version TEXT;
ALTER TABLE platform_payments ADD COLUMN referral_share_bps INTEGER;
CREATE TRIGGER platform_payment_referral_guard BEFORE INSERT ON platform_payments
BEGIN
 SELECT RAISE(ABORT,'invalid_referral_beneficiary') WHERE
 NOT (NEW.referral_code IS NULL AND NEW.referral_terms_version IS NULL AND NEW.referral_share_bps IS NULL)
 AND NOT EXISTS(
 SELECT 1 FROM platform_referrers r WHERE r.referral_code=NEW.referral_code
 AND r.terms_version=NEW.referral_terms_version AND r.share_bps=NEW.referral_share_bps
 AND NEW.product_id IN ('docs-pack','quote-proof','contract-cases','mcp-wirecheck')
 AND NEW.creator_tool_id IS NULL AND NEW.creator_id IS NULL AND NEW.creator_share_bps IS NULL
 AND NOT EXISTS(SELECT 1 FROM platform_creator_entitlements e WHERE e.tool_id=NEW.product_id));
END;
CREATE TRIGGER platform_payment_referral_immutable BEFORE UPDATE OF referral_code,referral_terms_version,referral_share_bps ON platform_payments
BEGIN SELECT RAISE(ABORT,'immutable_referral_beneficiary'); END;
CREATE TRIGGER platform_referred_payment_contract_immutable BEFORE UPDATE OF product_id,version,network,asset,payer,receiver,amount_atomic ON platform_payments
WHEN OLD.referral_code IS NOT NULL
BEGIN SELECT RAISE(ABORT,'immutable_referred_payment_contract'); END;

CREATE TABLE platform_referral_allocations (
 operation_id TEXT PRIMARY KEY REFERENCES platform_live_receipts(operation_id),
 referral_code TEXT NOT NULL, terms_version TEXT NOT NULL, share_bps INTEGER NOT NULL CHECK(share_bps=100),
 product_id TEXT NOT NULL, version TEXT NOT NULL, network TEXT NOT NULL, asset TEXT NOT NULL,
 gross_atomic TEXT NOT NULL, created_at TEXT NOT NULL,
 FOREIGN KEY(referral_code,terms_version,share_bps) REFERENCES platform_referrers(referral_code,terms_version,share_bps)
);
CREATE INDEX platform_referral_allocation_lookup ON platform_referral_allocations(referral_code,operation_id);
CREATE TRIGGER platform_referral_allocation_insert_guard BEFORE INSERT ON platform_referral_allocations
BEGIN
 SELECT RAISE(ABORT,'authoritative_referral_receipt_required') WHERE NOT EXISTS(
 SELECT 1 FROM platform_live_receipts r JOIN platform_payments p USING(operation_id)
 JOIN platform_referrers f ON f.referral_code=p.referral_code AND f.terms_version=p.referral_terms_version AND f.share_bps=p.referral_share_bps
 WHERE r.operation_id=NEW.operation_id AND p.state='settled' AND p.is_live=1
 AND p.referral_code=NEW.referral_code AND p.referral_terms_version=NEW.terms_version AND p.referral_share_bps=NEW.share_bps
 AND r.product_id=NEW.product_id AND r.version=NEW.version AND r.network=NEW.network AND r.asset=NEW.asset
 AND r.gross_atomic=NEW.gross_atomic AND r.settled_at=NEW.created_at
 AND p.creator_tool_id IS NULL AND p.creator_id IS NULL AND p.creator_share_bps IS NULL
 AND r.creator_tool_id IS NULL AND r.creator_id IS NULL AND r.creator_share_bps IS NULL
 AND r.product_id IN ('docs-pack','quote-proof','contract-cases','mcp-wirecheck'));
END;
CREATE TRIGGER platform_allocate_referral AFTER INSERT ON platform_live_receipts
WHEN EXISTS(SELECT 1 FROM platform_payments WHERE operation_id=NEW.operation_id AND referral_code IS NOT NULL)
BEGIN
 INSERT INTO platform_referral_allocations(operation_id,referral_code,terms_version,share_bps,product_id,version,network,asset,gross_atomic,created_at)
 SELECT NEW.operation_id,p.referral_code,p.referral_terms_version,p.referral_share_bps,NEW.product_id,NEW.version,NEW.network,NEW.asset,NEW.gross_atomic,NEW.settled_at
 FROM platform_payments p WHERE p.operation_id=NEW.operation_id;
END;
CREATE TRIGGER platform_referral_allocation_no_update BEFORE UPDATE ON platform_referral_allocations BEGIN SELECT RAISE(ABORT,'append_only'); END;
CREATE TRIGGER platform_referral_allocation_no_delete BEFORE DELETE ON platform_referral_allocations BEGIN SELECT RAISE(ABORT,'append_only'); END;

-- Preserve the original receipt capture and creator assertion. A referred live
-- payment additionally requires its receipt/allocation in this same transition.
-- Do not depend on execution order between separate AFTER UPDATE triggers.
DROP TRIGGER platform_capture_live_receipt;
CREATE TRIGGER platform_capture_live_receipt AFTER UPDATE OF state ON platform_payments
WHEN NEW.state='settled' AND NEW.is_live=1
BEGIN
 INSERT OR IGNORE INTO platform_live_receipts
 SELECT NEW.operation_id,NEW.product_id,NEW.version,NEW.network,NEW.asset,NEW.amount_atomic,l.transaction_hash,NEW.updated_at,
 NEW.creator_tool_id,NEW.creator_id,NEW.creator_share_bps FROM platform_payment_ledger l
 WHERE l.operation_id=NEW.operation_id AND l.event='settlement_reported' AND l.product_id=NEW.product_id AND l.version=NEW.version
 AND l.network=NEW.network AND lower(l.asset)=lower(NEW.asset) AND l.amount_atomic=NEW.amount_atomic AND l.transaction_hash IS NOT NULL
 AND EXISTS(SELECT 1 FROM platform_payment_ledger v WHERE v.operation_id=NEW.operation_id AND v.event='outcome_validated');
 SELECT RAISE(ABORT,'creator_receipt_missing') WHERE NEW.creator_tool_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM platform_live_receipts WHERE operation_id=NEW.operation_id);
 SELECT RAISE(ABORT,'referral_receipt_missing') WHERE NEW.referral_code IS NOT NULL AND (
 NOT EXISTS(SELECT 1 FROM platform_live_receipts WHERE operation_id=NEW.operation_id)
 OR NOT EXISTS(SELECT 1 FROM platform_referral_allocations WHERE operation_id=NEW.operation_id));
END;
