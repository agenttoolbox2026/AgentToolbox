-- Private beneficiary requests do not reserve or transfer funds.
CREATE TABLE platform_payout_requests (
 request_id TEXT PRIMARY KEY CHECK(length(request_id)=36),
 beneficiary_kind TEXT NOT NULL CHECK(beneficiary_kind IN ('creator','referral')),
 subject_id TEXT NOT NULL, owner_id TEXT NOT NULL,
 amount_atomic TEXT NOT NULL CHECK(length(amount_atomic) BETWEEN 1 AND 78 AND amount_atomic NOT GLOB '*[^0-9]*' AND substr(amount_atomic,1,1) BETWEEN '1' AND '9'),
 network TEXT NOT NULL CHECK(network='eip155:8453'), asset TEXT NOT NULL CHECK(asset='0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'),
 claim_id TEXT NOT NULL, claim_revision INTEGER NOT NULL CHECK(claim_revision>0),
 request_hash TEXT NOT NULL CHECK(length(request_hash)=64), created_at TEXT NOT NULL
);
CREATE INDEX payout_request_history ON platform_payout_requests(beneficiary_kind,subject_id,created_at,request_id);
CREATE INDEX payout_request_owner_budget ON platform_payout_requests(beneficiary_kind,owner_id,created_at);
CREATE INDEX payout_request_global_budget ON platform_payout_requests(created_at);
CREATE TRIGGER payout_request_admission BEFORE INSERT ON platform_payout_requests BEGIN
 SELECT RAISE(ABORT,'invalid_payout_request_claim') WHERE
 (NEW.beneficiary_kind='creator' AND NOT EXISTS(SELECT 1 FROM platform_creator_entitlements e JOIN platform_creator_wallet_claims c USING(creator_id) WHERE e.tool_id=NEW.subject_id AND e.creator_id=NEW.owner_id AND c.claim_id=NEW.claim_id AND c.revision=NEW.claim_revision AND c.network=NEW.network AND c.revision=(SELECT max(revision) FROM platform_creator_wallet_claims WHERE creator_id=e.creator_id)))
 OR (NEW.beneficiary_kind='referral' AND NOT EXISTS(SELECT 1 FROM platform_referral_wallet_claims c WHERE c.referral_code=NEW.subject_id AND c.referral_code=NEW.owner_id AND c.claim_id=NEW.claim_id AND c.revision=NEW.claim_revision AND c.network=NEW.network AND c.revision=(SELECT max(revision) FROM platform_referral_wallet_claims WHERE referral_code=NEW.subject_id)));
 SELECT RAISE(ABORT,'payout_request_budget_exhausted') WHERE
 (SELECT count(*) FROM platform_payout_requests WHERE beneficiary_kind=NEW.beneficiary_kind AND owner_id=NEW.owner_id AND created_at>=substr(NEW.created_at,1,10)||'T00:00:00.000Z' AND created_at<strftime('%Y-%m-%d',NEW.created_at,'+1 day')||'T00:00:00.000Z')>=10
 OR (SELECT count(*) FROM platform_payout_requests WHERE created_at>=substr(NEW.created_at,1,10)||'T00:00:00.000Z' AND created_at<strftime('%Y-%m-%d',NEW.created_at,'+1 day')||'T00:00:00.000Z')>=1000;
END;
CREATE TABLE platform_payout_request_links (
 request_id TEXT PRIMARY KEY REFERENCES platform_payout_requests(request_id),
 beneficiary_kind TEXT NOT NULL CHECK(beneficiary_kind IN ('creator','referral')),
 payout_id TEXT NOT NULL, created_at TEXT NOT NULL,
 UNIQUE(beneficiary_kind,payout_id)
);
CREATE TRIGGER payout_request_link_guard BEFORE INSERT ON platform_payout_request_links BEGIN
 SELECT RAISE(ABORT,'payout_request_link_conflict') WHERE NOT EXISTS(
 SELECT 1 FROM platform_payout_requests r WHERE r.request_id=NEW.request_id AND r.beneficiary_kind=NEW.beneficiary_kind AND (
 (r.beneficiary_kind='creator' AND EXISTS(SELECT 1 FROM platform_creator_payouts p WHERE p.payout_id=NEW.payout_id AND p.state='reserved' AND p.revision=0 AND p.tool_id=r.subject_id AND p.creator_id=r.owner_id AND p.amount_atomic=r.amount_atomic AND p.claim_id=r.claim_id AND p.claim_revision=r.claim_revision AND p.network=r.network AND p.asset=r.asset))
 OR (r.beneficiary_kind='referral' AND EXISTS(SELECT 1 FROM platform_referral_payouts p WHERE p.payout_id=NEW.payout_id AND p.state='reserved' AND p.revision=0 AND p.referral_code=r.subject_id AND p.referral_code=r.owner_id AND p.amount_atomic=r.amount_atomic AND p.claim_id=r.claim_id AND p.claim_revision=r.claim_revision AND p.network=r.network AND p.asset=r.asset))));
END;
CREATE TRIGGER payout_request_no_update BEFORE UPDATE ON platform_payout_requests BEGIN SELECT RAISE(ABORT,'immutable_payout_request'); END;
CREATE TRIGGER payout_request_no_delete BEFORE DELETE ON platform_payout_requests BEGIN SELECT RAISE(ABORT,'immutable_payout_request'); END;
CREATE TRIGGER payout_request_link_no_update BEFORE UPDATE ON platform_payout_request_links BEGIN SELECT RAISE(ABORT,'immutable_payout_request'); END;
CREATE TRIGGER payout_request_link_no_delete BEFORE DELETE ON platform_payout_request_links BEGIN SELECT RAISE(ABORT,'immutable_payout_request'); END;
