const json=value=>JSON.stringify(value,null,2);
export function compactManifest(m){
 return {name:m.name,format:'agenttoolbox-frontdoor-v1',catalog_version:m.registryVersion,
  canonical_api_origin:m.origin,presentation_only:true,contract_policy:m.contract_policy,
  buy_guide:m.siteOrigin+'/buy.md',sell_guide:m.siteOrigin+'/sell.md',for_humans:m.origin+'/humans',
  ...m.machine,
  tools:m.tools.map(p=>({id:p.id,name:p.name,version:p.version,provider:p.provider,experimental:p.experimental,
   use_when:p.fit,scope:p.scope,minimum_amount_atomic:p.pricing.minimum_amount_atomic,decimals:p.pricing.decimals,
   currency:p.pricing.currency,network:p.pricing.network,pricing_model:p.pricing.model,
   success_criterion:p.outcome.success_criterion,success_contract_sha256_snapshot:p.success_pin.sha256,
   guide:m.siteOrigin+p.markdown_url,preview_supported:p.preview.supported,...p.links})),
  seller:{terms:m.origin+'/v1/creator-terms',submit:m.origin+'/v1/tool-submissions',browser_submit:m.origin+'/submit-tool',
   browser_update:m.origin+'/update-tool',charged_fee_atomic:m.sellerTerms.terms.charged_fee_atomic,
   share_bps:m.sellerTerms.terms.share_bps,approval_effect:m.sellerTerms.terms.approval_effect,transfers_enabled:false},
  referrals:{terms:m.origin+'/v1/referral-terms',first_party_only:true,share_bps:m.referralTerms.terms.share_bps,transfers_enabled:false},
  outcomes_sold:m.origin+'/v1/stats',outcomes_sold_meaning:'Completed live purchases, including repeats; not unique agents or independently reconciled revenue.',
 };
}
export function homeMarkdown(m){
 const sample=m.tools.find(p=>p.id==='contract-cases')??m.tools[0];
 const seller=m.sellerTerms.terms;
 return `# AgentToolbox

> Tools for agents. Pay when the published outcome checks pass.

${m.tools.length} experimental tools by AgentToolbox. Buyer-chosen prices from $0.01 USDC on Base, paid through x402. Buy a result or propose a tool for review.

[Buy tools](#buy-tools) · [Sell tools](#sell-tools) · [Machine-readable](#machine-readable)

API base: ${m.origin}
All API calls, signatures and capabilities go directly to this origin.

## Quick start

1. Choose a tool below. Read its contract, success checks and free static examples.
2. Fetch \`GET /v1/products/{id}/criteria\` and \`GET /v1/products/{id}/invoke\` (402 expected; discovery only).
3. Verify both SHA-256 pins from the decoded \`canonical_json\` UTF-8 bytes, with no trailing newline. Save the exact input, version, pins and a fresh 32–128 character \`Idempotency-Key\`.
4. Authorize the disclosed amount with an x402 v2 exact client. Send \`POST /v1/products/{id}/invoke\` with that body, key and \`PAYMENT-SIGNATURE\`. The direct minimum-price call needs no quote.
5. Save the output, \`operation_id\`, \`contract_pins\`, \`payment\` and \`PAYMENT-RESPONSE\`. Settlement is attempted only after the published checks pass.
6. After an uncertain response, replay the identical request and original authorization. Completed output is replayable for 24 hours. Unknown settlement needs reconciliation; never create a replacement authorization.

## Buy tools

Each tool starts at $0.01 USDC (\`10000\` atomic units). A passing check establishes its defined outcome, not truth, usefulness or proven buyer value. All fixtures are synthetic; \`input_valid\` covers the full runtime contract, not JSON Schema alone.

${m.tools.map(p=>`### ${p.name}

${p.problem} ${p.scope}. Version \`${p.version}\`.

Success: ${p.outcome.success_criterion}

[Contract + schemas](${p.links.detail}) · [Success checks + pin](${p.links.criteria}) · [Free examples](${p.links.examples}) · [Tool guide](${p.guide_url})
${p.preview.supported?`[Limited real-input preview](${p.links.preview})`:'No real-input preview; the verdict is the paid output.'}
Call: \`POST /v1/products/${p.id}/invoke\`
`).join('\n')}
## Request and response

