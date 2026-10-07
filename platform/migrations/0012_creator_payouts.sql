-- Additive payout planning and independently reconciled evidence. Never sends money.
CREATE TABLE platform_creator_payout_batches (
 batch_id TEXT PRIMARY KEY, reviewer_subject TEXT NOT NULL CHECK(length(reviewer_subject) BETWEEN 1 AND 256),
 request_key_hash TEXT NOT NULL CHECK(length(request_key_hash)=64), request_hash TEXT NOT NULL CHECK(length(request_hash)=64),
 created_at TEXT NOT NULL, UNIQUE(reviewer_subject,request_key_hash)
);
CREATE TABLE platform_creator_payouts (
 payout_id TEXT PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES platform_creator_payout_batches(batch_id),
 tool_id TEXT NOT NULL, creator_id TEXT NOT NULL, share_bps INTEGER NOT NULL CHECK(share_bps=9000),
 claim_id TEXT NOT NULL REFERENCES platform_creator_wallet_claims(claim_id), claim_revision INTEGER NOT NULL,
 network TEXT NOT NULL CHECK(network='eip155:8453'), asset TEXT NOT NULL CHECK(asset='0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'),
 source_address TEXT NOT NULL CHECK(length(source_address)=42), destination_address TEXT NOT NULL CHECK(length(destination_address)=42),
 amount_atomic TEXT NOT NULL CHECK(length(amount_atomic) BETWEEN 1 AND 78 AND amount_atomic NOT GLOB '*[^0-9]*' AND substr(amount_atomic,1,1) BETWEEN '1' AND '9'),
 gross_snapshot_atomic TEXT NOT NULL, accrued_snapshot_atomic TEXT NOT NULL, paid_snapshot_atomic TEXT NOT NULL, paid_snapshot_count INTEGER NOT NULL CHECK(paid_snapshot_count>=0),
 snapshot_hash TEXT NOT NULL CHECK(length(snapshot_hash)=64), snapshot_receipt_count INTEGER NOT NULL CHECK(snapshot_receipt_count BETWEEN 1 AND 5000),
 state TEXT NOT NULL DEFAULT 'reserved' CHECK(state IN ('reserved','awaiting_owner','submitted','unknown','paid','cancelled')),
 revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0), created_at TEXT NOT NULL,
 FOREIGN KEY(tool_id,creator_id,share_bps) REFERENCES platform_creator_entitlements(tool_id,creator_id,share_bps),
 UNIQUE(batch_id,tool_id)
);
-- One unresolved proposal per entitlement is deliberately conservative and prevents
-- two workers from reserving a balance observed before either transaction commits.
CREATE UNIQUE INDEX platform_payout_active_entitlement ON platform_creator_payouts(tool_id,network,asset)
 WHERE state IN ('reserved','awaiting_owner','submitted','unknown');
