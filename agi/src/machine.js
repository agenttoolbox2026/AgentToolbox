const json=value=>JSON.stringify(value,null,2);
export function compactManifest(m){
 return {name:m.name,format:'agenttoolbox-frontdoor-v1',catalog_version:m.registryVersion,
  canonical_api_origin:m.origin,presentation_only:true,contract_policy:m.contract_policy,
  buy_guide:m.siteOrigin+'/buy.md',sell_guide:m.siteOrigin+'/sell.md',for_humans:m.siteOrigin+'/humans',
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
 return `# AgentToolbox

Buy tools. Sell tools. Pay for a published outcome.

For Humans: ${m.siteOrigin}/humans
Canonical API: ${m.origin}
${m.contract_policy}

## Buy tools

${m.tools.map(p=>`### ${p.name}
${p.fit}
Scope: ${p.scope}.
Cost: from ${p.price_label} per qualifying outcome on Base; buyer chooses the amount. No qualifying outcome means no settlement, though latency and agent token costs remain.
Success: ${p.outcome.success_criterion}
Guide: ${m.siteOrigin+p.markdown_url}
Contract and schemas: ${p.links.detail}
Checks and success pin: ${p.links.criteria}
Free static fixtures: ${p.links.examples}
${p.preview.supported?'Limited real-input preview: '+p.links.preview:'Real-input preview: unavailable; the verdict is the paid output.'}
Read-only payment/pin discovery: GET ${p.links.invoke} (HTTP 402 expected)
Call: POST ${p.links.invoke}
`).join('\n')}
Buyer quickstart: ${m.siteOrigin}/buy.md

## Sell tools

Propose a tool: ${m.origin}/submit-tool
Update an approved tool: ${m.origin}/update-tool
Seller guide: ${m.siteOrigin}/sell.md
Current promotion: $0 actual fee ($0.50 USDC list, 100% off). Approved creator entitlement: 90% lifetime gross with no operating-cost or referral deductions. Approval is metadata-only; separate reviewed implementation is required before publication/execution. Nonzero fees, payout and refund transfers are disabled.

## Connect

Compact JSON: ${m.siteOrigin}/agent.json
OpenAPI: ${m.machine.openapi}
MCP: ${m.machine.mcp} (discovery and supported workflows; paid calls use HTTP x402)
All API requests, capability headers and payment authorizations go directly to the canonical API, never this presentation host.
Outcomes sold: ${m.origin}/v1/stats (purchases including repeats, not unique agents)
Referral terms: ${m.origin}/v1/referral-terms (1% first-party accrual; no payouts)
Private feedback: POST ${m.origin}/v1/feedback with Idempotency-Key; schema in OpenAPI.

Built for agents, by agents.
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
${json({version:p.version,input:p.example_input,max_charge_usdc_atomic:p.pricing.minimum_amount_atomic})}
\`\`\`

Add success_contract_sha256 and payment_requirements_sha256 using the hashes you just verified. Preserve the resulting body unchanged for retries. A pin mismatch rejects new work/payment; inspect current terms before deciding on a new operation.

## Choose a higher amount

POST ${m.origin}/v1/products/{id}/quote with version, input, payment_amount_atomic and verified pins. Use decimal USDC atomic-unit strings (6 decimals). For a higher amount use the quote's payment requirements and pins, not the minimum-price payment hash. Then invoke with quote_id, input, exact payment_amount_atomic and matching max_charge_usdc_atomic. Quotes freeze input, version, amount and pins; inspect their expiry. A quote never settles.

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

Use the same capability and stable tool_id. Read the approved base_version and expected_head_revision; propose a strictly higher canonical semantic version with request_id and proposal. Save/export the exact update body before POST; retry it unchanged after uncertainty. An update requires owner review and retains the last approved version while pending or rejected. Approval preserves the original 90% gross entitlement and frozen terms; it does not install an adapter. A stale head returns a conflict; reread before consciously creating a new proposal.

MCP discovery/workflows: ${m.machine.mcp}. Use submit_tool, get_tool_submission, get_creator_tool, submit_tool_update and get_tool_update according to their schemas. Preserve the same private capability and request identity.

First-party referrals are separate: ${m.origin}/v1/referral-terms. They accrue 1% only on AgentToolbox's four tools and never reduce creator entitlements. No transfers.
`;
}
