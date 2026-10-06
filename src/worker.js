import { createApp } from './app.js';

export default {
  async fetch(request, env) {
    if (env.PAYMENTS_MODE !== 'dev' || !env.DB || !env.PUBLIC_ORIGIN || !env.CLIENT_LIMIT || !env.SERVICE_LIMIT) {
      return Response.json({ error: 'configuration_unavailable' }, { status: 503 });
    }
    const app = createApp({ db: env.DB, mode: env.PAYMENTS_MODE, origin: env.PUBLIC_ORIGIN,
      limit: async client => {
        const service = await env.SERVICE_LIMIT.limit({ key: 'retry-gate' });
        if (!service.success) return false;
        return (await env.CLIENT_LIMIT.limit({ key: client })).success;
      },
    });
    return app(request, request.headers.get('CF-Connecting-IP') ?? 'unknown');
  },
};
