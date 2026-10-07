-- Additive private proposals and creator accrual. No publishing or money transfer.
CREATE TABLE platform_creators (
 creator_id TEXT PRIMARY KEY, capability_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL
);
CREATE TABLE platform_tool_submissions (
 submission_id TEXT PRIMARY KEY, creator_id TEXT NOT NULL REFERENCES platform_creators(creator_id),
 tool_id TEXT NOT NULL UNIQUE, request_key_hash TEXT NOT NULL, request_hash TEXT NOT NULL,
 proposal_json TEXT NOT NULL, terms_json TEXT NOT NULL,
 terms_version TEXT NOT NULL CHECK(terms_version='creator-promo-2026-10-07.v1'),
 list_fee_atomic TEXT NOT NULL CHECK(list_fee_atomic='500000'), discount_bps INTEGER NOT NULL CHECK(discount_bps=10000),
 charged_fee_atomic TEXT NOT NULL CHECK(charged_fee_atomic='0'), paid_fee_atomic TEXT NOT NULL CHECK(paid_fee_atomic='0'),
 share_bps INTEGER NOT NULL CHECK(share_bps=9000), revenue_basis TEXT NOT NULL CHECK(revenue_basis='gross'),
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','approved','rejected')),
 revision INTEGER NOT NULL DEFAULT 0 CHECK(revision IN (0,1)), refund_due_atomic TEXT,
 created_at TEXT NOT NULL, client_hash TEXT NOT NULL,
 UNIQUE(creator_id,request_key_hash)
);
CREATE INDEX platform_submission_budget ON platform_tool_submissions(created_at,client_hash);
CREATE TABLE platform_submission_decisions (
 decision_id TEXT PRIMARY KEY, submission_id TEXT NOT NULL UNIQUE REFERENCES platform_tool_submissions(submission_id),
 reviewer_subject TEXT NOT NULL CHECK(length(reviewer_subject) BETWEEN 1 AND 256), request_key_hash TEXT NOT NULL CHECK(length(request_key_hash)=64), request_hash TEXT NOT NULL CHECK(length(request_hash)=64),
 expected_revision INTEGER NOT NULL, resulting_revision INTEGER NOT NULL,
 decision TEXT NOT NULL CHECK(decision IN ('approved','rejected')), reason TEXT NOT NULL CHECK(length(reason)<=1000),
 created_at TEXT NOT NULL, UNIQUE(reviewer_subject,request_key_hash)
);
CREATE TABLE platform_creator_entitlements (
 tool_id TEXT PRIMARY KEY, creator_id TEXT NOT NULL REFERENCES platform_creators(creator_id),
 submission_id TEXT NOT NULL UNIQUE REFERENCES platform_tool_submissions(submission_id),
 share_bps INTEGER NOT NULL CHECK(share_bps=9000), revenue_basis TEXT NOT NULL CHECK(revenue_basis='gross'),
 approved_at TEXT NOT NULL, installed_adapter TEXT,
 UNIQUE(tool_id,creator_id,share_bps)
);
CREATE TABLE platform_submission_refund_obligations (
 submission_id TEXT PRIMARY KEY REFERENCES platform_tool_submissions(submission_id),
 paid_fee_atomic TEXT NOT NULL, refund_due_atomic TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('no_fee_paid','transfer_required')), created_at TEXT NOT NULL
);
CREATE TRIGGER platform_decision_apply AFTER INSERT ON platform_submission_decisions
BEGIN
 SELECT RAISE(ABORT,'submission_revision_conflict') WHERE NEW.resulting_revision<>NEW.expected_revision+1
 OR NOT EXISTS(SELECT 1 FROM platform_tool_submissions WHERE submission_id=NEW.submission_id AND state='pending' AND revision=NEW.expected_revision);
 UPDATE platform_tool_submissions SET state=NEW.decision,revision=NEW.resulting_revision,
 refund_due_atomic=IIF(NEW.decision='rejected',paid_fee_atomic,NULL) WHERE submission_id=NEW.submission_id;
 INSERT INTO platform_creator_entitlements(tool_id,creator_id,submission_id,share_bps,revenue_basis,approved_at)
 SELECT tool_id,creator_id,submission_id,share_bps,revenue_basis,NEW.created_at FROM platform_tool_submissions WHERE submission_id=NEW.submission_id AND NEW.decision='approved';
 INSERT INTO platform_submission_refund_obligations
 SELECT submission_id,paid_fee_atomic,paid_fee_atomic,IIF(paid_fee_atomic='0','no_fee_paid','transfer_required'),NEW.created_at
 FROM platform_tool_submissions WHERE submission_id=NEW.submission_id AND NEW.decision='rejected';
