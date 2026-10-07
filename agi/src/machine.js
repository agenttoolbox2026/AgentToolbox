import {selectCatalog,CATALOG_LIMITS} from './catalog.js';
const json=value=>JSON.stringify(value,null,2);
const markdownText=value=>String(value??'').replace(/\s+/gu,' ').trim()
 .replace(/[\\`*_[\]<>#!]/g,'\\$&').replace(/^(\d+)([.)])(?=\s)/,'$1\\$2').replace(/^[-+](?=\s)/,'\\$&');
export function toolManifest(m,p){
 return {id:p.id,name:p.name,version:p.version,provider:p.provider,experimental:p.experimental,
  use_when:p.fit,scope:p.scope,minimum_amount_atomic:p.pricing.minimum_amount_atomic,decimals:p.pricing.decimals,
  currency:p.pricing.currency,network:p.pricing.network,pricing_model:p.pricing.model,
  success_criterion:p.outcome.success_criterion,success_contract_sha256_snapshot:p.success_pin.sha256,
  guide:m.siteOrigin+p.markdown_url,preview_supported:p.preview.supported,...p.links};
}
export function compactManifest(m){
 const page=selectCatalog(m);
 return {name:m.name,format:'agenttoolbox-frontdoor-v1',catalog_version:m.registryVersion,
  canonical_api_origin:m.origin,contract_policy:m.contract_policy,
  buy_guide:m.siteOrigin+'/buy.md',sell_guide:m.siteOrigin+'/sell.md',for_humans:m.origin+'/humans',
  ...m.machine,
  catalog_page:m.siteOrigin+'/tools',catalog_markdown:m.siteOrigin+'/tools.md',catalog_json:m.siteOrigin+'/tools.json',
  tools:page.tools.map(p=>toolManifest(m,p)),total:page.total,
  pagination:{page:page.page,limit:page.limit,page_count:page.pageCount,start:page.start,end:page.end},
  next:page.nextUrl?m.siteOrigin+page.nextUrl.replace('/tools','/tools.json'):null,
  seller:{terms:m.origin+'/v1/creator-terms',submit:m.origin+'/v1/tool-submissions',browser_submit:m.origin+'/submit-tool',
   browser_update:m.origin+'/update-tool',charged_fee_atomic:m.sellerTerms.terms.charged_fee_atomic,
   share_bps:m.sellerTerms.terms.share_bps,approval_effect:m.sellerTerms.terms.approval_effect,transfers_enabled:false},
  referrals:{terms:m.origin+'/v1/referral-terms',first_party_only:true,share_bps:m.referralTerms.terms.share_bps,transfers_enabled:false},
  outcomes_sold:m.origin+'/v1/stats',outcomes_sold_meaning:'Completed live purchases, including repeats; not unique agents or independently reconciled revenue.',
 };
}
export function homeMarkdown(m){
 return `# AgentToolbox

> Tools for agents. Pay when the published outcome checks pass.

Buy tools with buyer-chosen prices from $0.01 USDC on Base through x402, or submit a tool proposal for review.

[Browse tools](/tools) · [Buy tools](#buy-tools) · [Sell tools](#sell-tools)

## Buy tools

1. Browse the catalog. Check the creator, scope, price and published outcome before choosing a tool.
2. Read its contract, checks and free synthetic examples. Verify the current success and payment pins; use a limited preview where offered.
3. Save the exact request and \`Idempotency-Key\`, authorize with an x402 v2 exact client, then invoke. A direct minimum-price call needs no quote.
4. Retain the result and receipt. Settlement is attempted only after the published checks pass; a qualifying negative verdict can be a paid result.

After uncertain delivery, replay the identical body, key and original authorization. Unknown settlement: stop for reconciliation; never create a replacement authorization.

[Buyer guide: exact requests, prices and recovery](/buy) · [Reviews](/reviews) · [Feedback](/feedback)

## Sell tools

Submit a private proposal for free. Approved creators retain 90% lifetime gross entitlement under frozen terms. Approval covers metadata; publication and execution need a separately reviewed implementation, security review and outcome checks. Payouts are unavailable. Retain your private capability to read status and propose updates; there is no recovery grant.

[Submit proposal](${m.origin}/submit-tool) · [Seller guide](/sell)

## Machine-readable

[llms.txt](/llms.txt) · [AGENTS.md](/AGENTS.md) · [agent.json](/agent.json) · [OpenAPI](${m.machine.openapi}) · [MCP](${m.machine.mcp})

MCP supports discovery and documented workflows; paid calls use HTTP x402. Verify current contracts before authorizing.
`;
}
export function catalogMarkdown(m,selection){
 const fit={
  'docs-pack':p=>`Gather literal query-matched excerpts from up to ${p.limits.max_urls} documentation pages across ${p.limits.supported_hosts.length} supported hosts. Every requested page must match; no partial-pack charge.`,
  'quote-proof':()=>`Check literal quotation fidelity against supported documentation. Matches, absent quotes and ambiguous repeated occurrences may qualify for payment; unknown results alone cannot. This does not verify truth.`,
  'contract-cases':()=>`Generate boundary and negative tests for a bounded JSON Schema subset using a valid seed. Cases are revalidated against the accepted schema; coverage gaps stay explicit.`,
  'mcp-wirecheck':()=>`Inspect anonymous MCP discovery and tools/list on a public workers.dev endpoint you own or are authorized to check; no tools/call. Incompatible verdicts can qualify for payment. Auth-required, blocked, unsupported or unknown outcomes alone cannot.`,
 };
 const {tools,query,page,limit,total,catalogTotal,pageCount,start,end,previousUrl,nextUrl}=selection;
 const navigation=[previousUrl?`[Previous](${previousUrl})`:null,`Page ${page} of ${pageCount}`,nextUrl?`[Next](${nextUrl})`:null].filter(Boolean).join(' · ');
 const queryText=JSON.stringify(query).replaceAll('`','\\u0060');
 return `# Browse tools

Search published tools by name, purpose, tag or creator. Each entry links to its guide, current contract and outcome checks.

[How to buy](/buy) · [Sell tools](/sell) · [Reviews](/reviews) · [Feedback](/feedback)

Search: \`GET /tools?q=your+query\`. Use up to ${CATALOG_LIMITS.query_chars} characters; \`page\` starts at 1 and \`limit\` defaults to ${CATALOG_LIMITS.default_limit}, capped at ${CATALOG_LIMITS.max_limit}. [Clear search](/tools).

${query?`Query: \`${queryText}\`. `:''}${total?`Showing ${start}–${end} of ${total} matching tools`:'No matching tools'}; ${catalogTotal} published tools. ${limit} per page.

${navigation}

${tools.map(p=>{
 const path='/tools/'+encodeURIComponent(p.id);
 return `## [${markdownText(p.name)}](${path})

Creator: ${markdownText(p.provider.name)} (\`${p.provider.type}\`). From ${p.price_label} on ${p.pricing.network==='eip155:8453'?'Base':p.pricing.network}. ${p.experimental?'Experimental. ':''}Version \`${p.version}\`.

${markdownText(fit[p.id]?.(p)??p.summary??p.problem)}

[Contract JSON](${p.links.detail}) · [Checks](${path}/checks) · [Synthetic examples](${path}/examples)${p.preview.supported?` · [Limited preview](${p.links.preview})`:''} · [Reviews](${p.links.reviews})
`;
 }).join('\n')}
${tools.length?navigation+'\n\n':''}Checks define the paid outcome, not usefulness or certification. Examples are free offline fixtures; previews withhold full output and have [preparation limits](/buy#optional-real-input-previews).

[Catalog JSON](${selection.canonicalUrl.replace('/tools','/tools.json')}) · [Catalog Markdown](${selection.canonicalUrl.replace('/tools','/tools.md')}) · [OpenAPI](${m.machine.openapi})
`;
}
export function buyMarkdown(m){
 const p=m.tools.find(p=>p.id==='contract-cases')??m.tools[0];
 const docs=m.tools.find(tool=>tool.id==='docs-pack');
 return `# Buy tools — AgentToolbox

Use ${m.origin} for operational requests. Browse the [tool catalog](/tools) or read the [catalog JSON](/tools.json) and current contracts before authorizing payment.

1. Choose a published tool from the catalog and check its creator, input/output schemas, limits and exact success contract. Experimental status is shown per tool; live payment behavior and external paid-buyer proof are not independently verified.
2. Inspect static fixtures at the tool's /examples URL. These are offline synthetic cases, not live evidence. input_valid means accepted by the full runtime contract including host/subset/seed restrictions, not just JSON Schema shape.
3. GET the canonical /criteria; independently SHA-256 its decoded canonical_json UTF-8 bytes with no trailing newline. Compare sha256. GET the canonical /invoke (expect 402); independently hash payment_requirements_pin.canonical_json and compare sha256. This is the complete accepts[0] PaymentRequirements, including extra and exact address case. Use the published agenttoolbox-json-v1 profile.
4. Build and save the exact invoke JSON, a fresh 32–128 character Idempotency-Key and your verified pins before authorization. Direct minimum calls need no quote. max_charge_usdc_atomic caps spending; it does not select a higher price.
5. Have your x402 v2 exact client authorize the disclosed USDC amount on Base. POST the same body/key with PAYMENT-SIGNATURE to the exact canonical resource URL. Settlement begins only after the published outcome checks pass.
6. Save the response, operation_id, returned contract_pins, payment receipt and PAYMENT-RESPONSE header. A receipt is facilitator-confirmed, not independently reconciled on-chain proof.
7. If delivery is uncertain, replay the original POST with the identical body, key and complete original authorization (and original preparation capability if used). There is no separate public receipt GET route. Completed output replay lasts 24 hours. Unknown or unresolved settlement: stop for reconciliation; never issue a replacement authorization.

For an operation authorized before the origin migration, send the replay to the corresponding AGI endpoint while preserving the original body, key, capability and complete PAYMENT-SIGNATURE, including the old resource URL inside that authorization. Do not replace or rewrite it.

## What can qualify for payment

Docs Pack requires literal query-term matches on every requested page: up to ${docs.limits.max_urls} pages from ${docs.limits.supported_hosts.length} supported hosts. No semantic relevance or completeness guarantee; no partial-pack charge.

QuoteProof checks literal quotation fidelity, not truth. Exact or whitespace-normalized matches, absent quotes and ambiguous repeated occurrences can satisfy its published checks; unknown results alone cannot. Absence requires complete plain-text evidence; HTML absence remains unknown.

ContractCases accepts only its bounded JSON Schema subset and requires a valid seed. Every generated case is checked against the complete accepted schema; coverage gaps are explicit, not certification.

MCP WireCheck requires ownership or authorization for anonymous read-only discovery on a public canonical workers.dev endpoint. It checks discovery and bounded tools/list, never tools/call. A qualifying incompatible verdict can be paid; auth_required, blocked, unsupported or unknown outcomes alone cannot. This is not protocol or security certification. Read each tool's contract for exact accepted inputs, predicates and limits.

## Concrete minimum-price request

Read the current contract and pins first; do not treat a snapshot as authorization.

Fetch [success checks and pin](${p.links.criteria}) and the [unsigned 402 payment challenge](${p.links.invoke}). Save the final request before authorization:

\`\`\`http
POST ${p.links.invoke}
Content-Type: application/json
Idempotency-Key: <save-a-fresh-32-to-128-character-key>
PAYMENT-SIGNATURE: <your-client-authorized-exact-challenge>

${json({version:p.version,input:p.example_input,max_charge_usdc_atomic:p.pricing.minimum_amount_atomic,success_contract_sha256:'<verified-success-sha256>',payment_requirements_sha256:'<verified-payment-sha256>'})}
\`\`\`

Fill success_contract_sha256 and payment_requirements_sha256 with the hashes you just verified. Preserve the resulting body unchanged for retries. A pin mismatch rejects new work/payment; inspect current terms before deciding on a new operation.

Successful response excerpt (illustrative; save the full response, including output and contract pins):

\`\`\`json
{"operation_id":"<operation-id>","execution":"completed",
 "payment":{"status":"facilitator_confirmed",
 "amount_settled_atomic":"10000","onchain_reconciled":false}}
\`\`\`

Facilitator confirmation is not independent on-chain reconciliation. Failed outcome checks do not trigger settlement; latency and agent token costs remain.

## Choose a higher amount

POST ${m.origin}/v1/products/{id}/quote with version, input, payment_amount_atomic and the verified success_contract_sha256. Omit payment_requirements_sha256 unless you have independently derived it for the chosen-amount requirements; the minimum-price payment hash does not apply to a higher amount. Use decimal USDC atomic-unit strings (6 decimals). Independently verify the returned payment_requirements_pin.canonical_json hash and inspect payment.accepts[0]. Authorize that quote challenge; an unsigned invoke still returns minimum-price discovery, so do not authorize its challenge for a higher-price quote. Then invoke with the published version, quote_id, input, exact payment_amount_atomic, sufficient max_charge_usdc_atomic, success_contract_sha256 and the quote's verified payment_requirements_sha256. Quotes freeze input, version, amount and pins; inspect their expiry. A quote never settles.

## Optional real-input previews

Only Docs Pack and ContractCases support preparation. Inspect supported hosts or accepted schema subset first. Create and retain a private atbp_ capability from 32 random bytes; send it only as X-Preparation-Capability. Prepare body: version, input, request_id, SHA-256(capability) as prepare_secret_hash, optional success_contract_sha256. POST the tool's /prepare. This performs real work, returns a limited preview, and withholds the full result. Budget: 10/client/day, 50 globally/day; 16 active; preview up to 2,000 bytes. Unpaid expiry: 15 minutes. Then quote and invoke with prepared_id instead of input, the same capability, and the quote's exact amount/pins. One purchase may claim a preparation. The complete contract is authoritative.

## After the result

Private feedback: POST ${m.origin}/v1/feedback with a stable Idempotency-Key; include no secrets. Self-reported outcome: POST ${m.origin}/v1/runs/{operation_id}/outcome; it does not alter payment. Public reviews require explicit publication consent; see ${m.origin}/v1/products/{id}/reviews and OpenAPI. A purchase-linked review needs the private review secret committed as review_secret_hash before purchase; a receipt ID alone is insufficient.

First-party referral pilot: [detailed terms](${m.origin}/v1/referral-terms). Generate and retain an atbf_ capability; register via POST ${m.origin}/v1/referrals with X-Referral-Capability and the exact terms_version. Retrying with the same capability returns the same account. Include only the public referral_code in the original paid invocation; keep it for identical retries. Private accrual: GET ${m.origin}/v1/referrals/me with that capability. Rate: 1% gross; creator tools excluded; no payout processor or transfers.

[Full schemas](${m.machine.openapi}) · [MCP discovery and workflows](${m.machine.mcp}); use HTTP for paid invocations.
`;
}
export function toolMarkdown(m,p){
 const path='/tools/'+encodeURIComponent(p.id);
 return `# ${markdownText(p.name)} — AgentToolbox

[Browse tools](/tools) · [Checks](${path}/checks) · [Synthetic examples](${path}/examples) · [Reviews](${p.links.reviews})

${markdownText(p.fit)}
${markdownText(p.problem)}

Creator: ${markdownText(p.provider.name)} (\`${p.provider.type}\`). ${p.experimental?'Experimental. ':''}Version \`${p.version}\`.
Cost: from ${p.price_label} per published success; USDC on Base, buyer chosen amount. Latency and agent token costs remain on failed outcomes.
Scope: ${markdownText(p.scope)}
Success: ${p.outcome.success_criterion}
Failure policy: ${p.failure_policy}

## Inspect, test, pin, call

Full current contract JSON: ${p.links.detail}
Current success checks JSON and verifiable pin: ${p.links.criteria}
Source snapshot success hash (verify current contract before authorizing): ${p.success_pin.sha256}
Free static fixtures JSON: ${p.links.examples}
Fixtures are synthetic offline cases, not live outcomes. input_valid covers the full runtime-accepted contract, including host/subset/seed constraints.
${p.preview.supported?'Limited real-input preview: '+p.links.preview+'\nPreparation API: POST '+p.links.prepare:'No real-input preview: verdicts that pass the published checks are the paid output. Read the buyer guide for qualifying negative verdicts.'}
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

Submit private proposed metadata for review. [Submit proposal](${m.origin}/submit-tool) · [Update proposal](${m.origin}/update-tool) · [Creator terms](${m.origin}/v1/creator-terms) · [Request schemas](${m.machine.openapi})

## Terms and activation stages

Current actual submission fee: $0 ($0.50 USDC list fee, 100% discounted). Approved creators retain 90% lifetime gross entitlement for their tool, without deductions for operating costs or referral commissions. Rejection refunds the actual fee paid; today no fee is paid and no refund is due. Nonzero charges and refund transfers are disabled. Payout processing remains unimplemented.

Approval records the entitlement under frozen terms; it does not install, publish or execute the endpoint. Publication and execution require a separately reviewed implementation/adapter, bounded schemas, success checks and operational security review. There is no automatic activation or promised activation date.

## Prepare before POST

Generate a cryptographically random 32-byte capability as canonical unpadded base64url, prefixed \`atbc_\`. Retain it privately. SHA-256 the UTF-8 capability string for \`creator_secret_hash\`. The capability controls both private status and future updates; it does not prove identity or wallet ownership. There is no recovery grant.

Keep the capability in a private secret store; never URLs, public proposal fields, logs or browser web storage. Before POST, save/export the exact \`request_id\` and JSON body. If the response is lost, replay that saved envelope and original capability unchanged.

\`\`\`http
POST ${m.origin+t.submit_path}
Content-Type: application/json
X-Creator-Capability: <your-retained-private-capability>

${json({request_id:'<fresh-32-to-128-character-request-id>',creator_secret_hash:'<SHA-256-of-capability>',terms_version:t.terms.terms_version,proposal:{name:'Example tool',summary:'A bounded outcome with a measurable success condition.',endpoint_url:'https://your-tool.example/api',input_schema:{type:'object'},output_schema:{type:'object'}}})}
\`\`\`

Proposal URLs and schemas are private untrusted metadata, never fetched or executed by intake. [Request schemas](${m.machine.openapi}) and [submission limits](${m.origin}/v1/creator-terms) define accepted endpoints, schema/body bounds and the shared submission/update budget.

## Status and updates

Retain returned \`submission_id\` and \`tool_id\`. Send the same \`X-Creator-Capability\` for status and updates:

\`\`\`http
GET ${m.origin+t.status_path}
GET ${m.origin+t.approved_tool_path}
POST ${m.origin+t.update_path}
GET ${m.origin+t.update_status_path}
\`\`\`

Read \`current_version\` and \`head_revision\` from the approved tool; map them to \`base_version\` and \`expected_head_revision\`. Include a strictly higher canonical semantic \`proposed_version\`, new \`request_id\`, \`proposal\`, \`creator_secret_hash\` and the original frozen \`terms_version\`. Save/export this exact update body before POST; retry unchanged after uncertainty.

Updates retain the last approved version while pending or rejected. Approval preserves the original entitlement and frozen terms; activation remains separate. A stale head returns a conflict; reread before consciously creating a new proposal.

[MCP workflows](${m.machine.mcp}) expose \`submit_tool\`, \`get_tool_submission\`, \`get_creator_tool\`, \`submit_tool_update\` and \`get_tool_update\`. Follow their schemas and preserve the same capability and request identity.
`;
}
