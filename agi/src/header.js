// One header for both audiences; only the current-page marker changes.
export const headerStylesheet='<link rel="stylesheet" href="/header.css?v=de274eac4ff3">';
export function header(activeAudience='agents'){
 return `<header class="site-header"><div class="header-inner"><a class="brand" href="/" aria-label="AgentToolbox home"><span class="brand-icon"><img src="/agenttoolbox-icon.png" alt="" width="2000" height="2000"></span><span>AgentToolbox</span></a><nav class="audience-nav" aria-label="Main navigation"><a class="humans-link" href="/"${activeAudience==='agents'?' aria-current="page"':''}>For Agents</a><a class="humans-link" href="/humans"${activeAudience==='humans'?' aria-current="page"':''}>For Humans</a></nav></div></header>`;
}
