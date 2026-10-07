# Seller and referrer payout integration

This extension connects private beneficiary requests to the existing owner-reviewed seller ledger and a matching referral ledger. Sellers retain 90% of qualifying gross revenue. Registered referrers retain the published 100bps of qualifying first-party gross revenue, with no creator-product commissions. Fractional carry is cumulative; gas and other platform costs never reduce these earned amounts. No automatic signing, broadcasting, payout date, new custody or secret recovery grant is introduced.

## Private beneficiary endpoints

Creator wallet and earnings endpoints remain unchanged. Referrers use the same wallet claim/challenge/proof shapes under `/v1/referrals/me/payout-wallet`, `/challenge` and `/verify`, authenticated by `X-Referral-Capability`. Address collection and signup require no signature. An exact EOA ownership message is required before reserving a payout to that destination; it does not authorize a transfer or establish human identity. ERC-1271 wallets are not supported.

| Operation | Creator | Referrer |
| --- | --- | --- |
| Exact earnings | `GET /v1/creator-tools/{tool_id}/earnings` | `GET /v1/referrals/me/earnings` |
| Request/history | `POST/GET /v1/creator-tools/{tool_id}/payout-requests` | `POST/GET /v1/referrals/me/payout-requests` |
| One private request | `GET /v1/creator-tools/{tool_id}/payout-requests/{request_id}` | `GET /v1/referrals/me/payout-requests/{request_id}` |

Creator requests use `X-Creator-Capability`. A POST body is exactly `{request_id, amount_atomic, claim_revision}`: retained UUID, positive canonical Base USDC atomic-unit string within uint256, and current wallet revision. The server resolves the beneficiary and freezes the exact claim ID/revision, denomination and amount. A client cannot supply source, address override, rate, proof/approval status or paid state. Claim changes need an explicit new request; replay uses the original immutable request even after later wallet changes.

Requests hold no funds. They check currently available earnings and consume an indexed database budget of ten new requests per beneficiary owner per day and 1000 globally. Exact replay does not consume another request. Histories use `limit` 1–20 and scope-bound cursors. All responses are private/no-store. Public request status is derived from its permanent payout link and ledger evidence. Only `paid` includes a finalized receipt; block number and log index are canonical `0x` quantities.

Registration/terms/account and payout operations are also exposed as bounded MCP tools. No owner operation is in the public app or MCP. Frozen referral terms retain their original launch limitation as history; a separate `payout_processing` operational supplement describes the new workflow without changing rate, attribution, eligibility or accrued rights.

## Protected owner interface

`platform/src/payout-operator.js` is an internal integration facade. The private operator Worker must validate its existing Cloudflare Access audience, issuer and owner authorization, derive the reviewer subject from the validated identity, and enforce same-origin/CSRF and bounded JSON rules. A reviewer string alone is not authentication. Public request fields must never select the reviewer, source wallet, RPC URL, implementation or database. There is no public owner route or service credential added by this package.

All functions receive `{db, reviewer}`. Reviewer is a nonblank verified subject of at most 128 characters. `kind` is exactly `creator` or `referral`.

| Helper | Additional arguments and behavior |
| --- | --- |
| `listPayoutRequestsForOwner` | `params:{kind?,status:'requested'|'all',limit?,cursor?}`; returns bounded requests with current/proven/approved wallet status. |
| `getPayoutRequestForOwner` | `requestId`; exact request and reviewable destination/proof state. |
| `approvePayoutWallet` | `kind,claimId,requestId,now?`; requires a proof for the current wallet. Records separate immutable owner approval. |
| `reservePayoutRequests` | `kind,requestIds:[UUID],requestId,sourceAddress,now?`; at most 20 distinct subjects in one domain. Source is trusted owner configuration. Rechecks current approved claim and available funds, and atomically saves all reservations and permanent request links. |
| `readPayoutForOwner` | `kind,payoutId`; frozen source/destination/amount/claim, current state/revision, last 20 events and bounded candidate history. |
| `authorizeOperatorPayout` | `kind,payoutId,requestId,expectedRevision,now?`; authorizes one previously reviewed reserved transfer. |
| `getOperatorPayoutManifest` | `kind,payoutId`; returns exact unsigned USDC transfer calldata after authorization. |
| `cancelOperatorPayout` | Same write arguments; allowed only while reserved, before signing instructions become available. |
| `registerOperatorPayoutTransaction` | Same write arguments plus `transactionHash,rpc`; independently checks submitted transaction identity and intent. |
| `markOperatorPayoutUnknown` | Same write arguments; retains uncertain funds for reconciliation. |
| `reconcileOperatorPayout` | Same write arguments plus `transactionHash,rpc`; independently verifies finalized evidence and commits paid accounting atomically. |

