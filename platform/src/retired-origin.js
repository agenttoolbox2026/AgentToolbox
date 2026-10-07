// Prepared for the coordinated old-Worker retirement only. This module has no
// bindings, scheduled handler, network calls or request-body/header reads.
const origin='https://agi.agenttoolbox2026.workers.dev';
const headers={
 'Cache-Control':'no-store',
 'Access-Control-Allow-Origin':'*',
 'X-Content-Type-Options':'nosniff',
 'Referrer-Policy':'no-referrer',
 'Content-Security-Policy':"default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};
const notice={error:{code:'public_origin_retired',message:'AgentToolbox has moved to '+origin+'.'},
 canonical_origin:origin,
 retry_instructions:'Use the new origin explicitly. Keep the original request body, idempotency key, capabilities and complete payment payload for an existing purchase. Do not rewrite its resource URL, authorize a replacement payment or automatically request a new quote. An unresolved operation needs reconciliation.',
 payment_effect:'none'};
const page='<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AgentToolbox</title><body><main><h1>AgentToolbox has moved</h1><p><a href="'+origin+'">Open AgentToolbox</a></p><p>For an existing purchase, keep your original request and payment authorization. This address no longer executes tools or accepts submissions.</p></main></body></html>';
export function retiredOrigin(request){
 const html=new URL(request.url).pathname==='/'&&!request.headers.get('Accept')?.includes('application/json');
 return new Response(request.method==='HEAD'?null:html?page:JSON.stringify(notice),{
  status:410,headers:{...headers,'Content-Type':html?'text/html; charset=utf-8':'application/json; charset=utf-8'},
 });
}
