# AGI release and retirement ownership

The public release is an in-process consolidation at
`https://agi.agenttoolbox2026.workers.dev`. It retains the existing platform
runtime and D1 ledger; there is no credential proxy, cloned database or data
migration. See [origin-consolidation.md](origin-consolidation.md) for payment
replay, retention, admission, telemetry and cutover invariants.

## Source and deployment owners

- AGI owner: consolidated Worker, compact document, Humans, workflow assets,
  shared bindings, local browser checks and live read-only readback.
- Canonical platform owner: backend compatibility helpers and old `agnttoolbx`
  retirement. The old Worker was recoverably retired after parent clearance and explicit
  lead coordination; its default configuration now has no assets or scheduled handler.
- Private owner: recoverable dashboard retirement while keeping protected JSON
  creator review APIs. Private PR4 commit
  `f6f530c62d3d272006d4afaa6c032d53094b6f34`, tree
  `4ecd766aea4d8dc3770c39889775ba1905a5e896`, has 31 passing local tests and an
  independent review. Its `docs/owner-operations.md` preserves the operational
  transaction contract; `docs/admin-retirement.md` gives reconciliation and rollback.

The private API retains existing JWT/CSRF authorization, explicit owner decisions,
atomic metadata history and creator rights. Public approval never executes a
third-party adapter. A positive owner-session live review is unverified; local
authenticated tests and live rejection checks are separate evidence. No positive
production proposal, review decision, update, referral, preview or payment belongs
in release QA.

## Staged cutover

1. Publish and deploy reviewed AGI source with `triggers.crons: []`; record exact
   commit/tree, Worker version, same physical D1 ID and payment identities.
2. Run read-only AGI readback, recomputing success/payment hashes. Check the actual
   browser forms/assets and audience navigation. Verify private protected review
   contract and preservation evidence without creating a review decision.
3. Refresh the read-only D1 aggregate baseline. Do not retire during unresolved
   obligations without an explicit preservation/reconciliation plan. Obtain the
   parent migration-safety gate on concrete source/deployment evidence.
4. Old owner deploys only the pure 410 retirement response and clears old cron
   triggers explicitly. No redirects, request forwarding or financial writes.
5. After old cron removal is verified, transfer `17 5 * * *` to AGI. Allow Cloudflare
   propagation; do not leave two active schedulers. Private owner can retire the
   dashboard under the same gate, retaining the protected operational APIs.
6. Read back all hosts, D1 aggregate/history continuity and final Worker versions.

## Verified retirement

Parent migration clearance was received on 2026-10-07 after deployed AGI binding,
contract and unchanged-history checks. Old public version
`25fce34f-b3ef-4515-ab25-2af0b31916cd` returns 410 on all routes without Location
headers. Native provider readback confirmed zero old crons at 10:44:27 UTC; the
15-minute propagation gate ends after 10:59:27 UTC and requires a second readback
before deploying the final AGI configuration with `17 5 * * *`. Retired
source/configuration is retained in this repository. This gate is operational,
not satisfied by merely committing the final cron configuration.

Private version `c748372b-0dc6-4d1d-afb6-8bf4d42e8e19` receives 100% traffic and
retains protected JSON review operations. All 758 historical record hashes across
29 tables, counts and schema were unchanged. Its 31 tests and 24 live Access
rejection checks pass; authenticated live owner review remains unverified.

The two audience pages share one header component and versioned stylesheet. Their
description text uses the same system monospace font; Humans display text retains
its larger counter and heading treatment. No JavaScript is needed for navigation.

## Recovery points

AGI pre-consolidation version: `919887c2-1d49-4072-a96e-e68624b4aa73`.
Old public pre-retirement version: `dedda843-b079-465e-be9b-1f23caa9241d`.
Private pre-retirement version: `ca91c104-4646-4ce3-a90e-aeefa9d16580`.

Do not restore `dedda843` or any old destructive cleanup handler. Keep the retired
old Worker in place; roll back AGI only to a reviewed preservation-safe revision.
An old-origin restoration requires a rebuilt Worker with `preserveRecords:true`,
initially empty crons and explicit scheduler coordination.

Recovery changes Worker source/configuration while keeping D1 unchanged. Never
rewind financial records, change capability commitments, regenerate payment
identities, or retry settlement as a rollback operation. Review admission and
scheduler ownership together before restoring a public origin.