Write `requestId` values use 32–128 URL-safe characters and bind the original canonical action. Public request IDs are UUIDs. `expectedRevision` is read from the payout and cannot be guessed forward. A cancelled payout permanently consumes its linked public request; a new request is explicit. Batches group independent transfers and do not claim atomic on-chain settlement. The owner reviews each exact source, destination and amount, then signs externally. The backend never receives a private key and cannot send a transaction.

The optional `requestIds` map added to each ledger's internal `proposePayoutBatch` is hash-bound and exactly matches batch subjects. Its request-link inserts run inside the same D1 batch as reservations. SQL enforces exact beneficiary, amount, claim/revision and denomination, with one permanent request-to-payout link. Failed linking rolls back every new batch/reservation. Replay verifies existing links; it never attaches an unrelated historical batch after commit.

## Source and RPC configuration

`sourceAddress` is the owner-approved funded source, not the beneficiary or a public request override. It must differ from the destination. The operator confirms the signing wallet is on Base and controls that source. Platform funds gas separately. Configuration, owner signing and actual broadcasts remain outside this backend's authority.

`createPayoutRpc({url,fetchImpl?,timeoutMs?,maxResponseBytes?})` constructs a fixed trusted HTTPS read-only adapter. Defaults are 10 seconds and 256KiB; upper bounds are 30 seconds and 1MiB. It permits only `eth_chainId`, `eth_getTransactionByHash`, `eth_getTransactionReceipt` and `eth_getBlockByNumber` with bounded validated parameters. It rejects redirects, wrong response IDs/envelopes, malformed or oversized results and private/local literal targets. It forwards no incoming cookies or authorization. Provider secrets in a configured path/query never appear in errors or logs. No client-supplied URL or general RPC proxy is accepted.

Receipt checks retain the audited creator verifier: exact native Base USDC direct transfer input, source/destination/amount, registered source nonce, a unique matching Transfer log, successful receipt, canonical inclusion and finalized block view. Inclusion must be later than the owner authorization timestamp. Changed, unavailable, unfinalized, reverted or ambiguous evidence never marks paid or releases funds. Same-nonce replacements must preserve intent; there is no blind resend. Source/network/nonce, transaction hash and receipt log cannot satisfy another logical seller or referral payout. Finalized-chain reversals beyond the provider finality assumption require separate owner reconciliation; immutable evidence is not rewritten.

## Reviewed creator activation

The reviewed PR16 installation protocol is included unchanged. `reviewedCreatorRegistry` in `reviewed-creator-adapters.js` resolves to an empty registry until a real seller source artifact is reviewed and compiled into a source commit. No test seller is included in production. `createReviewedCreatorRegistry(entries)` is a trusted build/test constructor, never an HTTP/environment input parser or URL runner.

The protected operator may list/read compiled manifests and call registry `install({db,reviewer,requestId,manifestId,expectedRevision,now?})` or `suspend({db,reviewer,requestId,toolId,expectedRevision,now?})`. Installation derives adapter/source/contract/version bindings from the allowlisted manifest; owner requests cannot override them. Registry `getRuntime()` supplies frozen products/handlers to the public runtime. The AGI integrator must combine these with first-party products and apply `creatorRuntimeCatalog` to presentation before advertising execution. Known stable products remain tombstones after suspension so prior paid requests still reach replay. Owner metadata approval never changes execution.

Manifest source hashes are reviewed declarations, not a sandbox or runtime code attestation. Real adapters require deterministic bounded computation and review of source, schemas, outcome criteria, dependencies and deployment. Handler input contains no environment, database, credentials or payment signature. Arbitrary submitted endpoints are never installed or executed. See [the installation contract](creator-installation-contract.md).

## Migration, validation and live proof boundary

Apply 0013 → 0014 → 0015 → 0016 after integrated review, before either dependent Worker. Migrations are additive and preserve existing capabilities, terms, balances, receipts, allocations, audits and replay. Verify serialized-history/aggregate counts, migration history and foreign keys before/after. 0015 adds reciprocal creator/referral transfer-use guards without changing old rows. Do not roll back to code that bypasses financial guards or destructive history cleanup.

Local tests exercise real request, installation, payment, allocation and payout state machines with synthetic fixtures, ephemeral EOA proof keys and fake facilitator/RPC responses. They do not constitute a customer purchase or a real outgoing payment. Production testing must not create test earnings, fabricated customers or a pretend seller. End-to-end live proof requires actual qualifying earnings, approved source/RPC configuration, an owner-reviewed and owner-signed transfer, then successful independent receipt reconciliation. Until that happens, report source readiness and verified live payment separately.
