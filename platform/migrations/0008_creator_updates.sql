-- Approved metadata versions only. No URL execution, installation or money transfer.
CREATE TABLE platform_tool_update_proposals (
 update_id TEXT PRIMARY KEY, tool_id TEXT NOT NULL REFERENCES platform_creator_entitlements(tool_id),
 creator_id TEXT NOT NULL REFERENCES platform_creators(creator_id), base_version TEXT NOT NULL,
 expected_head_revision INTEGER NOT NULL CHECK(expected_head_revision BETWEEN 0 AND 2147483646), proposed_version TEXT NOT NULL,
 request_key_hash TEXT NOT NULL, request_hash TEXT NOT NULL, proposal_json TEXT NOT NULL, terms_json TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','approved','rejected')),
 revision INTEGER NOT NULL DEFAULT 0 CHECK(revision IN (0,1)), created_at TEXT NOT NULL, client_hash TEXT NOT NULL,
 UNIQUE(tool_id,creator_id,request_key_hash),
 FOREIGN KEY(tool_id,base_version) REFERENCES platform_creator_tool_versions(tool_id,version)
);
CREATE INDEX platform_update_budget ON platform_tool_update_proposals(created_at,client_hash);
CREATE TABLE platform_tool_update_decisions (
 decision_id TEXT PRIMARY KEY, update_id TEXT NOT NULL UNIQUE REFERENCES platform_tool_update_proposals(update_id),
 reviewer_subject TEXT NOT NULL CHECK(length(reviewer_subject) BETWEEN 1 AND 256),
 request_key_hash TEXT NOT NULL CHECK(length(request_key_hash)=64), request_hash TEXT NOT NULL CHECK(length(request_hash)=64),
 expected_revision INTEGER NOT NULL, resulting_revision INTEGER NOT NULL, expected_head_revision INTEGER NOT NULL,
 decision TEXT NOT NULL CHECK(decision IN ('approved','rejected')), reason TEXT NOT NULL CHECK(length(reason)<=1000),
 created_at TEXT NOT NULL, UNIQUE(reviewer_subject,request_key_hash)
);
CREATE TABLE platform_creator_tool_versions (
 tool_id TEXT NOT NULL REFERENCES platform_creator_entitlements(tool_id), version TEXT NOT NULL,
 approved_revision INTEGER NOT NULL CHECK(approved_revision BETWEEN 0 AND 2147483647), proposal_json TEXT NOT NULL,
 source_submission_id TEXT REFERENCES platform_tool_submissions(submission_id), source_update_id TEXT REFERENCES platform_tool_update_proposals(update_id),
 approved_at TEXT NOT NULL, PRIMARY KEY(tool_id,version), UNIQUE(tool_id,approved_revision),
 CHECK((source_submission_id IS NOT NULL AND source_update_id IS NULL AND approved_revision=0 AND version='0.1.0')
 OR (source_submission_id IS NULL AND source_update_id IS NOT NULL AND approved_revision>0))
);
CREATE TABLE platform_creator_tool_heads (
 tool_id TEXT PRIMARY KEY REFERENCES platform_creator_entitlements(tool_id), current_version TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision BETWEEN 0 AND 2147483647), updated_at TEXT NOT NULL,
 FOREIGN KEY(tool_id,current_version) REFERENCES platform_creator_tool_versions(tool_id,version)
);
CREATE TRIGGER platform_update_admission_guard BEFORE INSERT ON platform_tool_update_proposals
BEGIN
 SELECT RAISE(ABORT,'tool_head_conflict') WHERE NEW.state<>'pending' OR NEW.revision<>0 OR NEW.proposed_version=NEW.base_version
 OR NOT EXISTS(SELECT 1 FROM platform_creator_entitlements e JOIN platform_tool_submissions s ON s.submission_id=e.submission_id
 JOIN platform_creator_tool_heads h ON h.tool_id=e.tool_id
 WHERE e.tool_id=NEW.tool_id AND e.creator_id=NEW.creator_id AND s.state='approved' AND s.terms_json=NEW.terms_json
 AND h.current_version=NEW.base_version AND h.revision=NEW.expected_head_revision);
END;
CREATE TRIGGER platform_version_insert_guard BEFORE INSERT ON platform_creator_tool_versions
BEGIN
 SELECT RAISE(ABORT,'metadata_decision_required') WHERE NOT (
 (NEW.source_submission_id IS NOT NULL AND EXISTS(SELECT 1 FROM platform_creator_entitlements e JOIN platform_tool_submissions s ON e.submission_id=s.submission_id
 JOIN platform_submission_decisions d ON d.submission_id=s.submission_id WHERE e.tool_id=NEW.tool_id AND s.submission_id=NEW.source_submission_id
 AND s.state='approved' AND d.decision='approved' AND s.proposal_json=NEW.proposal_json AND e.approved_at=NEW.approved_at))
 OR (NEW.source_update_id IS NOT NULL AND EXISTS(SELECT 1 FROM platform_tool_update_proposals p JOIN platform_tool_update_decisions d ON d.update_id=p.update_id
 WHERE p.update_id=NEW.source_update_id AND p.tool_id=NEW.tool_id AND p.state='pending' AND d.decision='approved'
 AND p.proposed_version=NEW.version AND p.proposal_json=NEW.proposal_json AND p.expected_head_revision+1=NEW.approved_revision
 AND d.expected_head_revision=p.expected_head_revision AND d.created_at=NEW.approved_at)));
END;
CREATE TRIGGER platform_head_insert_guard BEFORE INSERT ON platform_creator_tool_heads
BEGIN
 SELECT RAISE(ABORT,'initial_metadata_required') WHERE NEW.revision<>0 OR NEW.current_version<>'0.1.0'
 OR NOT EXISTS(SELECT 1 FROM platform_creator_tool_versions WHERE tool_id=NEW.tool_id AND version=NEW.current_version
 AND approved_revision=0 AND source_submission_id IS NOT NULL AND approved_at=NEW.updated_at);
