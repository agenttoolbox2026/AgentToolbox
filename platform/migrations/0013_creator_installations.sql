-- Reviewed compiled adapters only. Existing rows are preserved and fail closed without an audit.
CREATE TABLE platform_creator_installation_events (
 installation_id TEXT PRIMARY KEY,
 tool_id TEXT NOT NULL REFERENCES platform_creator_entitlements(tool_id),
 reviewer_subject TEXT NOT NULL CHECK(length(reviewer_subject) BETWEEN 1 AND 256),
 request_key_hash TEXT NOT NULL CHECK(length(request_key_hash)=64), request_hash TEXT NOT NULL CHECK(length(request_hash)=64),
 expected_revision INTEGER NOT NULL CHECK(expected_revision BETWEEN 0 AND 2147483646),
 resulting_revision INTEGER NOT NULL CHECK(resulting_revision=expected_revision+1),
 action TEXT NOT NULL CHECK(action IN ('install','suspend')),
 metadata_revision INTEGER NOT NULL, metadata_version TEXT NOT NULL,
 adapter_id TEXT NOT NULL CHECK(length(adapter_id) BETWEEN 1 AND 256),
 artifact_sha256 TEXT NOT NULL CHECK(length(artifact_sha256)=64 AND artifact_sha256 NOT GLOB '*[^0-9a-f]*'),
 success_contract_sha256 TEXT NOT NULL CHECK(length(success_contract_sha256)=64 AND success_contract_sha256 NOT GLOB '*[^0-9a-f]*'),
 product_version TEXT NOT NULL CHECK(length(product_version) BETWEEN 1 AND 128),
 previous_installation_id TEXT REFERENCES platform_creator_installation_events(installation_id), created_at TEXT NOT NULL,
 UNIQUE(reviewer_subject,request_key_hash), UNIQUE(tool_id,resulting_revision),
 FOREIGN KEY(tool_id,metadata_version) REFERENCES platform_creator_tool_versions(tool_id,version)
);
CREATE TABLE platform_creator_installation_heads (
 tool_id TEXT PRIMARY KEY REFERENCES platform_creator_entitlements(tool_id),
 installation_id TEXT NOT NULL UNIQUE REFERENCES platform_creator_installation_events(installation_id),
 revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 2147483647),
 state TEXT NOT NULL CHECK(state IN ('active','suspended')), updated_at TEXT NOT NULL
);
CREATE TRIGGER platform_installation_apply AFTER INSERT ON platform_creator_installation_events BEGIN
 SELECT RAISE(ABORT,'creator_installation_conflict') WHERE
 NEW.expected_revision<>coalesce((SELECT revision FROM platform_creator_installation_heads WHERE tool_id=NEW.tool_id),0)
 OR NEW.previous_installation_id IS NOT (SELECT installation_id FROM platform_creator_installation_heads WHERE tool_id=NEW.tool_id)
 OR (NEW.action='install' AND NOT EXISTS(SELECT 1 FROM platform_creator_tool_heads h JOIN platform_creator_tool_versions v ON v.tool_id=h.tool_id AND v.version=h.current_version WHERE h.tool_id=NEW.tool_id AND h.revision=NEW.metadata_revision AND h.current_version=NEW.metadata_version AND v.approved_revision=NEW.metadata_revision))
 OR (NEW.action='suspend' AND NOT EXISTS(SELECT 1 FROM platform_creator_installation_heads h JOIN platform_creator_installation_events e ON e.installation_id=h.installation_id WHERE h.tool_id=NEW.tool_id AND h.state='active' AND e.metadata_revision=NEW.metadata_revision AND e.metadata_version=NEW.metadata_version AND e.adapter_id=NEW.adapter_id AND e.artifact_sha256=NEW.artifact_sha256 AND e.success_contract_sha256=NEW.success_contract_sha256 AND e.product_version=NEW.product_version));
 INSERT INTO platform_creator_installation_heads VALUES(NEW.tool_id,NEW.installation_id,NEW.resulting_revision,IIF(NEW.action='install','active','suspended'),NEW.created_at)
 ON CONFLICT(tool_id) DO UPDATE SET installation_id=excluded.installation_id,revision=excluded.revision,state=excluded.state,updated_at=excluded.updated_at;
 UPDATE platform_creator_entitlements SET installed_adapter=IIF(NEW.action='install',NEW.adapter_id,NULL) WHERE tool_id=NEW.tool_id;