CREATE INDEX platform_payout_creator_history ON platform_creator_payouts(creator_id,created_at,payout_id);
CREATE TABLE platform_creator_payout_transactions (
 transaction_hash TEXT PRIMARY KEY CHECK(length(transaction_hash)=66), payout_id TEXT NOT NULL REFERENCES platform_creator_payouts(payout_id),
 nonce TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE platform_creator_payout_evidence (
 evidence_id TEXT PRIMARY KEY, payout_id TEXT NOT NULL UNIQUE REFERENCES platform_creator_payouts(payout_id),
 network TEXT NOT NULL CHECK(network='eip155:8453'), asset TEXT NOT NULL,
 transaction_hash TEXT NOT NULL REFERENCES platform_creator_payout_transactions(transaction_hash), log_index TEXT NOT NULL,
 block_number TEXT NOT NULL, block_hash TEXT NOT NULL, finalized_block_number TEXT NOT NULL,
 source_address TEXT NOT NULL, destination_address TEXT NOT NULL, amount_atomic TEXT NOT NULL,
 evidence_hash TEXT NOT NULL CHECK(length(evidence_hash)=64), checked_at TEXT NOT NULL,
 UNIQUE(network,transaction_hash,log_index)
);
CREATE TABLE platform_creator_payout_events (
 event_id TEXT PRIMARY KEY, payout_id TEXT NOT NULL REFERENCES platform_creator_payouts(payout_id),
 reviewer_subject TEXT NOT NULL CHECK(length(reviewer_subject) BETWEEN 1 AND 256),
 request_key_hash TEXT NOT NULL CHECK(length(request_key_hash)=64), request_hash TEXT NOT NULL CHECK(length(request_hash)=64),
 expected_revision INTEGER NOT NULL, resulting_revision INTEGER NOT NULL,
 event TEXT NOT NULL CHECK(event IN ('authorize','submitted','unknown','confirmed','cancelled')),
 transaction_hash TEXT, evidence_id TEXT REFERENCES platform_creator_payout_evidence(evidence_id), created_at TEXT NOT NULL,
 UNIQUE(reviewer_subject,request_key_hash)
);
CREATE TRIGGER platform_payout_insert_guard BEFORE INSERT ON platform_creator_payouts BEGIN
 SELECT RAISE(ABORT,'invalid_payout_reservation') WHERE NEW.state<>'reserved' OR NEW.revision<>0
 OR NOT EXISTS(SELECT 1 FROM platform_creator_wallet_claims c JOIN platform_creator_wallet_approvals a USING(claim_id)
 JOIN platform_creator_wallet_proofs v USING(claim_id) WHERE c.claim_id=NEW.claim_id AND c.creator_id=NEW.creator_id
 AND c.revision=NEW.claim_revision AND c.network=NEW.network AND lower(c.address)=NEW.destination_address
 AND c.revision=(SELECT max(revision) FROM platform_creator_wallet_claims WHERE creator_id=c.creator_id))
 OR (SELECT count(*) FROM platform_creator_payouts WHERE batch_id=NEW.batch_id)>=20
 OR (SELECT count(*) FROM platform_creator_payouts WHERE tool_id=NEW.tool_id AND state='paid')<>NEW.paid_snapshot_count;
END;
CREATE TRIGGER platform_wallet_reserved_guard BEFORE INSERT ON platform_creator_wallet_claims BEGIN
 SELECT RAISE(ABORT,'wallet_has_reserved_payout') WHERE EXISTS(SELECT 1 FROM platform_creator_payouts WHERE creator_id=NEW.creator_id AND state IN ('reserved','awaiting_owner','submitted','unknown'));
END;
CREATE TRIGGER platform_payout_transaction_guard BEFORE INSERT ON platform_creator_payout_transactions BEGIN
 SELECT RAISE(ABORT,'payout_transaction_conflict') WHERE NOT EXISTS(SELECT 1 FROM platform_creator_payouts WHERE payout_id=NEW.payout_id AND state IN ('awaiting_owner','submitted','unknown'))
 OR EXISTS(SELECT 1 FROM platform_creator_payout_transactions WHERE payout_id=NEW.payout_id AND nonce<>NEW.nonce)
 OR (SELECT count(*) FROM platform_creator_payout_transactions WHERE payout_id=NEW.payout_id)>=20;
END;
CREATE TRIGGER platform_payout_evidence_guard BEFORE INSERT ON platform_creator_payout_evidence BEGIN
 SELECT RAISE(ABORT,'payout_evidence_mismatch') WHERE NOT EXISTS(
 SELECT 1 FROM platform_creator_payouts p JOIN platform_creator_payout_transactions t ON t.payout_id=p.payout_id
 WHERE p.payout_id=NEW.payout_id AND p.state IN ('submitted','unknown') AND t.transaction_hash=NEW.transaction_hash
 AND p.network=NEW.network AND p.asset=NEW.asset AND p.source_address=NEW.source_address
 AND p.destination_address=NEW.destination_address AND p.amount_atomic=NEW.amount_atomic);
END;
CREATE TRIGGER platform_payout_event_apply AFTER INSERT ON platform_creator_payout_events BEGIN
 SELECT RAISE(ABORT,'payout_revision_conflict') WHERE NEW.resulting_revision<>NEW.expected_revision+1
 OR NOT EXISTS(SELECT 1 FROM platform_creator_payouts WHERE payout_id=NEW.payout_id AND revision=NEW.expected_revision AND (
 (NEW.event='authorize' AND state='reserved') OR (NEW.event='cancelled' AND state='reserved')
 OR (NEW.event='submitted' AND state IN ('awaiting_owner','submitted','unknown') AND EXISTS(SELECT 1 FROM platform_creator_payout_transactions WHERE payout_id=NEW.payout_id AND transaction_hash=NEW.transaction_hash))
 OR (NEW.event='unknown' AND state IN ('awaiting_owner','submitted','unknown'))
 OR (NEW.event='confirmed' AND state IN ('submitted','unknown') AND EXISTS(SELECT 1 FROM platform_creator_payout_evidence WHERE payout_id=NEW.payout_id AND evidence_id=NEW.evidence_id AND transaction_hash=NEW.transaction_hash))));
 UPDATE platform_creator_payouts SET state=CASE NEW.event WHEN 'authorize' THEN 'awaiting_owner' WHEN 'confirmed' THEN 'paid' ELSE NEW.event END,revision=NEW.resulting_revision WHERE payout_id=NEW.payout_id;
END;
CREATE TRIGGER platform_payout_state_guard BEFORE UPDATE OF state,revision ON platform_creator_payouts BEGIN
 SELECT RAISE(ABORT,'payout_event_required') WHERE NOT EXISTS(SELECT 1 FROM platform_creator_payout_events WHERE payout_id=OLD.payout_id AND expected_revision=OLD.revision AND resulting_revision=NEW.revision AND NEW.state=CASE event WHEN 'authorize' THEN 'awaiting_owner' WHEN 'confirmed' THEN 'paid' ELSE event END);
END;
CREATE TRIGGER platform_payout_immutable BEFORE UPDATE OF payout_id,batch_id,tool_id,creator_id,share_bps,claim_id,claim_revision,network,asset,source_address,destination_address,amount_atomic,gross_snapshot_atomic,accrued_snapshot_atomic,paid_snapshot_atomic,paid_snapshot_count,snapshot_hash,snapshot_receipt_count,created_at ON platform_creator_payouts BEGIN SELECT RAISE(ABORT,'immutable_payout'); END;
CREATE TRIGGER platform_payout_no_delete BEFORE DELETE ON platform_creator_payouts BEGIN SELECT RAISE(ABORT,'append_only'); END;
CREATE TRIGGER platform_payout_batch_no_update BEFORE UPDATE ON platform_creator_payout_batches BEGIN SELECT RAISE(ABORT,'append_only'); END;
CREATE TRIGGER platform_payout_batch_no_delete BEFORE DELETE ON platform_creator_payout_batches BEGIN SELECT RAISE(ABORT,'append_only'); END;
CREATE TRIGGER platform_payout_event_no_update BEFORE UPDATE ON platform_creator_payout_events BEGIN SELECT RAISE(ABORT,'append_only'); END;
CREATE TRIGGER platform_payout_event_no_delete BEFORE DELETE ON platform_creator_payout_events BEGIN SELECT RAISE(ABORT,'append_only'); END;
CREATE TRIGGER platform_payout_transaction_no_update BEFORE UPDATE ON platform_creator_payout_transactions BEGIN SELECT RAISE(ABORT,'append_only'); END;
CREATE TRIGGER platform_payout_transaction_no_delete BEFORE DELETE ON platform_creator_payout_transactions BEGIN SELECT RAISE(ABORT,'append_only'); END;
CREATE TRIGGER platform_payout_evidence_no_update BEFORE UPDATE ON platform_creator_payout_evidence BEGIN SELECT RAISE(ABORT,'append_only'); END;
CREATE TRIGGER platform_payout_evidence_no_delete BEFORE DELETE ON platform_creator_payout_evidence BEGIN SELECT RAISE(ABORT,'append_only'); END;