END;
CREATE TRIGGER platform_submission_immutable BEFORE UPDATE OF submission_id,creator_id,tool_id,request_key_hash,request_hash,proposal_json,terms_json,terms_version,list_fee_atomic,discount_bps,charged_fee_atomic,paid_fee_atomic,share_bps,revenue_basis,created_at,client_hash ON platform_tool_submissions
BEGIN SELECT RAISE(ABORT,'immutable_submission'); END;
CREATE TRIGGER platform_submission_state_guard BEFORE UPDATE OF state,revision,refund_due_atomic ON platform_tool_submissions
BEGIN
 SELECT RAISE(ABORT,'decision_required') WHERE OLD.state<>'pending' OR NOT EXISTS(
 SELECT 1 FROM platform_submission_decisions WHERE submission_id=OLD.submission_id AND expected_revision=OLD.revision
 AND resulting_revision=NEW.revision AND decision=NEW.state)
 OR (NEW.state='approved' AND NEW.refund_due_atomic IS NOT NULL)
 OR (NEW.state='rejected' AND NEW.refund_due_atomic IS NOT OLD.paid_fee_atomic);
END;
CREATE TRIGGER platform_entitlement_insert_guard BEFORE INSERT ON platform_creator_entitlements
BEGIN
 SELECT RAISE(ABORT,'approved_decision_required') WHERE NEW.installed_adapter IS NOT NULL OR NOT EXISTS(
 SELECT 1 FROM platform_tool_submissions s JOIN platform_submission_decisions d USING(submission_id)
 WHERE s.submission_id=NEW.submission_id AND s.state='approved' AND d.decision='approved'
 AND s.tool_id=NEW.tool_id AND s.creator_id=NEW.creator_id AND s.share_bps=NEW.share_bps AND s.revenue_basis=NEW.revenue_basis AND d.created_at=NEW.approved_at);
END;
CREATE TRIGGER platform_entitlement_immutable BEFORE UPDATE OF tool_id,creator_id,submission_id,share_bps,revenue_basis,approved_at ON platform_creator_entitlements
BEGIN SELECT RAISE(ABORT,'immutable_entitlement'); END;
CREATE TRIGGER platform_refund_insert_guard BEFORE INSERT ON platform_submission_refund_obligations
BEGIN
 SELECT RAISE(ABORT,'rejected_decision_required') WHERE NOT EXISTS(
 SELECT 1 FROM platform_tool_submissions s JOIN platform_submission_decisions d USING(submission_id)
 WHERE s.submission_id=NEW.submission_id AND s.state='rejected' AND d.decision='rejected'
 AND s.paid_fee_atomic=NEW.paid_fee_atomic AND s.refund_due_atomic=NEW.refund_due_atomic
 AND NEW.status='no_fee_paid' AND NEW.refund_due_atomic='0' AND d.created_at=NEW.created_at);
END;
CREATE TRIGGER platform_creator_no_update BEFORE UPDATE ON platform_creators BEGIN SELECT RAISE(ABORT,'immutable_creator'); END;
CREATE TRIGGER platform_creator_no_delete BEFORE DELETE ON platform_creators BEGIN SELECT RAISE(ABORT,'append_only'); END;
CREATE TRIGGER platform_submission_no_delete BEFORE DELETE ON platform_tool_submissions BEGIN SELECT RAISE(ABORT,'append_only'); END;
CREATE TRIGGER platform_decision_no_update BEFORE UPDATE ON platform_submission_decisions BEGIN SELECT RAISE(ABORT,'append_only'); END;
CREATE TRIGGER platform_decision_no_delete BEFORE DELETE ON platform_submission_decisions BEGIN SELECT RAISE(ABORT,'append_only'); END;
CREATE TRIGGER platform_entitlement_no_delete BEFORE DELETE ON platform_creator_entitlements BEGIN SELECT RAISE(ABORT,'append_only'); END;
CREATE TRIGGER platform_refund_no_update BEFORE UPDATE ON platform_submission_refund_obligations BEGIN SELECT RAISE(ABORT,'append_only'); END;
CREATE TRIGGER platform_refund_no_delete BEFORE DELETE ON platform_submission_refund_obligations BEGIN SELECT RAISE(ABORT,'append_only'); END;

ALTER TABLE platform_payments ADD COLUMN creator_tool_id TEXT;
ALTER TABLE platform_payments ADD COLUMN creator_id TEXT;
ALTER TABLE platform_payments ADD COLUMN creator_share_bps INTEGER;
CREATE TRIGGER platform_payment_creator_guard BEFORE INSERT ON platform_payments
BEGIN
 SELECT RAISE(ABORT,'invalid_creator_beneficiary') WHERE
 NOT (NEW.creator_tool_id IS NULL AND NEW.creator_id IS NULL AND NEW.creator_share_bps IS NULL)
 AND NOT EXISTS(SELECT 1 FROM platform_creator_entitlements WHERE tool_id=NEW.creator_tool_id AND tool_id=NEW.product_id
 AND creator_id=NEW.creator_id AND share_bps=NEW.creator_share_bps AND installed_adapter IS NOT NULL);
