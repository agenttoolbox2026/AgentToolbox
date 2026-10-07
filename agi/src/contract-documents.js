import {freeExampleManifest} from '../../platform/src/free-examples.js';
import {markdownText} from './machine.js';
import {isPublishedTool} from './catalog.js';
const json=value=>JSON.stringify(value,null,2);
const block=value=>'```json\n'+json(value)+'\n```';
const identity=p=>`Created by: ${markdownText(p.provider.name)} (${markdownText(p.provider.type==='first_party'?'first-party':p.provider.type)}).\nVersion: ${p.version}. ${p.maturity==='beta'?'Beta.':''}`;
const links=p=>`[Tool guide](/tools/${p.id}) · [Success checks](/tools/${p.id}/checks)${p.links.examples?` · [Synthetic examples](/tools/${p.id}/examples)`:''} · [Reviews](${p.links.reviews}) · [Private feedback](/feedback?tool=${p.id})`;

export function contractDocument(model,tool,kind){
 if(!isPublishedTool(tool)||!tool.success_pin?.sha256||!tool.links?.invoke)return null;
 const intro=identity(tool)+'\n\n'+links(tool);
 if(kind==='checks')return {data:tool.success_pin,markdown:`# ${markdownText(tool.name)}: success checks

${intro}

Cost: from ${tool.price_label} per published success. ${tool.outcome.success_criterion}

These are paid-outcome checks, not a guarantee of usefulness, truth, certification or exhaustive coverage. Read the scope and failure policy in the [tool guide](/tools/${tool.id}). A qualifying negative verdict can still be a successful paid result.

## Verify the current contract

[Canonical checks JSON](${tool.links.criteria}) · [Minimum payment challenge](${tool.links.invoke}) · [Exact buyer procedure](/buy)

Re-fetch the current JSON before authorizing. Hash its decoded canonical_json UTF-8 bytes, with no trailing newline, and compare sha256. The display below comes from the same published contract; a saved page is not a payment authorization.

${block(tool.success_pin)}
`};
 if(kind==='examples'){
  const fixture=tool.links.examples&&tool.provider.id==='agenttoolbox'&&tool.provider.type==='first_party'?freeExampleManifest(tool.id):null;
  if(!fixture)return null;
  return {data:fixture,markdown:`# ${markdownText(tool.name)}: synthetic examples

${intro}

Free offline fixtures; no tool runs, source fetches, endpoint probes or payments occur here. They are examples of the contract, not customer reviews or evidence of live demand. input_valid means the full runtime accepts the input, including host, schema-subset and seed constraints.

[Canonical fixture JSON](${tool.links.examples})${tool.links.preview&&tool.links.prepare?` · [Limited real-input preview](${tool.links.preview})`:''}

${block(fixture)}
`};
 }
 if(kind==='contract')return {data:tool,markdown:`# ${markdownText(tool.name)}: contract

${intro}

${markdownText(tool.problem??tool.summary)}

${tool.scope?'Scope: '+markdownText(tool.scope)+'\n':''}
Cost: from ${tool.price_label} per published success; buyer-chosen amount, USDC on Base.
Success: ${tool.outcome.success_criterion}
${tool.failure_policy?'Failure policy: '+markdownText(tool.failure_policy)+'\n':''}

[Canonical contract JSON](${tool.links.detail}) · [Buyer guide](/buy)

## Input schema

${block(tool.input_schema)}

## Output schema

${block(tool.output_schema)}

${tool.limits?'## Limits\n\n'+block(tool.limits):''}
`};
 return null;
}

export function sellerTermsDocument(model){return `# Seller terms — AgentToolbox

Free during the 100% off promotion (list price $0.50 USDC). Approved creators retain 90% lifetime gross entitlement under their original frozen terms. Approval records the entitlement. A reviewed implementation must be compiled and installed before publication and execution. Current [payout operations](/creator-wallet) add destination proof, private earnings, owner-reviewed requests and finalized receipt status without changing the accepted financial terms.${model.payoutRequestsEnabled===true?'':' Payout requests are temporarily unavailable while owner operations are being verified; wallet proof, earnings and existing request status remain available.'}

[Seller guide](/sell) · [Submit a private proposal](/submit-tool) · [Canonical terms JSON](${model.origin}/v1/creator-terms)

## Frozen financial contract

Launch-time transfer limitations in these historical terms do not describe the current request workflow. Payout requests require separate destination proof and owner approval; the owner signs externally.

Keep the exact accepted terms_version and your private capability for status and versioned updates. Never share private keys, wallet seed phrases or capability secrets in proposal text or feedback.

${block(model.sellerTerms)}
`;}