Example: ContractCases at the minimum. Fetch its [success pin](${sample.links.criteria}) and [unsigned payment challenge](${sample.links.invoke}) first. Fill in the two verified hashes; save the final body and headers before authorization.

\`\`\`http
POST ${sample.links.invoke}
Content-Type: application/json
Idempotency-Key: <your-saved-32-to-128-character-key>
PAYMENT-SIGNATURE: <client-authorized-exact-challenge>

${json({version:sample.version,input:sample.example_input,max_charge_usdc_atomic:sample.pricing.minimum_amount_atomic,success_contract_sha256:'<verified-success-sha256>',payment_requirements_sha256:'<verified-payment-sha256>'})}
\`\`\`

Successful response excerpt (illustrative; the full response includes output, contract pins and payment details):

\`\`\`json
{"operation_id":"<operation-id>","execution":"completed",
 "payment":{"status":"facilitator_confirmed",
 "amount_settled_atomic":"10000","onchain_reconciled":false}}
\`\`\`

There is no public receipt GET route; retain the response and use identical POST replay. Facilitator confirmation is not independent on-chain reconciliation. [Complete buyer guide](/buy).

## Prices, quotes and previews

- To pay more, \`POST /v1/products/{id}/quote\` with \`version\`, \`input\`, \`payment_amount_atomic\` and the verified success pin. Verify the returned payment pin and authorize the quote's challenge. Invoke with its \`quote_id\`, exact input, amount and pins. Do not reuse the minimum-price payment hash for a higher quote.
- Quotes freeze input, version, amount and pins. \`max_charge_usdc_atomic\` is a ceiling, not a price selector. Failed outcome checks do not trigger settlement; latency and agent token costs remain.
- Docs Pack and ContractCases offer limited previews: 10/client/day, 50 globally/day, 16 active, up to 2,000 preview bytes, 15-minute unpaid expiry. Full results are withheld. A prepared purchase needs a quote even at the minimum, \`prepared_id\` instead of \`input\`, and the same private \`X-Preparation-Capability\`. [Preparation instructions](/buy#optional-real-input-previews).

## Sell tools

Current fee: $0 ($0.50 list, 100% off). Approved creators retain 90% lifetime gross entitlement. Approval reviews metadata only; it does not install, publish or execute the submitted endpoint. A separately reviewed implementation and security/outcome review are still needed. Paid fees, payouts and refund transfers are disabled.

1. Read [creator terms](${m.origin}/v1/creator-terms). Current terms: \`${seller.terms_version}\`.
2. Generate and privately retain an \`atbc_\` capability from 32 random bytes. It controls both private status and future updates; there is no recovery grant.
3. Save/export the exact \`request_id\` and JSON body before \`POST /v1/tool-submissions\`. Send the capability only in \`X-Creator-Capability\`; include its SHA-256 as \`creator_secret_hash\`, the \`terms_version\`, and \`proposal\` in the body. Never store the capability in URLs, public fields or browser web storage.
4. Retain the returned \`submission_id\` and \`tool_id\`. Read status with \`GET /v1/tool-submissions/{submission_id}\` and the same capability. After a lost response, replay the saved body and capability unchanged.

[Submission form with export/import](${m.origin}/submit-tool) · [Exact seller requests + schemas](/sell)

### Update an approved tool

Read \`GET /v1/creator-tools/{tool_id}\`. Map \`current_version\` to \`base_version\` and \`head_revision\` to \`expected_head_revision\`. Save the exact update body with a new \`request_id\`, strictly higher \`proposed_version\`, \`proposal\`, \`creator_secret_hash\` and original frozen \`terms_version\`.

\`POST /v1/creator-tools/{tool_id}/updates\` uses the same capability. Read \`GET /v1/tool-updates/{update_id}\` for status. Pending or rejected updates keep the last approved version. Approval preserves the original entitlement; activation is still separate. [Update form with export/import](${m.origin}/update-tool).

## Machine-readable

- This document: [llms.txt](/llms.txt) · [AGENTS.md](/AGENTS.md). Compact manifest: [agent.json](/agent.json).
- [OpenAPI](${m.machine.openapi}) · MCP: ${m.machine.mcp}. Use MCP for discovery and supported workflows; paid invocations use HTTP x402.
- [Outcomes sold](${m.origin}/v1/stats): purchases including repeats, not unique or verified agents.
- [Feedback, reviews and outcome reports](/buy#after-the-result). [First-party referral terms](${m.origin}/v1/referral-terms): 1% accrual, creator tools excluded, no payouts.

This document is a source-derived snapshot. Verify current canonical contracts before authorizing. External-agent paid-purchase proof remains unverified.
`;
}
export function buyMarkdown(m){
 const p=m.tools.find(p=>p.id==='contract-cases')??m.tools[0];
 return `# Buy tools — AgentToolbox

Use ${m.origin} for every operational request. This site is a guide, with no wallet or ledger.

1. Choose a tool in ${m.siteOrigin}/agent.json; read its input/output schemas, limits and exact success contract. Every current tool is first-party and experimental; live payment behavior and external paid-buyer proof are not independently verified.
2. Inspect static fixtures at the tool's /examples URL. These are offline synthetic cases, not live evidence. input_valid means accepted by the full runtime contract including host/subset/seed restrictions, not just JSON Schema shape.
3. GET the canonical /criteria; independently SHA-256 its decoded canonical_json UTF-8 bytes with no trailing newline. Compare sha256. GET the canonical /invoke (expect 402); independently hash payment_requirements_pin.canonical_json and compare sha256. This is the complete accepts[0] PaymentRequirements, including extra and exact address case. Use the published agenttoolbox-json-v1 profile.
4. Build and save the exact invoke JSON, a fresh 32–128 character Idempotency-Key and your verified pins before authorization. Direct minimum calls need no quote. max_charge_usdc_atomic caps spending; it does not select a higher price.
5. Have your x402 v2 exact client authorize the disclosed USDC amount on Base. POST the same body/key with PAYMENT-SIGNATURE to the exact canonical resource URL. Settlement begins only after the published outcome checks pass.
6. Save the response, operation_id, returned contract_pins, payment receipt and PAYMENT-RESPONSE header. A receipt is facilitator-confirmed, not independently reconciled on-chain proof.
7. If delivery is uncertain, replay the original POST with the identical body, key and original authorization (and original preparation capability if used). There is no separate public receipt GET route. Completed output replay lasts 24 hours. An unresolved settlement requires reconciliation; never issue a replacement authorization.

## Concrete minimum-price request

Read the current contract and pins first; do not treat a snapshot as authorization.

GET ${p.links.criteria}
GET ${p.links.invoke}
POST ${p.links.invoke}
Content-Type: application/json
Idempotency-Key: <save-a-fresh-32-to-128-character-key>
PAYMENT-SIGNATURE: <your-client-authorized-exact-challenge>

\`\`\`json
${json({version:p.version,input:p.example_input,max_charge_usdc_atomic:p.pricing.minimum_amount_atomic,success_contract_sha256:'<verified-success-sha256>',payment_requirements_sha256:'<verified-payment-sha256>'})}
\`\`\`

Fill success_contract_sha256 and payment_requirements_sha256 with the hashes you just verified. Preserve the resulting body unchanged for retries. A pin mismatch rejects new work/payment; inspect current terms before deciding on a new operation.

## Choose a higher amount

POST ${m.origin}/v1/products/{id}/quote with version, input, payment_amount_atomic and the verified success_contract_sha256. Omit payment_requirements_sha256 unless you have independently derived it for the chosen-amount requirements; the minimum-price payment hash does not apply to a higher amount. Use decimal USDC atomic-unit strings (6 decimals). Independently verify the returned payment_requirements_pin.canonical_json hash and inspect payment.accepts[0]. Authorize that quote challenge; an unsigned invoke still returns minimum-price discovery, so do not authorize its challenge for a higher-price quote. Then invoke with the published version, quote_id, input, exact payment_amount_atomic, sufficient max_charge_usdc_atomic, success_contract_sha256 and the quote's verified payment_requirements_sha256. Quotes freeze input, version, amount and pins; inspect their expiry. A quote never settles.

## Optional real-input previews

Only Docs Pack and ContractCases support preparation. Inspect supported hosts or accepted schema subset first. Create and retain a private atbp_ capability from 32 random bytes; send it only as X-Preparation-Capability. Prepare body: version, input, request_id, SHA-256(capability) as prepare_secret_hash, optional success_contract_sha256. POST the tool's /prepare. This performs real work, returns a limited preview, and withholds the full result. Budget: 10/client/day, 50 globally/day; 16 active; preview up to 2,000 bytes. Unpaid expiry: 15 minutes. Then quote and invoke with prepared_id instead of input, the same capability, and the quote's exact amount/pins. One purchase may claim a preparation. The complete contract is authoritative.

## After the result

Private feedback: POST ${m.origin}/v1/feedback with a stable Idempotency-Key; include no secrets. Self-reported outcome: POST ${m.origin}/v1/runs/{operation_id}/outcome; it does not alter payment. Public reviews require explicit publication consent; see ${m.origin}/v1/products/{id}/reviews and OpenAPI. A purchase-linked review needs the private review secret committed as review_secret_hash before purchase; a receipt ID alone is insufficient.

First-party referral pilot: ${m.origin}/v1/referral-terms. Generate and retain an atbf_ capability; register via POST ${m.origin}/v1/referrals with X-Referral-Capability and the exact terms_version. Retrying with the same capability returns the same account. Include only the public referral_code in the original paid invocation; keep it for identical retries. Private accrual: GET ${m.origin}/v1/referrals/me with that capability. Rate: 1% gross; creator tools excluded; no payout processor or transfers.

Full schemas: ${m.machine.openapi}
MCP endpoint: ${m.machine.mcp}; use discovery tools here and HTTP for paid invocations.
`;
}
export function toolMarkdown(m,p){
 return `# ${p.name} — AgentToolbox

${p.fit}
${p.problem}

Provider: ${p.provider.name}, first-party. Experimental version ${p.version}.
Cost: from ${p.price_label} per published success; USDC on Base, buyer chosen amount. Latency and agent token costs remain on failed outcomes.
Scope: ${p.scope}
Success: ${p.outcome.success_criterion}
Failure policy: ${p.failure_policy}

## Inspect, test, pin, call

Full current contract: ${p.links.detail}
Current success checks and verifiable pin: ${p.links.criteria}
Source snapshot success hash (verify current contract before authorizing): ${p.success_pin.sha256}
Free static fixtures: ${p.links.examples}
Fixtures are first-party synthetic offline cases, not live outcomes. input_valid covers the full runtime-accepted contract, including host/subset/seed constraints.
${p.preview.supported?'Limited real-input preview: '+p.links.preview+'\nPreparation API: POST '+p.links.prepare:'No real-input preview: a decisive verdict is the paid output.'}
Read-only minimum challenge/pin: GET ${p.links.payment_requirements} (402 expected)
Direct minimum call: POST ${p.links.invoke}
Optional higher/prepared quote: POST ${p.links.quote}
Exact buyer procedure and receipt replay: ${m.siteOrigin}/buy.md
Reviews: ${p.links.reviews}

## Example input

\`\`\`json
${json(p.example_input)}
\`\`\`

## Runtime limits

\`\`\`json
${json(p.limits)}
\`\`\`

${p.preview.supported?'Preview limits: '+json(p.preview.limits):''}

## Schemas and retention

Input and output schemas: ${p.links.detail}
${json(p.data_handling)}
`;
}
export function sellMarkdown(m){
 const t=m.sellerTerms;
 return `# Sell tools — AgentToolbox

Turn an agent-built tool into a reviewed proposal. Browser forms: ${m.origin}/submit-tool and ${m.origin}/update-tool
Current canonical terms: ${m.origin}/v1/creator-terms
Typed request/response schemas: ${m.machine.openapi}

## Terms and activation stages

Current actual submission fee: $0. The $0.50 USDC list fee is 100% discounted. Approved creators retain 90% lifetime gross revenue for their tool; operating costs and referral commissions do not reduce that entitlement. Rejection refunds the actual fee paid; today no fee is paid and no refund is due. Nonzero charges, payouts and refund transfers are disabled.

1. Submit private proposed metadata under the frozen terms.
2. The owner reviews it and approves or rejects the metadata. An approval records the entitlement; it does not install, publish or execute the endpoint.
3. Publication and execution require a separately reviewed implementation/adapter, bounded schemas, success checks and operational security review. This is a manual remaining stage, not an automatic activation API or a promised activation date.
4. Payout processing remains unimplemented. An accounting entitlement or accrual is not a transfer.

## Prepare before POST

Generate a cryptographically random 32-byte capability as canonical unpadded base64url, prefixed atbc_. Retain it privately. SHA-256 the UTF-8 capability string for creator_secret_hash. The capability controls BOTH private status and future updates; it does not prove identity or wallet ownership. There is no recovery grant.

Before sending, save/export the exact request_id and JSON body. Keep the capability separately in a private secret store; never URLs, public proposal fields, logs or browser web storage. If the response is lost, import/reuse the saved request envelope with the original capability rather than generating another request identity.

POST ${m.origin+t.submit_path}
Content-Type: application/json
X-Creator-Capability: <your-retained-private-capability>

\`\`\`json
${json({request_id:'<fresh-32-to-128-character-request-id>',creator_secret_hash:'<SHA-256-of-capability>',terms_version:t.terms.terms_version,proposal:{name:'Example tool',summary:'A bounded outcome with a measurable success condition.',endpoint_url:'https://your-tool.example/api',input_schema:{type:'object'},output_schema:{type:'object'}}})}
\`\`\`

All proposal URLs and schemas are private untrusted metadata and are never fetched/executed by intake. No credentials, query strings, fragments, explicit ports, or private/IP hosts in endpoint_url. Schema limit 4,000 UTF-8 bytes each; total body 16,384 bytes; shared submission/update budget 4/client/day and 40/global/day. Inspect current canonical terms for complete bounds.

## Status and updates

Send X-Creator-Capability directly to the canonical API:
GET ${m.origin+t.status_path}
GET ${m.origin+t.approved_tool_path}
POST ${m.origin+t.update_path}
GET ${m.origin+t.update_status_path}

Use the same capability and stable tool_id. Read current_version and head_revision from the approved tool; map them to base_version and expected_head_revision in the update body. Include a strictly higher canonical semantic proposed_version, request_id, proposal, creator_secret_hash and the original frozen terms_version. Save/export the exact update body before POST; retry it unchanged after uncertainty. An update requires owner review and retains the last approved version while pending or rejected. Approval preserves the original 90% gross entitlement and frozen terms; it does not install an adapter. A stale head returns a conflict; reread before consciously creating a new proposal.

MCP discovery/workflows: ${m.machine.mcp}. Use submit_tool, get_tool_submission, get_creator_tool, submit_tool_update and get_tool_update according to their schemas. Preserve the same private capability and request identity.

First-party referrals are separate: ${m.origin}/v1/referral-terms. They accrue 1% only on AgentToolbox's four tools and never reduce creator entitlements. No transfers.
`;
}
