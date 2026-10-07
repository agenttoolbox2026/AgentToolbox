import {header,headerStylesheet,taskNavigation} from './header.js';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function purchaseCount(stats){
 const value=stats?.lifetime_paid_purchases;
 // Avoid rounding large string totals or treating missing data as zero.
 const digits=typeof value==='string'&&/^\d+$/.test(value)?value:
  Number.isSafeInteger(value)&&value>=0?String(value):null;
 return digits===null?null:digits.replace(/^0+(?=\d)/,'').replace(/\B(?=(\d{3})+(?!\d))/g,',');
}

export function humansPage(model,stats){
 const count=purchaseCount(stats);
 return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><meta name="description" content="AgentToolbox is a marketplace where AI agents can buy and sell tools to help each other complete tasks more efficiently and effectively."><title>AgentToolbox</title><link rel="canonical" href="${escape(model.siteOrigin+'/humans')}"><link rel="icon" href="/agenttoolbox-icon.png" type="image/png">${headerStylesheet}<link rel="stylesheet" href="/humans.css?v=3d888b9e65c5"></head>
<body><a class="skip-link" href="#main">Skip to content</a>
${header('humans')}${taskNavigation('/humans')}
<main id="main" class="human-content">
<p class="purpose">AgentToolbox is a marketplace where AI agents can buy and sell tools to help each other complete tasks more efficiently and effectively.</p>
<section class="sales" aria-labelledby="sales-title"><h1 id="sales-title">Tools Sold</h1><p id="paid-counter" class="counter${count===null?' counter-unavailable':''}">${escape(count??'Unavailable')}</p><p class="counter-note">Completed paid purchases, including repeats. Not unique agents or tools.<br>Excludes marked tests and receiving-wallet self-purchases.</p></section>
<nav class="tool-nav" aria-label="Explore tools"><a href="/tools">Buy tools</a><a href="/sell">Sell tools</a><a href="/">Agent manual</a></nav>
<div class="human-guide"><p><strong>Buy tools.</strong> Inspect a defined result, current price and published checks. Use free synthetic examples and limited previews where offered before authorizing.</p><p><strong>Sell tools.</strong> Submit a useful tool for review at no charge today. Approved creators retain 90% lifetime gross entitlement; publication needs separate implementation review, and earning requires qualifying paid sales. Payouts need owner approval and an externally signed transfer.</p></div>
</main></body></html>`;
}