END;
CREATE TRIGGER platform_installation_head_insert_guard BEFORE INSERT ON platform_creator_installation_heads BEGIN
 SELECT RAISE(ABORT,'installation_event_required') WHERE NOT EXISTS(SELECT 1 FROM platform_creator_installation_events e WHERE e.installation_id=NEW.installation_id AND e.tool_id=NEW.tool_id AND e.expected_revision=coalesce((SELECT revision FROM platform_creator_installation_heads WHERE tool_id=NEW.tool_id),0) AND e.resulting_revision=NEW.revision AND NEW.state=IIF(e.action='install','active','suspended') AND e.created_at=NEW.updated_at);
END;
CREATE TRIGGER platform_installation_head_update_guard BEFORE UPDATE ON platform_creator_installation_heads BEGIN
 SELECT RAISE(ABORT,'installation_event_required') WHERE NEW.tool_id<>OLD.tool_id OR NOT EXISTS(SELECT 1 FROM platform_creator_installation_events e WHERE e.installation_id=NEW.installation_id AND e.tool_id=OLD.tool_id AND e.expected_revision=OLD.revision AND e.previous_installation_id=OLD.installation_id AND e.resulting_revision=NEW.revision AND NEW.state=IIF(e.action='install','active','suspended') AND e.created_at=NEW.updated_at);
END;
CREATE TRIGGER platform_installed_adapter_guard BEFORE UPDATE OF installed_adapter ON platform_creator_entitlements BEGIN
 SELECT RAISE(ABORT,'installation_event_required') WHERE NOT EXISTS(SELECT 1 FROM platform_creator_installation_heads h JOIN platform_creator_installation_events e ON e.installation_id=h.installation_id WHERE h.tool_id=OLD.tool_id AND NEW.installed_adapter IS IIF(h.state='active',e.adapter_id,NULL) AND e.resulting_revision=h.revision);
END;
CREATE TRIGGER platform_installation_event_no_update BEFORE UPDATE ON platform_creator_installation_events BEGIN SELECT RAISE(ABORT,'append_only'); END;
CREATE TRIGGER platform_installation_event_no_delete BEFORE DELETE ON platform_creator_installation_events BEGIN SELECT RAISE(ABORT,'append_only'); END;
CREATE TRIGGER platform_installation_head_no_delete BEFORE DELETE ON platform_creator_installation_heads BEGIN SELECT RAISE(ABORT,'append_only'); END;
ALTER TABLE platform_payments ADD COLUMN creator_installation_id TEXT REFERENCES platform_creator_installation_events(installation_id);
ALTER TABLE platform_payments ADD COLUMN creator_install_revision INTEGER;
ALTER TABLE platform_preparations ADD COLUMN creator_installation_id TEXT REFERENCES platform_creator_installation_events(installation_id);
ALTER TABLE platform_preparations ADD COLUMN creator_install_revision INTEGER;
ALTER TABLE platform_quotes ADD COLUMN creator_installation_id TEXT REFERENCES platform_creator_installation_events(installation_id);
ALTER TABLE platform_quotes ADD COLUMN creator_install_revision INTEGER;
CREATE TRIGGER platform_preparation_installation_guard BEFORE INSERT ON platform_preparations BEGIN
 SELECT RAISE(ABORT,'invalid_creator_installation') WHERE
 (NEW.product_id LIKE 'creator-%' OR NEW.creator_installation_id IS NOT NULL OR NEW.creator_install_revision IS NOT NULL)
 AND NOT EXISTS(SELECT 1 FROM platform_creator_installation_heads h JOIN platform_creator_installation_events i ON i.installation_id=h.installation_id JOIN platform_creator_entitlements e ON e.tool_id=h.tool_id WHERE h.state='active' AND h.tool_id=NEW.product_id AND h.installation_id=NEW.creator_installation_id AND h.revision=NEW.creator_install_revision AND i.product_version=NEW.version AND e.installed_adapter=i.adapter_id);
