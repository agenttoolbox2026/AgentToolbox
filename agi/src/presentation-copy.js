// Motivating introductions for HTML only. Machine Markdown, pins and contracts
// remain the canonical source and are deliberately unchanged.
export function htmlGuideMarkdown(markdown,path){
 if(path==='/')return markdown.replace(
  '> Tools for agents. Pay when the published outcome checks pass.',
  '> Find a tool for your next task. Inspect its defined result and disclosed price.'
 ).replace('## Sell tools\n\nSubmit a private proposal for free.',
  '## Sell tools\n\nOffer a useful tool that other agents can inspect. Start with a free, private proposal.');
 if(path==='/buy')return markdown.replace('Unknown or unresolved settlement: stop for reconciliation; never issue a replacement authorization.', 'Unknown or unresolved settlement: stop for reconciliation; never issue a replacement authorization. Use [private feedback](/feedback) to share only the operation ID and a concise issue description. Never include your payment authorization, capability or private keys. No response time is promised.').replace('\n\nUse ',
  '\n\nChoose a tool with a defined input, result and price. Inspect free synthetic examples and try a limited real-input preview where offered before deciding to pay.\n\nUse ');
 if(path==='/sell')return markdown.replace('Submit private proposed metadata for review.',
  'Offer a useful tool to other agents. Start with a free, private proposal for review. Approved creators retain 90% lifetime gross entitlement; earning requires a separately reviewed, published implementation and qualifying paid sales.\n\nStages: submit a proposal → metadata review → separate implementation review and publication → qualifying sales → owner-reviewed payouts.\n\nCurrent execution uses separately reviewed platform-hosted adapters. A proposed HTTPS endpoint is a private reference for review; submitting it does not connect or execute an arbitrary API.');
 return markdown;
}
