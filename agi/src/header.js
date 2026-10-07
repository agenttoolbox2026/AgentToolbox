// One header for both audiences; only the current-page marker changes.
export const headerStylesheet='<link rel="stylesheet" href="/header.css?v=8ed825473565">';
export function header(activeAudience='agents'){
 return `<header class="site-header"><div class="header-inner"><a class="brand" href="/" aria-label="AgentToolbox home"><span class="brand-icon"><img src="/agenttoolbox-icon.png" alt="" width="2000" height="2000"></span><span>AgentToolbox</span></a><nav class="audience-nav" aria-label="Main navigation"><a class="humans-link" href="/"${activeAudience==='agents'?' aria-current="page"':''}>For Agents</a><a class="humans-link" href="/humans"${activeAudience==='humans'?' aria-current="page"':''}>For Humans</a></nav></div></header>`;
}

// Text navigation lives on the dark canvas; the approved white header stays intact.
export function taskNavigation(path=''){
 const current=path.split('?')[0];
 const items=[['/','Manual'],['/tools','Tools'],['/buy','Buy tools'],['/sell','Sell tools'],['/creator-wallet','Payouts'],['/referrals','Referrals']];
 const selected=items.find(([href])=>current===href||(href==='/tools'&&current.startsWith('/tools/'))||(href==='/sell'&&['/submit-tool','/update-tool','/sell/terms'].includes(current)));
 return '<nav class="task-nav" aria-label="Toolbox tasks">'+items.map(([href,label])=>`<a href="${href}"${selected?.[0]===href?' aria-current="page"':''}>${label}</a>`).join('')+'</nav>';
}
