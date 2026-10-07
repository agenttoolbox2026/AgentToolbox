# Reviewed creator installation

Metadata approval, execution installation and payout approval are separate actions. Migration `0013_creator_installations.sql` adds reviewed installation state; it does not install a seller, load a submitted URL, change the original 90% entitlement, or transfer money. This follow-up depends on migrations 0001–0012 and is separate from the wallet intake release.

No real creator proposal/source has been supplied or activated in this change. Local tests use synthetic proposals, compiled fixture functions and fake payment adapters. They prove lifecycle behavior, not a real customer purchase or a completed creator payout.

## Compiled adapter review

A creator product must remain under its stable `creator-<UUID>` identity. Its trusted, compiled handler declares `creatorAdapterId`, `creatorArtifactSha256` and `creatorContractSha256`. The installation binds these to an approved metadata version/revision and the executable product version. The contract hash is recomputed with `successContractPin(product)`; a client field or an attached product hash cannot replace that calculation.

`creatorArtifactSha256` identifies a reviewed source/build manifest. That manifest must record the exact source files and dependency versions, immutable source commit, reproducible build procedure, contract and resulting deployment artifact. The owner must review those bytes and check the deployment against the recorded manifest before activation. This declaration is supplied by trusted deployed code; it is not a runtime hash of a JavaScript function and is not a sandbox or code-integrity attestation.

Accept only platform-hosted, reviewed, deterministic computation with explicit input/output bounds and bounded iteration. `handler.run` receives validated input, not a request, environment, database, capability, payment signature or treasury authority. Review must reject ambient network, storage, credential access, unbounded work, dynamic imports, `eval` and arbitrary seller endpoint execution. There is no generic URL runner or automatic installation mechanism. A real seller source change requires its own source review, compiled deployment and installation event.

## Protected installation contract

`recordCreatorInstallation` in `platform/src/creator-installations.js` is internal and has no public HTTP/MCP route. Its caller must establish existing owner authorization first. `reviewer` is audit attribution, not an authorization credential. No account system or new secret grant is introduced.

An install request has exactly:

```js
{
  db, reviewer, requestId, toolId, expectedRevision,
  action: 'install', metadataRevision, metadataVersion,
  adapterId, artifactSha256, successContractSha256, productVersion,
  now // optional trusted clock function
}
```

`requestId` is 32–128 URL-safe characters. SHA-256 values are 64 lowercase hex characters. The initial installation revision is zero; revisions advance by one. A suspension has only `{db, reviewer, requestId, toolId, expectedRevision, action:'suspend', now}` and copies the existing binding internally. Unknown fields, changed idempotent replay, stale revisions and an outdated approved metadata head are rejected.

`platform_creator_installation_events` is append-only. Each event binds the approved metadata snapshot, compiled adapter/artifact/contract, product version, previous installation, reviewer and owner-scoped request commitment. Its SQL trigger atomically advances `platform_creator_installation_heads` and derives the compatibility field `platform_creator_entitlements.installed_adapter`. Direct unaudited changes to that field or installation heads are rejected. Suspension requires an active head. Reinstallation, even with identical artifact bytes, is a new revision.

Metadata update approval never changes an existing installation. The installed executable product version may remain older than the latest approved metadata. An owner may only create a new installation against the current approved metadata head. Existing capability, accounting identity and lifetime gross entitlement remain unchanged.

## Runtime and durable admission

Creator-prefixed products, explicit non-platform providers and any declared `creatorAdapterId`, including inherited declarations, require a reviewed installation. Missing, malformed or blank bindings fail closed. Existing first-party products and legacy unlabeled noncreator fixtures retain their prior behavior.

`creatorRuntimeCatalog({db,catalog,handlers})` checks each compiled creator against the active installation on every request. Unavailable creators remain retired tombstones so original paid requests retain a route to replay; they are absent from active discovery and payable-resource lists. Database errors remain availability errors. `createPlatform` uses this catalog for HTTP and MCP. Any presentation layer that renders compiled creator cards must use the same runtime eligibility result before advertising new execution; build-time catalog inclusion alone does not prove active installation.

Discovery challenges, quote creation, previews, direct paid execution, free service execution and example execution independently check installation eligibility. Preparations, quotes and payments freeze `creator_installation_id` and `creator_install_revision`. SQL insert guards require the current active installation, exact product/version and matching linked preparation/quote identities. This closes the resolver-to-admission race: suspension or reinstallation during payment verification rejects admission before handler execution or settlement. Public callers cannot choose these fields.

Prepared-result replay and quote creation/loading compare the saved installation to the current reviewed one. Preparation also rechecks after work. A changed artifact or a same-artifact reinstall invalidates unpaid preparations and quotes; the caller must inspect the new contract and explicitly prepare/authorize a new request. The system never silently requotes or replaces a payment authorization. Quote policy additionally binds the compiled artifact and contract hashes.

Once a payment is durably admitted, its original installation and beneficiary stay frozen. Later suspension does not relabel the receipt or switch its creator. Existing durable payment replay precedes current installation/schema/quote checks and invokes neither the handler nor the facilitator. Unknown settlement remains unresolved; it is never retried as a replacement charge. Keep product tombstones and prior durable records available through deployments and rollback. The existing 24-hour result-retention limit still applies.

Private earnings `execution_status:installed_adapter` means an active audited installation record exists; it does not prove that matching compiled code is deployed, that a customer bought anything, or that payout is ready. Unaudited legacy adapter values and suspended installations report `metadata_only_not_earning`. Accrued, reserved and paid amounts continue to come solely from the existing receipt/allocation/payout history.

## Release boundary

Apply the additive 0013 migration only after independent review and coordinated approval, before deploying this runtime. Compare prior aggregate counts/history and foreign keys before/after. Existing rows are preserved; historical payments, preparations and quotes get nullable installation fields. Legacy unaudited installations are not automatically trusted. New creator operations fail closed until a reviewed installation exists; existing paid replay and first-party operations remain supported.

Before a real creator activation: obtain its actual proposal and source, review the bounded compiled implementation and source manifest, retain stable replay routing, deploy matching code, establish protected owner authorization, and record the exact installation CAS request. Runtime-gated AGI presentation and protected owner integration remain the release integrator's responsibility. Wallet collection can ship independently. No production migration, installation, purchase, signature, settlement, payout or transfer is performed by this follow-up's tests.
