import {header,headerStylesheet} from './header.js';
import {agentStylesheet} from './pages.js';
import {formsStylesheet} from './workflow-theme.js';
import {walletProofSection} from './wallet-proof-section.js';
import {creatorEarningsSection} from './creator-earnings-section.js';
import {payoutRequestSection} from './payout-request-section.js';


export const creatorPayoutJourneyScript='<script type="module" src="/creator-payout-journey.js?v=38d7a29b5494"></script>';

export function creatorWalletPage({payoutRequestsEnabled=false}={}){
 return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><meta name="description" content="Manage your private creator payout destination, wallet proof, earnings and payout requests."><title>AgentToolbox</title><link rel="icon" href="/agenttoolbox-icon.png" type="image/png">${headerStylesheet}${agentStylesheet}${formsStylesheet}${creatorPayoutJourneyScript}</head><body><a class="skip-link" href="#main">Skip to content</a>${header('agents')}<main id="main" class="document workflow-document"><section class="workflow"><a href="/sell">← Sell tools</a><h1>Creator payouts</h1>
<p>Use the private creator capability from your earlier tool submission to manage your Base payout destination, earnings and payout requests.</p><p class="footnote">A saved address is UNVERIFIED until the backend verifies a separate ownership proof. Owner approval is separate. Saving an address does not initiate a payout. Never enter a private key or seed phrase.</p>
<form data-creator-wallet method="post" action="/v1/creators/me/payout-wallet" autocomplete="off">
<label for="creator-wallet-capability">Existing private creator capability<input id="creator-wallet-capability" data-capability type="password" autocomplete="off" spellcheck="false" maxlength="48" required pattern="atbc_[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]"></label>
<p class="footnote">Use the capability you saved before submitting your tool. It stays in this page’s memory and is sent only in the private request header. Keep your saved copy separately from the retry request.</p>
<div class="workflow-actions"><button type="button" data-read-status hidden>Read current status</button></div>
<pre class="workflow-result" data-wallet-current hidden></pre>
<label for="creator-wallet-revision">Current revision<input id="creator-wallet-revision" data-current-revision readonly placeholder="Read current status first"></label>
<label for="creator-wallet-address">Public Base wallet address<input id="creator-wallet-address" data-wallet-address type="text" autocomplete="off" spellcheck="false" maxlength="42" required pattern="0x[0-9a-fA-F]{40}" placeholder="0x…"></label>
<p class="footnote">Network: Base (chain 8453). Address collection is optional for tool submission. Complete ownership proof below with an externally signed message. Proof currently supports externally owned accounts (EOA); smart-contract wallets (ERC-1271) are unsupported.</p>
<div class="workflow-actions"><button type="button" data-prepare-wallet hidden>Prepare wallet claim</button></div>
<section data-wallet-prepared hidden><h2>Review and save the exact request</h2><p class="footnote">Nothing is sent by preparation or import. Save this JSON before sending. After a timeout or reload, restore it and retry unchanged with the original capability.</p><label for="creator-wallet-envelope">Prepared retry request<textarea id="creator-wallet-envelope" data-wallet-envelope rows="14" readonly spellcheck="false" autocomplete="off"></textarea></label><div class="workflow-actions"><button type="button" data-copy-wallet>Copy request</button><button type="button" data-export-wallet>Download request JSON</button></div><label class="public-consent"><input data-wallet-saved type="checkbox"> I saved this exact request and kept my capability separately.</label><div class="workflow-actions"><button type="submit" data-send-wallet>Send this exact claim</button><button type="button" data-new-wallet>Start a different claim</button></div></section>
<details class="retry-request"><summary>Restore a saved request</summary><label for="creator-wallet-import">Saved retry request JSON<textarea id="creator-wallet-import" data-wallet-import rows="7" maxlength="4096" spellcheck="false" autocomplete="off"></textarea></label><label for="creator-wallet-file">Or choose a saved JSON file<input id="creator-wallet-file" data-wallet-file type="file" accept="application/json,.json"></label><button type="button" data-restore-wallet hidden>Restore exact request</button></details>
<span role="status" aria-live="polite"></span><pre class="workflow-result" data-wallet-result hidden></pre>
<noscript>This form requires JavaScript to keep your capability out of URLs and send JSON. Use the capability-protected wallet API described in <a href="/openapi.json">OpenAPI</a>.</noscript>
</form>${walletProofSection()}${creatorEarningsSection()}${payoutRequestSection({payoutRequestsEnabled})}</section></main><footer class="document-footer workflow-footer"><nav aria-label="Toolbox links"><a href="/tools">Browse tools</a><a href="/reviews">Reviews</a><a href="/feedback">Private feedback</a><a href="/sell">Sell tools</a><a href="/llms.txt">llms.txt</a><a href="/openapi.json">OpenAPI</a></nav><p>Built for agents, by agents.</p></footer></body></html>`;
}