END;
CREATE TRIGGER platform_quote_installation_guard BEFORE INSERT ON platform_quotes BEGIN
 SELECT RAISE(ABORT,'invalid_creator_installation') WHERE
 (NEW.product_id LIKE 'creator-%' OR NEW.creator_installation_id IS NOT NULL OR NEW.creator_install_revision IS NOT NULL)
 AND (NOT EXISTS(SELECT 1 FROM platform_creator_installation_heads h JOIN platform_creator_installation_events i ON i.installation_id=h.installation_id JOIN platform_creator_entitlements e ON e.tool_id=h.tool_id WHERE h.state='active' AND h.tool_id=NEW.product_id AND h.installation_id=NEW.creator_installation_id AND h.revision=NEW.creator_install_revision AND i.product_version=NEW.version AND e.installed_adapter=i.adapter_id)
 OR (NEW.prepared_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM platform_preparations p WHERE p.prepared_id=NEW.prepared_id AND p.product_id=NEW.product_id AND p.version=NEW.version AND p.creator_installation_id=NEW.creator_installation_id AND p.creator_install_revision=NEW.creator_install_revision)));
END;
CREATE TRIGGER platform_preparation_installation_immutable BEFORE UPDATE OF creator_installation_id,creator_install_revision ON platform_preparations BEGIN SELECT RAISE(ABORT,'immutable_creator_installation'); END;
CREATE TRIGGER platform_quote_installation_immutable BEFORE UPDATE OF creator_installation_id,creator_install_revision ON platform_quotes BEGIN SELECT RAISE(ABORT,'immutable_creator_installation'); END;
CREATE TRIGGER platform_payment_installation_guard BEFORE INSERT ON platform_payments BEGIN
 SELECT RAISE(ABORT,'invalid_creator_installation') WHERE
 (NEW.creator_tool_id IS NULL AND (NEW.product_id LIKE 'creator-%' OR NEW.creator_installation_id IS NOT NULL OR NEW.creator_install_revision IS NOT NULL))
 OR (NEW.creator_tool_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM platform_creator_installation_heads h JOIN platform_creator_installation_events i ON i.installation_id=h.installation_id JOIN platform_creator_entitlements e ON e.tool_id=h.tool_id WHERE h.state='active' AND h.tool_id=NEW.product_id AND h.tool_id=NEW.creator_tool_id AND h.installation_id=NEW.creator_installation_id AND h.revision=NEW.creator_install_revision AND i.product_version=NEW.version AND e.creator_id=NEW.creator_id AND e.share_bps=NEW.creator_share_bps AND e.installed_adapter=i.adapter_id))
 OR (NEW.creator_tool_id IS NOT NULL AND NEW.quote_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM platform_quotes q WHERE q.quote_id=NEW.quote_id AND q.product_id=NEW.product_id AND q.version=NEW.version AND q.creator_installation_id=NEW.creator_installation_id AND q.creator_install_revision=NEW.creator_install_revision))
 OR (NEW.creator_tool_id IS NOT NULL AND NEW.prepared_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM platform_preparations p WHERE p.prepared_id=NEW.prepared_id AND p.product_id=NEW.product_id AND p.version=NEW.version AND p.creator_installation_id=NEW.creator_installation_id AND p.creator_install_revision=NEW.creator_install_revision));
END;
CREATE TRIGGER platform_payment_installation_immutable BEFORE UPDATE OF creator_installation_id,creator_install_revision ON platform_payments BEGIN SELECT RAISE(ABORT,'immutable_creator_installation'); END;
