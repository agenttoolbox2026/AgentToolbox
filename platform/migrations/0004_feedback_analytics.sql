-- Additive tracking only. Earlier example executions have no reconstructable history.
CREATE TABLE platform_tracking (feature TEXT PRIMARY KEY, started_at TEXT NOT NULL);
INSERT INTO platform_tracking VALUES('examples_feedback_activity',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
CREATE TABLE platform_activity (
 event_id TEXT PRIMARY KEY, subject_id TEXT, product_id TEXT NOT NULL,
 version TEXT NOT NULL, channel TEXT NOT NULL, event TEXT NOT NULL,
 sample_kind TEXT NOT NULL CHECK(sample_kind IN ('unclassified','synthetic','owner')),
 count INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL,
 UNIQUE(subject_id,event)
);
CREATE INDEX platform_activity_recent ON platform_activity(created_at);
CREATE INDEX platform_activity_product ON platform_activity(product_id,created_at,sample_kind);
CREATE TABLE platform_examples (
 id TEXT PRIMARY KEY, product_id TEXT NOT NULL, version TEXT NOT NULL,
 key_hash TEXT, state TEXT NOT NULL CHECK(state IN ('running','completed','failed')),
 sample_kind TEXT NOT NULL CHECK(sample_kind IN ('unclassified','synthetic')),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, duration_ms INTEGER NOT NULL DEFAULT 0,
 failure_code TEXT, result_json TEXT, result_expires_at TEXT NOT NULL,
 UNIQUE(product_id,version,key_hash)
);
CREATE INDEX platform_examples_recent ON platform_examples(created_at,sample_kind);
CREATE TABLE platform_feedback (
 id TEXT PRIMARY KEY, key_hash TEXT NOT NULL UNIQUE, fingerprint TEXT NOT NULL,
 product_id TEXT NOT NULL, version TEXT NOT NULL, channel TEXT NOT NULL,
 reference_kind TEXT, reference_id TEXT, execution_state TEXT,
 link_status TEXT NOT NULL CHECK(link_status IN ('server_record_linked','unverified')),
 sample_kind TEXT NOT NULL CHECK(sample_kind IN ('unclassified','synthetic','owner')),
 rating INTEGER CHECK(rating BETWEEN 1 AND 5), outcome TEXT,
 helpful INTEGER CHECK(helpful IN (0,1)), task_description TEXT, message TEXT,
 created_at TEXT NOT NULL
);
CREATE INDEX platform_feedback_recent ON platform_feedback(created_at,sample_kind);
-- Keep the old daily aggregates and all financial records intact. New recent
-- activity is captured atomically with the authoritative writes, never backfilled.
CREATE TRIGGER platform_daily_activity_insert AFTER INSERT ON platform_daily
BEGIN
 INSERT INTO platform_activity VALUES(lower(hex(randomblob(16))),NULL,NEW.product_id,NEW.version,NEW.channel,NEW.event,NEW.sample_kind,NEW.count,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER platform_daily_activity_update AFTER UPDATE OF count ON platform_daily
WHEN NEW.count>OLD.count
BEGIN
 INSERT INTO platform_activity VALUES(lower(hex(randomblob(16))),NULL,NEW.product_id,NEW.version,NEW.channel,NEW.event,NEW.sample_kind,NEW.count-OLD.count,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER platform_example_attempt AFTER INSERT ON platform_examples
BEGIN
 INSERT INTO platform_activity VALUES(lower(hex(randomblob(16))),NEW.id,NEW.product_id,NEW.version,'http','example_attempt',NEW.sample_kind,1,NEW.created_at);
END;
CREATE TRIGGER platform_example_result AFTER UPDATE OF state ON platform_examples
WHEN OLD.state='running' AND NEW.state IN ('completed','failed')
BEGIN
 INSERT INTO platform_activity VALUES(lower(hex(randomblob(16))),NEW.id,NEW.product_id,NEW.version,'http',CASE NEW.state WHEN 'completed' THEN 'example_success' ELSE 'example_failure' END,NEW.sample_kind,1,NEW.updated_at);
END;
CREATE TRIGGER platform_paid_activity_insert AFTER INSERT ON platform_payments
BEGIN
 INSERT INTO platform_activity VALUES(lower(hex(randomblob(16))),NEW.operation_id,NEW.product_id,NEW.version,'http','paid_'||NEW.state,CASE WHEN NEW.sample_kind='synthetic' OR NEW.is_live=0 THEN 'synthetic' WHEN NEW.payer=NEW.receiver THEN 'owner' ELSE 'unclassified' END,1,NEW.created_at);
END;
CREATE TRIGGER platform_paid_activity_state AFTER UPDATE OF state ON platform_payments
WHEN OLD.state<>NEW.state
BEGIN
 INSERT OR IGNORE INTO platform_activity VALUES(lower(hex(randomblob(16))),NEW.operation_id,NEW.product_id,NEW.version,'http','paid_'||NEW.state,CASE WHEN NEW.sample_kind='synthetic' OR NEW.is_live=0 THEN 'synthetic' WHEN NEW.payer=NEW.receiver THEN 'owner' ELSE 'unclassified' END,1,NEW.updated_at);
END;
CREATE TRIGGER platform_feedback_activity AFTER INSERT ON platform_feedback
BEGIN
 INSERT INTO platform_activity VALUES(lower(hex(randomblob(16))),NEW.id,NEW.product_id,NEW.version,NEW.channel,'feedback_submitted',NEW.sample_kind,1,NEW.created_at);
END;
