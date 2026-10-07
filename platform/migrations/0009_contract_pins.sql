-- Additive only. NULL identifies an older unpinned record; never infer historical criteria.
ALTER TABLE platform_quotes ADD COLUMN success_contract_sha256 TEXT
 CHECK(success_contract_sha256 IS NULL OR (length(success_contract_sha256)=64 AND success_contract_sha256 NOT GLOB '*[^0-9a-f]*'));
ALTER TABLE platform_preparations ADD COLUMN success_contract_sha256 TEXT
 CHECK(success_contract_sha256 IS NULL OR (length(success_contract_sha256)=64 AND success_contract_sha256 NOT GLOB '*[^0-9a-f]*'));
CREATE TRIGGER platform_quote_success_pin_immutable BEFORE UPDATE OF success_contract_sha256 ON platform_quotes
BEGIN SELECT RAISE(ABORT,'immutable_success_contract_pin'); END;
CREATE TRIGGER platform_preparation_success_pin_immutable BEFORE UPDATE OF success_contract_sha256 ON platform_preparations
BEGIN SELECT RAISE(ABORT,'immutable_success_contract_pin'); END;