END;
CREATE TRIGGER platform_head_update_guard BEFORE UPDATE ON platform_creator_tool_heads
BEGIN
 SELECT RAISE(ABORT,'update_decision_required') WHERE NEW.tool_id<>OLD.tool_id OR NEW.revision<>OLD.revision+1
 OR NOT EXISTS(SELECT 1 FROM platform_tool_update_decisions d JOIN platform_tool_update_proposals p ON p.update_id=d.update_id
 JOIN platform_creator_tool_versions v ON v.source_update_id=p.update_id
 WHERE p.tool_id=OLD.tool_id AND p.base_version=OLD.current_version AND p.expected_head_revision=OLD.revision
 AND p.state='pending' AND d.decision='approved' AND d.expected_head_revision=OLD.revision
 AND v.version=NEW.current_version AND v.approved_revision=NEW.revision AND v.approved_at=NEW.updated_at);
END;
CREATE TRIGGER platform_update_decision_apply AFTER INSERT ON platform_tool_update_decisions
BEGIN
 SELECT RAISE(ABORT,'update_revision_conflict') WHERE NEW.resulting_revision<>NEW.expected_revision+1
 OR NOT EXISTS(SELECT 1 FROM platform_tool_update_proposals WHERE update_id=NEW.update_id AND state='pending'
 AND revision=NEW.expected_revision AND expected_head_revision=NEW.expected_head_revision);
 SELECT RAISE(ABORT,'tool_head_conflict') WHERE NEW.decision='approved' AND NOT EXISTS(
 SELECT 1 FROM platform_tool_update_proposals p JOIN platform_creator_tool_heads h ON h.tool_id=p.tool_id
 WHERE p.update_id=NEW.update_id AND h.current_version=p.base_version AND h.revision=p.expected_head_revision);
 INSERT INTO platform_creator_tool_versions
 SELECT tool_id,proposed_version,expected_head_revision+1,proposal_json,NULL,update_id,NEW.created_at
 FROM platform_tool_update_proposals WHERE update_id=NEW.update_id AND NEW.decision='approved';
 UPDATE platform_creator_tool_heads SET current_version=(SELECT proposed_version FROM platform_tool_update_proposals WHERE update_id=NEW.update_id),
 revision=revision+1,updated_at=NEW.created_at WHERE NEW.decision='approved' AND tool_id=(SELECT tool_id FROM platform_tool_update_proposals WHERE update_id=NEW.update_id);
 UPDATE platform_tool_update_proposals SET state=NEW.decision,revision=NEW.resulting_revision WHERE update_id=NEW.update_id;
END;
CREATE TRIGGER platform_update_state_guard BEFORE UPDATE OF state,revision ON platform_tool_update_proposals
BEGIN
 SELECT RAISE(ABORT,'update_decision_required') WHERE OLD.state<>'pending' OR NOT EXISTS(
 SELECT 1 FROM platform_tool_update_decisions WHERE update_id=OLD.update_id AND expected_revision=OLD.revision
 AND resulting_revision=NEW.revision AND decision=NEW.state);
END;
CREATE TRIGGER platform_update_immutable BEFORE UPDATE OF update_id,tool_id,creator_id,base_version,expected_head_revision,proposed_version,request_key_hash,request_hash,proposal_json,terms_json,created_at,client_hash ON platform_tool_update_proposals
BEGIN SELECT RAISE(ABORT,'immutable_tool_update'); END;
CREATE TRIGGER platform_update_no_delete BEFORE DELETE ON platform_tool_update_proposals BEGIN SELECT RAISE(ABORT,'append_only'); END;
CREATE TRIGGER platform_update_decision_no_update BEFORE UPDATE ON platform_tool_update_decisions BEGIN SELECT RAISE(ABORT,'append_only'); END;
CREATE TRIGGER platform_update_decision_no_delete BEFORE DELETE ON platform_tool_update_decisions BEGIN SELECT RAISE(ABORT,'append_only'); END;
CREATE TRIGGER platform_version_no_update BEFORE UPDATE ON platform_creator_tool_versions BEGIN SELECT RAISE(ABORT,'append_only'); END;
CREATE TRIGGER platform_version_no_delete BEFORE DELETE ON platform_creator_tool_versions BEGIN SELECT RAISE(ABORT,'append_only'); END;
CREATE TRIGGER platform_head_no_delete BEFORE DELETE ON platform_creator_tool_heads BEGIN SELECT RAISE(ABORT,'append_only'); END;
CREATE TRIGGER platform_initial_metadata AFTER INSERT ON platform_creator_entitlements
BEGIN
 INSERT INTO platform_creator_tool_versions SELECT NEW.tool_id,'0.1.0',0,proposal_json,NEW.submission_id,NULL,NEW.approved_at FROM platform_tool_submissions WHERE submission_id=NEW.submission_id;
 INSERT INTO platform_creator_tool_heads VALUES(NEW.tool_id,'0.1.0',0,NEW.approved_at);
END;
-- Initialize only known durable metadata approvals, never historical financial facts.
INSERT INTO platform_creator_tool_versions
SELECT e.tool_id,'0.1.0',0,s.proposal_json,s.submission_id,NULL,e.approved_at
FROM platform_creator_entitlements e JOIN platform_tool_submissions s ON s.submission_id=e.submission_id
JOIN platform_submission_decisions d ON d.submission_id=s.submission_id WHERE s.state='approved' AND d.decision='approved';
INSERT INTO platform_creator_tool_heads SELECT tool_id,version,approved_revision,approved_at FROM platform_creator_tool_versions;
