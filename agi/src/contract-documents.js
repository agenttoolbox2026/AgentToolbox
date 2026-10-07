import {freeExampleManifest} from '../../platform/src/free-examples.js';
const json=value=>JSON.stringify(value,null,2);
const block=value=>'```json\n'+json(value)+'\n```';
const identity=p=>`Created by: ${p.provider.name} (${p.provider.type==='first_party'?'first-party':p.provider.type}).\nVersion: ${p.version}. ${p.experimental?'Experimental.':''}`;
const links=p=>`[Tool guide](/tools/${p.id}) · [Success checks](/tools/${p.id}/checks) · [Synthetic examples](/tools/${p.id}/examples) · [Reviews](${p.links.reviews}) · [Private feedback](/feedback?tool=${p.id})`;

export function contractDocument(model,tool,kind){
 const intro=identity(tool)+'\n\n'+links(tool);
 if(kind==='checks')return {data:tool.success_pin,markdown:`# ${tool.name}: success checks

${intro}

Cost: from ${tool.price_label} per published success. ${tool.outcome.success_criterion}

These are paid-outcome checks, not a guarantee of usefulness, truth, certification or exhaustive coverage. Read the scope and failure policy in the [tool guide](/tools/${tool.id}). A qualifying negative verdict can still be a successful paid result.

## Verify the current contract

[Canonical checks JSON](${tool.links.criteria}) · [Minimum payment challenge](${tool.links.invoke}) · [Exact buyer procedure](/buy)

Re-fetch the current JSON before authorizing. Hash its decoded canonical_json UTF-8 bytes, with no trailing newline, and compare sha256. The display below comes from the same published contract; a saved page is not a payment authorization.

${block(tool.success_pin)}
`};
 if(kind==='examples'){
  const fixture=freeExampleManifest(tool.id);
  if(!fixture)return null;
  return {data:fixture,markdown:`# ${tool.name}: synthetic examples

${intro}

Free offline fixtures; no tool runs, source fetches, endpoint probes or payments occur here. They are examples of the contract, not customer reviews or evidence of live demand. input_valid means the full runtime accepts the input, including host, schema-subset and seed constraints.

[Canonical fixture JSON](${tool.links.examples})${tool.preview.supported?` · [Limited real-input preview](${tool.links.preview})`:''}

${block(fixture)}
`};
 }
 if(kind==='contract')return {data:tool,markdown:`# ${tool.name}: contract

${intro}

${tool.problem}

Scope: ${tool.scope}
Cost: from ${tool.price_label} per published success; buyer-chosen amount, USDC on Base.
Success: ${tool.outcome.success_criterion}
Failure policy: ${tool.failure_policy}

[Canonical contract JSON](${tool.links.detail}) · [Buyer guide](/buy)

## Input schema

${block(tool.input_schema)}

## Output schema

${block(tool.output_schema)}

## Limits

${block(tool.limits)}
`};
 return null;
}

export function sellerTermsDocument(model){return `# Seller terms — AgentToolbox

Free during the 100% off promotion (list price $0.50 USDC). Approved creators retain 90% lifetime gross entitlement under their original frozen terms. Approval covers metadata; publication, safe execution and payout processing remain separate stages. No payout service or wallet ownership verification is implied.

[Seller guide](/sell) · [Submit a private proposal](/submit-tool) · [Canonical terms JSON](${model.origin}/v1/creator-terms)

## Current contract

Keep the exact accepted terms_version and your private capability for status and versioned updates. Never share private keys, wallet seed phrases or capability secrets in proposal text or feedback.

${block(model.sellerTerms)}
`;}
