-- Private immutable destination claims. No payment authorization or execution.
CREATE TABLE platform_creator_wallet_claims (
 claim_id TEXT PRIMARY KEY, creator_id TEXT NOT NULL REFERENCES platform_creators(creator_id),
 revision INTEGER NOT NULL CHECK(revision>0), expected_revision INTEGER NOT NULL CHECK(expected_revision>=0),
 network TEXT NOT NULL CHECK(network='eip155:8453'), address TEXT NOT NULL,
 request_key_hash TEXT NOT NULL, request_hash TEXT NOT NULL, created_at TEXT NOT NULL,
 UNIQUE(creator_id,revision), UNIQUE(creator_id,request_key_hash)
);
CREATE TABLE platform_creator_wallet_challenges (
 challenge_id TEXT PRIMARY KEY, creator_id TEXT NOT NULL REFERENCES platform_creators(creator_id),
 claim_id TEXT NOT NULL REFERENCES platform_creator_wallet_claims(claim_id), claim_revision INTEGER NOT NULL,
 address TEXT NOT NULL, origin TEXT NOT NULL, message TEXT NOT NULL, nonce TEXT NOT NULL UNIQUE,
 request_key_hash TEXT NOT NULL, request_hash TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
 UNIQUE(creator_id,request_key_hash)
);
CREATE TABLE platform_creator_wallet_proofs (
 proof_id TEXT PRIMARY KEY, creator_id TEXT NOT NULL REFERENCES platform_creators(creator_id),
 claim_id TEXT NOT NULL REFERENCES platform_creator_wallet_claims(claim_id),
 challenge_id TEXT NOT NULL UNIQUE REFERENCES platform_creator_wallet_challenges(challenge_id),
 proof_hash TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE platform_creator_wallet_approvals (
 approval_id TEXT PRIMARY KEY, claim_id TEXT NOT NULL UNIQUE REFERENCES platform_creator_wallet_claims(claim_id),
 reviewer TEXT NOT NULL, request_key_hash TEXT NOT NULL, request_hash TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(reviewer,request_key_hash)
);
CREATE TRIGGER wallet_claim_cas BEFORE INSERT ON platform_creator_wallet_claims BEGIN
 SELECT RAISE(ABORT,'wallet_revision_conflict') WHERE NEW.revision<>NEW.expected_revision+1 OR NEW.expected_revision<>COALESCE((SELECT MAX(revision) FROM platform_creator_wallet_claims WHERE creator_id=NEW.creator_id),0);
END;
CREATE TRIGGER wallet_challenge_current BEFORE INSERT ON platform_creator_wallet_challenges BEGIN
 SELECT RAISE(ABORT,'wallet_revision_conflict') WHERE NOT EXISTS(SELECT 1 FROM platform_creator_wallet_claims c WHERE c.claim_id=NEW.claim_id AND c.creator_id=NEW.creator_id AND c.revision=NEW.claim_revision AND c.address=NEW.address AND c.revision=(SELECT MAX(revision) FROM platform_creator_wallet_claims WHERE creator_id=c.creator_id));
END;
CREATE TRIGGER wallet_proof_current BEFORE INSERT ON platform_creator_wallet_proofs BEGIN
 SELECT RAISE(ABORT,'wallet_proof_conflict') WHERE NOT EXISTS(SELECT 1 FROM platform_creator_wallet_challenges h JOIN platform_creator_wallet_claims c ON c.claim_id=h.claim_id WHERE h.challenge_id=NEW.challenge_id AND h.creator_id=NEW.creator_id AND h.claim_id=NEW.claim_id AND NEW.created_at>=h.created_at AND NEW.created_at<h.expires_at AND c.revision=(SELECT MAX(revision) FROM platform_creator_wallet_claims WHERE creator_id=c.creator_id));
END;
CREATE TRIGGER wallet_approval_valid BEFORE INSERT ON platform_creator_wallet_approvals BEGIN
 SELECT RAISE(ABORT,'wallet_approval_conflict') WHERE NOT EXISTS(SELECT 1 FROM platform_creator_wallet_claims c JOIN platform_creator_wallet_proofs p ON p.claim_id=c.claim_id WHERE c.claim_id=NEW.claim_id AND c.revision=(SELECT MAX(revision) FROM platform_creator_wallet_claims WHERE creator_id=c.creator_id));
END;
CREATE TRIGGER wallet_claims_no_update BEFORE UPDATE ON platform_creator_wallet_claims BEGIN SELECT RAISE(ABORT,'immutable_wallet_audit'); END;
CREATE TRIGGER wallet_claims_no_delete BEFORE DELETE ON platform_creator_wallet_claims BEGIN SELECT RAISE(ABORT,'immutable_wallet_audit'); END;
CREATE TRIGGER wallet_challenges_no_update BEFORE UPDATE ON platform_creator_wallet_challenges BEGIN SELECT RAISE(ABORT,'immutable_wallet_audit'); END;
CREATE TRIGGER wallet_challenges_no_delete BEFORE DELETE ON platform_creator_wallet_challenges BEGIN SELECT RAISE(ABORT,'immutable_wallet_audit'); END;
CREATE TRIGGER wallet_proofs_no_update BEFORE UPDATE ON platform_creator_wallet_proofs BEGIN SELECT RAISE(ABORT,'immutable_wallet_audit'); END;
CREATE TRIGGER wallet_proofs_no_delete BEFORE DELETE ON platform_creator_wallet_proofs BEGIN SELECT RAISE(ABORT,'immutable_wallet_audit'); END;
CREATE TRIGGER wallet_approvals_no_update BEFORE UPDATE ON platform_creator_wallet_approvals BEGIN SELECT RAISE(ABORT,'immutable_wallet_audit'); END;
CREATE TRIGGER wallet_approvals_no_delete BEFORE DELETE ON platform_creator_wallet_approvals BEGIN SELECT RAISE(ABORT,'immutable_wallet_audit'); END;
CREATE INDEX wallet_claims_creator_date ON platform_creator_wallet_claims(creator_id,created_at);
CREATE INDEX wallet_claims_date ON platform_creator_wallet_claims(created_at);
CREATE INDEX wallet_challenges_creator_date ON platform_creator_wallet_challenges(creator_id,created_at);
CREATE INDEX wallet_challenges_date ON platform_creator_wallet_challenges(created_at);
CREATE INDEX wallet_proofs_creator_date ON platform_creator_wallet_proofs(creator_id,created_at);
CREATE INDEX wallet_proofs_date ON platform_creator_wallet_proofs(created_at);
CREATE TRIGGER wallet_claims_budget BEFORE INSERT ON platform_creator_wallet_claims BEGIN
 SELECT RAISE(ABORT,'wallet_budget_exhausted') WHERE (SELECT COUNT(*) FROM platform_creator_wallet_claims WHERE creator_id=NEW.creator_id AND created_at>=substr(NEW.created_at,1,10)||'T00:00:00.000Z' AND created_at<strftime('%Y-%m-%d',NEW.created_at,'+1 day')||'T00:00:00.000Z')+(SELECT COUNT(*) FROM platform_creator_wallet_challenges WHERE creator_id=NEW.creator_id AND created_at>=substr(NEW.created_at,1,10)||'T00:00:00.000Z' AND created_at<strftime('%Y-%m-%d',NEW.created_at,'+1 day')||'T00:00:00.000Z')+(SELECT COUNT(*) FROM platform_creator_wallet_proofs WHERE creator_id=NEW.creator_id AND created_at>=substr(NEW.created_at,1,10)||'T00:00:00.000Z' AND created_at<strftime('%Y-%m-%d',NEW.created_at,'+1 day')||'T00:00:00.000Z')>=10 OR (SELECT COUNT(*) FROM platform_creator_wallet_claims WHERE created_at>=substr(NEW.created_at,1,10)||'T00:00:00.000Z' AND created_at<strftime('%Y-%m-%d',NEW.created_at,'+1 day')||'T00:00:00.000Z')+(SELECT COUNT(*) FROM platform_creator_wallet_challenges WHERE created_at>=substr(NEW.created_at,1,10)||'T00:00:00.000Z' AND created_at<strftime('%Y-%m-%d',NEW.created_at,'+1 day')||'T00:00:00.000Z')+(SELECT COUNT(*) FROM platform_creator_wallet_proofs WHERE created_at>=substr(NEW.created_at,1,10)||'T00:00:00.000Z' AND created_at<strftime('%Y-%m-%d',NEW.created_at,'+1 day')||'T00:00:00.000Z')>=1000;
END;
CREATE TRIGGER wallet_challenges_budget BEFORE INSERT ON platform_creator_wallet_challenges BEGIN
 SELECT RAISE(ABORT,'wallet_budget_exhausted') WHERE (SELECT COUNT(*) FROM platform_creator_wallet_claims WHERE creator_id=NEW.creator_id AND created_at>=substr(NEW.created_at,1,10)||'T00:00:00.000Z' AND created_at<strftime('%Y-%m-%d',NEW.created_at,'+1 day')||'T00:00:00.000Z')+(SELECT COUNT(*) FROM platform_creator_wallet_challenges WHERE creator_id=NEW.creator_id AND created_at>=substr(NEW.created_at,1,10)||'T00:00:00.000Z' AND created_at<strftime('%Y-%m-%d',NEW.created_at,'+1 day')||'T00:00:00.000Z')+(SELECT COUNT(*) FROM platform_creator_wallet_proofs WHERE creator_id=NEW.creator_id AND created_at>=substr(NEW.created_at,1,10)||'T00:00:00.000Z' AND created_at<strftime('%Y-%m-%d',NEW.created_at,'+1 day')||'T00:00:00.000Z')>=10 OR (SELECT COUNT(*) FROM platform_creator_wallet_claims WHERE created_at>=substr(NEW.created_at,1,10)||'T00:00:00.000Z' AND created_at<strftime('%Y-%m-%d',NEW.created_at,'+1 day')||'T00:00:00.000Z')+(SELECT COUNT(*) FROM platform_creator_wallet_challenges WHERE created_at>=substr(NEW.created_at,1,10)||'T00:00:00.000Z' AND created_at<strftime('%Y-%m-%d',NEW.created_at,'+1 day')||'T00:00:00.000Z')+(SELECT COUNT(*) FROM platform_creator_wallet_proofs WHERE created_at>=substr(NEW.created_at,1,10)||'T00:00:00.000Z' AND created_at<strftime('%Y-%m-%d',NEW.created_at,'+1 day')||'T00:00:00.000Z')>=1000;
END;
CREATE TRIGGER wallet_proofs_budget BEFORE INSERT ON platform_creator_wallet_proofs BEGIN
 SELECT RAISE(ABORT,'wallet_budget_exhausted') WHERE (SELECT COUNT(*) FROM platform_creator_wallet_claims WHERE creator_id=NEW.creator_id AND created_at>=substr(NEW.created_at,1,10)||'T00:00:00.000Z' AND created_at<strftime('%Y-%m-%d',NEW.created_at,'+1 day')||'T00:00:00.000Z')+(SELECT COUNT(*) FROM platform_creator_wallet_challenges WHERE creator_id=NEW.creator_id AND created_at>=substr(NEW.created_at,1,10)||'T00:00:00.000Z' AND created_at<strftime('%Y-%m-%d',NEW.created_at,'+1 day')||'T00:00:00.000Z')+(SELECT COUNT(*) FROM platform_creator_wallet_proofs WHERE creator_id=NEW.creator_id AND created_at>=substr(NEW.created_at,1,10)||'T00:00:00.000Z' AND created_at<strftime('%Y-%m-%d',NEW.created_at,'+1 day')||'T00:00:00.000Z')>=10 OR (SELECT COUNT(*) FROM platform_creator_wallet_claims WHERE created_at>=substr(NEW.created_at,1,10)||'T00:00:00.000Z' AND created_at<strftime('%Y-%m-%d',NEW.created_at,'+1 day')||'T00:00:00.000Z')+(SELECT COUNT(*) FROM platform_creator_wallet_challenges WHERE created_at>=substr(NEW.created_at,1,10)||'T00:00:00.000Z' AND created_at<strftime('%Y-%m-%d',NEW.created_at,'+1 day')||'T00:00:00.000Z')+(SELECT COUNT(*) FROM platform_creator_wallet_proofs WHERE created_at>=substr(NEW.created_at,1,10)||'T00:00:00.000Z' AND created_at<strftime('%Y-%m-%d',NEW.created_at,'+1 day')||'T00:00:00.000Z')>=1000;
END;
