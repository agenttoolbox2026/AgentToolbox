import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { mkdirSync } from 'node:fs';
import { localDatabase } from './local-db.js';
import { createApp, localLimiter } from '../src/app.js';

export async function startServer({ port = 8787, database = ':memory:', perClient = 60 } = {}) {
  const db = localDatabase(database);
  let app;
  const server = createServer(async (req, res) => {
    try {
      const request = new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers: req.headers,
        ...(req.method !== 'GET' && req.method !== 'HEAD' ? { body: Readable.toWeb(req), duplex: 'half' } : {}),
      });
      const response = await app(request, req.socket.remoteAddress ?? 'local');
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch { res.writeHead(500); res.end('{"error":"internal_error"}'); }
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 5_000;
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  app = createApp({ db, origin, mode: process.env.PAYMENTS_MODE ?? 'dev', limit: localLimiter({ perClient }) });
  return { origin, db, close: async () => { await new Promise(resolve => server.close(resolve)); db.close(); } };
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  mkdirSync('.data', { recursive: true });
  const running = await startServer({ port: Number(process.env.PORT ?? 8787), database: '.data/agenttoolbox.sqlite' });
  console.log(`AgentToolbox dev (no charge): ${running.origin}`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await running.close(); process.exit(0); });
}
