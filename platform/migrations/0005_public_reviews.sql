-- Additive only: private platform_feedback is never copied into public reviews.
ALTER TABLE platform_payments ADD COLUMN review_secret_hash TEXT
 CHECK(review_secret_hash IS NULL OR (length(review_secret_hash)=64 AND review_secret_hash NOT GLOB '*[^0-9a-f]*'));
-- The caller's commitment belongs to the original request, even if it fails.
CREATE TRIGGER platform_review_commitment_immutable BEFORE UPDATE OF review_secret_hash ON platform_payments
WHEN NEW.review_secret_hash IS NOT OLD.review_secret_hash
BEGIN SELECT RAISE(ABORT,'review_commitment_immutable'); END;
CREATE TABLE platform_reviews (
 id TEXT PRIMARY KEY, key_hash TEXT NOT NULL UNIQUE, fingerprint TEXT NOT NULL,
 product_id TEXT NOT NULL, version TEXT NOT NULL, channel TEXT NOT NULL,
 sample_kind TEXT NOT NULL CHECK(sample_kind IN ('unclassified','synthetic','owner')),
 visibility TEXT NOT NULL CHECK(visibility IN ('public','hidden')),
 badge TEXT NOT NULL CHECK(badge IN ('verified_purchase','example_linked','unverified')),
 purchase_operation_id TEXT REFERENCES platform_paid_purchases(operation_id), example_id TEXT,
 display_name TEXT NOT NULL, rating INTEGER CHECK(rating BETWEEN 1 AND 5),
 outcome TEXT, message TEXT NOT NULL, created_at TEXT NOT NULL,
 CHECK((badge='verified_purchase')=(purchase_operation_id IS NOT NULL)),
 CHECK((badge='example_linked')=(example_id IS NOT NULL))
);
CREATE UNIQUE INDEX platform_review_one_purchase ON platform_reviews(purchase_operation_id) WHERE purchase_operation_id IS NOT NULL;
CREATE UNIQUE INDEX platform_review_one_example ON platform_reviews(example_id) WHERE example_id IS NOT NULL;
CREATE UNIQUE INDEX platform_review_duplicate ON platform_reviews(product_id,version,fingerprint);
CREATE INDEX platform_review_page ON platform_reviews(product_id,sample_kind,visibility,created_at DESC,id DESC);
CREATE TABLE platform_review_replies (
 id TEXT PRIMARY KEY, review_id TEXT NOT NULL REFERENCES platform_reviews(id),
 parent_reply_id TEXT REFERENCES platform_review_replies(id),
 key_hash TEXT NOT NULL UNIQUE, fingerprint TEXT NOT NULL, channel TEXT NOT NULL,
 sample_kind TEXT NOT NULL CHECK(sample_kind IN ('unclassified','synthetic','owner')),
 visibility TEXT NOT NULL CHECK(visibility IN ('public','hidden')),
 badge TEXT NOT NULL CHECK(badge IN ('verified_purchase','unverified')),
 purchase_operation_id TEXT REFERENCES platform_paid_purchases(operation_id),
 display_name TEXT NOT NULL, message TEXT NOT NULL, created_at TEXT NOT NULL,
 CHECK((badge='verified_purchase')=(purchase_operation_id IS NOT NULL)),
 UNIQUE(review_id,fingerprint)
);
CREATE INDEX platform_reply_page ON platform_review_replies(review_id,sample_kind,visibility,created_at DESC,id DESC);
-- Enforce the thread bound even for concurrent writers. Idempotent duplicates
-- are resolved in the application before this point and never consume a slot.
CREATE TRIGGER platform_reply_limit BEFORE INSERT ON platform_review_replies
WHEN (SELECT COUNT(*) FROM platform_review_replies WHERE review_id=NEW.review_id)>=100
 AND NOT EXISTS(SELECT 1 FROM platform_review_replies WHERE key_hash=NEW.key_hash)
BEGIN SELECT RAISE(ABORT,'reply_limit'); END;
CREATE TRIGGER platform_reply_parent BEFORE INSERT ON platform_review_replies
WHEN NEW.parent_reply_id IS NOT NULL AND NOT EXISTS(
 SELECT 1 FROM platform_review_replies WHERE id=NEW.parent_reply_id AND review_id=NEW.review_id
 AND visibility='public' AND sample_kind=NEW.sample_kind)
BEGIN SELECT RAISE(ABORT,'reply_parent_invalid'); END;
CREATE TRIGGER platform_review_activity AFTER INSERT ON platform_reviews BEGIN
 INSERT INTO platform_activity(event_id,subject_id,product_id,version,channel,event,sample_kind,count,created_at)
 VALUES(lower(hex(randomblob(16))),NEW.id,NEW.product_id,NEW.version,NEW.channel,'public_review_submitted',NEW.sample_kind,1,NEW.created_at);
END;
CREATE TRIGGER platform_reply_activity AFTER INSERT ON platform_review_replies BEGIN
 INSERT INTO platform_activity(event_id,subject_id,product_id,version,channel,event,sample_kind,count,created_at)
 SELECT lower(hex(randomblob(16))),NEW.id,r.product_id,r.version,NEW.channel,'public_reply_submitted',NEW.sample_kind,1,NEW.created_at FROM platform_reviews r WHERE r.id=NEW.review_id;
END;
INSERT INTO platform_tracking VALUES('public_reviews',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
-- Badge rows must still refer to a qualifying purchase at insertion time.
CREATE TRIGGER platform_review_eligible BEFORE INSERT ON platform_reviews
WHEN NEW.badge='verified_purchase' AND NOT EXISTS(
 SELECT 1 FROM platform_paid_purchases r JOIN platform_payments p USING(operation_id)
 WHERE r.operation_id=NEW.purchase_operation_id AND r.product_id=NEW.product_id AND r.version=NEW.version
 AND p.product_id=r.product_id AND p.version=r.version AND p.state='settled' AND p.is_live=1
 AND p.sample_kind='unclassified' AND lower(p.payer)<>lower(p.receiver)
 AND CAST(p.amount_atomic AS INTEGER)>0 AND CAST(r.amount_atomic AS INTEGER)>0 AND p.review_secret_hash IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'purchase_ineligible'); END;
CREATE TRIGGER platform_reply_eligible BEFORE INSERT ON platform_review_replies
WHEN NEW.badge='verified_purchase' AND NOT EXISTS(
 SELECT 1 FROM platform_paid_purchases r JOIN platform_payments p USING(operation_id)
 JOIN platform_reviews parent ON parent.id=NEW.review_id
 WHERE r.operation_id=NEW.purchase_operation_id AND r.product_id=parent.product_id AND r.version=parent.version
 AND p.product_id=r.product_id AND p.version=r.version AND p.state='settled' AND p.is_live=1
 AND p.sample_kind='unclassified' AND lower(p.payer)<>lower(p.receiver)
 AND CAST(p.amount_atomic AS INTEGER)>0 AND CAST(r.amount_atomic AS INTEGER)>0 AND p.review_secret_hash IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'purchase_ineligible'); END;
