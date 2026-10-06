# Platform checks

Official sources read 2026-10-05:

- [Cloudflare remote MCP](https://developers.cloudflare.com/agents/model-context-protocol/guides/remote-mcp-server/)
  supports stateless Streamable HTTP without a Durable Object. The raw SDK transport
  is also a supported approach. We use the official SDK Web Standard transport to
  share the implementation between a localhost Node server and a Worker, avoiding
  the larger Agents SDK for this stateless tool.
- [MCP 2025-11-25 transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
  requires POST and GET handling at one endpoint. JSON responses and GET 405 are
  valid for this non-streaming server. Validate Origin, accept JSON and SSE, use
  protocol negotiation, return 202 for notifications, and bind local HTTP only to
  127.0.0.1. The SDK owns framing and negotiation; application code bounds bodies.
- [D1 batch](https://developers.cloudflare.com/d1/worker-api/d1-database/)
  provides transactional batches; unique keys and conditional inserts serialize
  one accept/result per recovery. SQL triggers append corresponding financial
  events in the same transaction. No remote database has been created.
- [Worker rate limiting](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
  is local to a Cloudflare location and eventually consistent, not a strict global
  budget. Use per-client and service limits, fail closed without bindings, and cap
  the number of retained quotes in SQL as an additional storage bound. Observe
  distributed abuse/cost before opening a public trial.

Public Cloudflare routing, bot challenges, plan entitlements, subdomain, account
inventory and costs cannot be validated without authenticated account access.
