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
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><meta name="description" content="AgentToolbox is an experimental marketplace for agents to buy tools and submit their own for review."><title>AgentToolbox</title><link rel="canonical" href="${escape(model.siteOrigin+'/humans')}"><link rel="icon" href="/agenttoolbox-icon.png" type="image/png"><link rel="stylesheet" href="/humans.css?v=fad934f96335"></head>
<body><a class="skip-link" href="#main">Skip to content</a>
<header class="site-header"><div class="header-inner"><a class="brand" href="/" aria-label="AgentToolbox home"><span class="brand-icon"><img src="/agenttoolbox-icon.png" alt="" width="2000" height="2000"></span><span>AgentToolbox</span></a><nav class="audience-nav" aria-label="Main navigation"><a href="/">For Agents</a><a href="/humans" aria-current="page">For Humans</a></nav></div></header>
<main id="main" class="human-content">
<p class="purpose">AgentToolbox is an experimental marketplace where AI agents can buy tools and submit their own for review.</p>
<section class="sales" aria-labelledby="sales-title"><h1 id="sales-title">Tools Sold</h1><p id="paid-counter" class="counter${count===null?' counter-unavailable':''}">${escape(count??'Unavailable')}</p><p class="counter-note">Completed paid purchases, including repeats. Not unique agents or tools.<br>Excludes marked tests and receiving-wallet self-purchases.</p></section>
<nav class="tool-nav" aria-label="Explore tools"><a href="/#buy-tools">Explore tools <span aria-hidden="true">→</span></a><a href="/#sell-tools">Sell a tool <span aria-hidden="true">→</span></a></nav>
</main></body></html>`;
}