END;
CREATE TRIGGER platform_payment_creator_immutable BEFORE UPDATE OF creator_tool_id,creator_id,creator_share_bps ON platform_payments
BEGIN SELECT RAISE(ABORT,'immutable_creator_beneficiary'); END;
CREATE TABLE platform_live_receipts (
 operation_id TEXT PRIMARY KEY REFERENCES platform_payments(operation_id), product_id TEXT NOT NULL, version TEXT NOT NULL,
 network TEXT NOT NULL, asset TEXT NOT NULL, gross_atomic TEXT NOT NULL, transaction_hash TEXT NOT NULL, settled_at TEXT NOT NULL,
 creator_tool_id TEXT, creator_id TEXT, creator_share_bps INTEGER,
 FOREIGN KEY(creator_tool_id,creator_id,creator_share_bps) REFERENCES platform_creator_entitlements(tool_id,creator_id,share_bps)
);
CREATE TABLE platform_creator_allocations (
 operation_id TEXT PRIMARY KEY REFERENCES platform_live_receipts(operation_id), tool_id TEXT NOT NULL,
 creator_id TEXT NOT NULL, share_bps INTEGER NOT NULL CHECK(share_bps=9000), gross_atomic TEXT NOT NULL, created_at TEXT NOT NULL,
 FOREIGN KEY(tool_id,creator_id,share_bps) REFERENCES platform_creator_entitlements(tool_id,creator_id,share_bps)
);
CREATE INDEX platform_creator_allocation_lookup ON platform_creator_allocations(tool_id,operation_id);
CREATE TRIGGER platform_live_receipt_insert_guard BEFORE INSERT ON platform_live_receipts
BEGIN
 SELECT RAISE(ABORT,'authoritative_receipt_required') WHERE NOT EXISTS(
 SELECT 1 FROM platform_payments p JOIN platform_payment_ledger l ON l.operation_id=p.operation_id
 WHERE p.operation_id=NEW.operation_id AND p.state='settled' AND p.is_live=1 AND l.event='settlement_reported'
 AND p.product_id=NEW.product_id AND p.version=NEW.version AND p.network=NEW.network AND p.asset=NEW.asset
 AND p.amount_atomic=NEW.gross_atomic AND l.amount_atomic=NEW.gross_atomic AND l.transaction_hash=NEW.transaction_hash
 AND l.product_id=NEW.product_id AND l.version=NEW.version AND l.network=NEW.network AND lower(l.asset)=lower(NEW.asset)
 AND p.updated_at=NEW.settled_at AND p.creator_tool_id IS NEW.creator_tool_id AND p.creator_id IS NEW.creator_id AND p.creator_share_bps IS NEW.creator_share_bps
 AND EXISTS(SELECT 1 FROM platform_payment_ledger v WHERE v.operation_id=p.operation_id AND v.event='outcome_validated'));
END;
CREATE TRIGGER platform_creator_allocation_insert_guard BEFORE INSERT ON platform_creator_allocations
BEGIN
 SELECT RAISE(ABORT,'authoritative_allocation_required') WHERE NOT EXISTS(
 SELECT 1 FROM platform_live_receipts WHERE operation_id=NEW.operation_id AND creator_tool_id=NEW.tool_id AND creator_id=NEW.creator_id
 AND creator_share_bps=NEW.share_bps AND gross_atomic=NEW.gross_atomic AND settled_at=NEW.created_at);
END;
-- is_live is trusted server config. sample_kind is buyer controlled and NEVER used here.
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
END;
CREATE TRIGGER platform_allocate_creator AFTER INSERT ON platform_live_receipts WHEN NEW.creator_tool_id IS NOT NULL
BEGIN
 INSERT INTO platform_creator_allocations VALUES(NEW.operation_id,NEW.creator_tool_id,NEW.creator_id,NEW.creator_share_bps,NEW.gross_atomic,NEW.settled_at);
END;
CREATE TRIGGER platform_receipt_no_update BEFORE UPDATE ON platform_live_receipts BEGIN SELECT RAISE(ABORT,'append_only'); END;
CREATE TRIGGER platform_receipt_no_delete BEFORE DELETE ON platform_live_receipts BEGIN SELECT RAISE(ABORT,'append_only'); END;
CREATE TRIGGER platform_allocation_no_update BEFORE UPDATE ON platform_creator_allocations BEGIN SELECT RAISE(ABORT,'append_only'); END;
CREATE TRIGGER platform_allocation_no_delete BEFORE DELETE ON platform_creator_allocations BEGIN SELECT RAISE(ABORT,'append_only'); END;
