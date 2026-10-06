import { createService, ApiError } from './service.js';
import { mcp } from './mcp.js';
import { instructions, landing, openapi } from './discovery.js';

export async function boundedJson(request) {
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') throw new ApiError(415, 'json_required');
  if (request.headers.has('content-encoding') && request.headers.get('content-encoding') !== 'identity') throw new ApiError(415, 'compressed_body_not_supported');
  if (Number(request.headers.get('content-length')) > 8192) throw new ApiError(413, 'request_too_large');
  if (!request.body) throw new ApiError(400, 'invalid_json');
  const reader = request.body.getReader();
  let size = 0;
  const chunks = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8192) { await reader.cancel(); throw new ApiError(413, 'request_too_large'); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (e) { if (e instanceof ApiError) throw e; throw new ApiError(400, 'invalid_json'); }
  finally { reader.releaseLock(); }
}

// Local process only. Worker requires Cloudflare bindings; this isn't a global limit.
export function localLimiter({ perClient = 60, global = 300, clock = Date.now } = {}) {
  let bucket = -1, total = 0;
  const clients = new Map();
  return async client => {
    const minute = Math.floor(clock() / 60000);
    if (minute !== bucket) { bucket = minute; total = 0; clients.clear(); }
    const count = clients.get(client) ?? 0;
    if (total >= global || count >= perClient) return false;
    clients.set(client, count + 1); total++;
    return true;
  };
}

export function createApp({ db, origin, mode = 'dev', limit, clock }) {
  const service = createService(db, { mode, clock });
  const configuredOrigin = new URL(origin).origin;
  const json = (body, status = 200, headers = {}) => Response.json(body, { status, headers });
  return async (request, client = 'local') => {
    const started = performance.now();
    let response;
    try {
      const url = new URL(request.url);
      if (url.origin !== configuredOrigin) throw new ApiError(403, 'invalid_host');
      const suppliedOrigin = request.headers.get('origin');
      const discovery = ['/', '/llms.txt', '/openapi.json', '/health'].includes(url.pathname);
      if (suppliedOrigin && suppliedOrigin !== configuredOrigin && (!discovery || !['GET', 'OPTIONS'].includes(request.method))) throw new ApiError(403, 'invalid_origin');
      if (!limit) throw new ApiError(503, 'rate_limit_unavailable');
      if (!(await limit(client))) throw new ApiError(429, 'rate_limited');
      if (request.method === 'OPTIONS') {
        response = new Response(null, { status: 204, headers: {
          'Access-Control-Allow-Origin': discovery ? '*' : configuredOrigin,
          'Access-Control-Allow-Methods': discovery ? 'GET, OPTIONS' : 'GET, POST, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Idempotency-Key, MCP-Protocol-Version',
          'Access-Control-Max-Age': '600',
        } });
      } else if (discovery && request.method === 'GET') {
        if (url.pathname === '/health') response = json({ ok: true, payments: service.payment.mode });
        else if (url.pathname === '/openapi.json') response = json(openapi());
        else if (url.pathname === '/llms.txt') response = new Response(instructions, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
        else if (request.headers.get('accept')?.includes('application/json')) response = json({ name: 'AgentToolbox retry gate', payments: service.payment.mode, max_charge_usdc_atomic: 0, instructions, openapi: '/openapi.json', mcp: '/mcp' });
        else if (request.headers.get('accept')?.includes('text/markdown')) response = new Response(instructions, { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
        else response = new Response(landing(), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        response.headers.set('Access-Control-Allow-Origin', '*');
      } else if (url.pathname === '/mcp') {
        response = await mcp(request, service, request.method === 'POST' ? await boundedJson(request) : undefined);
      } else {
        const match = /^\/v1\/recover\/([0-9a-f-]{36})(?:\/(accept|result))?$/.exec(url.pathname);
        if (url.pathname === '/v1/recover' && request.method === 'POST') response = json(await service.recover(await boundedJson(request), request.headers.get('idempotency-key') ?? undefined));
        else if (url.pathname === '/v1/feedback' && request.method === 'POST') response = json(await service.feedback(await boundedJson(request)));
        else if (match && !match[2] && request.method === 'GET') response = json(await service.receipt(match[1]));
        else if (match?.[2] && request.method === 'POST') response = json(await service[match[2]](match[1], await boundedJson(request)));
        else if (match || ['/v1/recover', '/v1/feedback'].includes(url.pathname) || discovery) throw new ApiError(405, 'method_not_allowed');
        else throw new ApiError(404, 'not_found');
      }
    } catch (e) {
      const status = e instanceof ApiError ? e.status : 500;
      response = json({ error: e instanceof ApiError ? e.code : 'internal_error' }, status, status === 429 ? { 'Retry-After': '60' } : {});
    }
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('Referrer-Policy', 'no-referrer');
    response.headers.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'");
    response.headers.set('Vary', 'Accept, Origin');
    response.headers.set('Server-Timing', `app;dur=${(performance.now() - started).toFixed(2)}`);
    return response;
  };
}
