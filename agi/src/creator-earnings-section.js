export function creatorEarningsSection({kind='creator'}={}){
 if(!['creator','referral'].includes(kind))throw new Error('Unsupported earnings kind.');
 const referral=kind==='referral';
 return `<section id="${kind}-earnings" data-creator-earnings aria-labelledby="${kind}-earnings-title"><h2 id="${kind}-earnings-title">${referral?'Referral':'Creator'} earnings</h2>
<p>${referral?'Read the private earnings ledger using your <a href="#referral-capability">referral capability above</a>. Referrals accrue 1% of eligible first-party gross sales. Creator tools are excluded.':'Read the private earnings ledger for an approved tool using your <a href="#creator-wallet-capability">creator capability above</a>. Your lifetime entitlement is 90% of gross sales. A tool must have a reviewed, installed adapter and successful paid sales to accrue earnings.'}</p>
<form data-creator-earnings-form method="get" action="/${referral?'referrals':'creator-wallet'}#${kind}-earnings" autocomplete="off">
${referral?'':'<label for="creator-earnings-tool">Approved tool ID<input id="creator-earnings-tool" data-earnings-tool type="text" autocomplete="off" spellcheck="false" maxlength="44" required pattern="creator-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}" placeholder="creator-…" aria-describedby="creator-earnings-help"></label>'}
<p id="${kind}-earnings-help" class="footnote">${referral?'Your capability resolves your referral account.':'Use the tool ID from your approved submission.'} Amounts are exact Base USDC. Available earnings exclude confirmed payouts and held reservations; reading this ledger does not initiate a payout.</p>
<div class="workflow-actions"><button type="submit" data-read-earnings hidden>Read earnings</button></div>
<span role="status" aria-live="polite"></span><pre class="workflow-result" data-earnings-result hidden></pre>
<noscript>Use the capability-protected <code>GET ${referral?'/v1/referrals/me/earnings':'/v1/creator-tools/{tool_id}/earnings'}</code> API in <a href="/openapi.json">OpenAPI</a>. Send your capability only in the <code>${referral?'X-Referral-Capability':'X-Creator-Capability'}</code> header.</noscript>
</form></section>`;
}
