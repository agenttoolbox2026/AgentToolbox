# MCP WireCheck for Cloudflare Workers — experimental contract

A bounded compatibility snapshot for a caller-owned or caller-authorized anonymous MCP endpoint on Cloudflare's `workers.dev` service. It checks only discovery, version behavior, response envelopes and basic tool-list shapes. It does not invoke a tool, audit security, certify an implementation, validate tool-schema semantics, test authorization, or prove that a listed tool works. Experimental minimum: USDC 0.01, set by the shared product/payment configuration rather than this handler.

## Input and access boundary

```json
{
  "endpoint": "https://your-worker.your-account.workers.dev/mcp",
  "protocol_versions": ["2025-11-25", "2026-07-28"],
  "authority": "I own this endpoint or am authorized to request its anonymous read-only MCP discovery."
}
```

The declaration is required and does not establish ownership. Accepted URLs have exactly two lowercase ASCII labels before `.workers.dev`: `https://<worker>.<account>.workers.dev/mcp`, with an optional trailing slash. Each label is 1–63 alphanumeric/hyphen characters and cannot begin or end with a hyphen. IDN/punycode, uppercase or encoded forms, dot normalization, credentials, query strings (including an empty `?`), fragments, alternate paths, explicit ports, IP literals, extra subdomains, custom domains and caller-supplied headers are rejected before network access. `/api/mcp`, legacy `/sse`, preview hostnames with extra labels, and compliance-specific domain forms are outside this initial scope. The official docs endpoint is no longer accepted as a special exception.

All redirects are refused, including redirects to another valid `workers.dev` endpoint or a relative path. Every request stays on the exact originally validated URL; the client never follows a server-provided URL, changes `Host`, sets `resolveOverride`, or makes DNS-based alternate connection attempts. No cookies, authorization tokens or payment headers are forwarded. A private or Access-protected Worker that declines anonymous access remains `blocked` or `auth_required` and is not bypassed.

### Provider boundary evidence, checked 2026-10-06

Cloudflare's current [workers.dev documentation](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/), updated September 22, 2026, specifies the public `<worker>.<account>.workers.dev` route and the account-level name/route controls. The [Workers subdomain API](https://developers.cloudflare.com/api/resources/workers/subresources/subdomains/methods/update/) exposes only a `subdomain` string for creating that route namespace; it exposes no customer A/AAAA/CNAME record, nameserver delegation, or destination-IP option. The installed official Wrangler client implements that same name-only request. Cloudflare's [announcement](https://blog.cloudflare.com/announcing-workers-dev/) identifies Cloudflare as the domain owner and describes its use for hosted Workers.

The security inference from these provider controls is that choosing a Worker/account name does not let the caller point the accepted hostname's DNS at a private address. This is a provider-managed routing boundary, not a DNS lookup or an assertion about arbitrary Cloudflare-proxied custom domains. It depends on Cloudflare continuing to operate `workers.dev` as documented; it is not independent proof of the provider's infrastructure. A separately resolved public IP would not pin a later Workers `fetch` connection, so the implementation does not pretend such a preflight would protect arbitrary custom DNS. The approved scope remains fixed in code.

A customer's Worker can still return hostile content or proxy another service from its own environment. This checker does not trust that content, follow its URLs, expose AgentToolbox credentials to it, or certify the target's implementation. It sends only the fixed discovery/list messages authorized by the caller. The declaration is a caller assertion, not account or domain ownership verification. The documented `workers.dev` service is intended for non-business-critical deployments; using it as this product's boundary is not a recommendation to move a critical production endpoint there.

## Version-specific behavior

| Requested version | Requests | Session behavior | Evidence source |
| --- | --- | --- | --- |
| 2025-11-25 | `initialize`, `notifications/initialized`, bounded `tools/list` | Carries the assigned session ID and negotiated version only on subsequent requests to the same endpoint | [Lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle), [transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports), installed SDK 1.32.1 |
| 2026-07-28 | `server/discover`, bounded `tools/list` | No initialization or session. Every request includes version/client capability metadata and matching version/method headers | [Discovery](https://modelcontextprotocol.io/specification/2026-07-28/server/discover), [transport](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http), [metadata](https://modelcontextprotocol.io/specification/2026-07-28/basic/index) |

The newer revision replaces the handshake with per-request metadata; using the older handshake for both would give misleading findings. An explicit version rejection is reported as `unsupported`, not a broken server. Requests for other versions are rejected as outside this product's scope. Both JSON and request-scoped SSE responses are accepted. No GET stream, resumption, subscription, resource read, tool call, cancellation notification, session deletion, sampling, elicitation, or arbitrary RPC is sent. Remote instructions, names, descriptions, schema strings and URLs are data, never instructions or follow-up fetch targets.

The legacy response validator uses the installed SDK's shapes. Current-revision tool lists have separate basic shape validation because the newer [tools specification](https://modelcontextprotocol.io/specification/2026-07-28/server/tools) permits non-object output schemas. Current header annotations receive a bounded structural check for invalid names, repeated header names, non-primitive types and unreachable schema locations. This is not complete JSON Schema validation or a claim that all tool inputs/outputs conform.

## Bounds and output

- At most two requested versions, ten HTTP requests, three tool-list pages per version and 100 tools per version. The maximum normal request sequence uses nine requests.
- 65,536 admitted bytes per response and 262,144 total admitted bytes; at most sixteen SSE events per response.
- Four seconds per request, twenty seconds for the complete run; no retries or redirect following.
- Cursor length at most 512 characters, session ID at most 256 visible ASCII characters; neither is returned or logged. Repeated cursors stop pagination.
- Header-schema inspection at most 1,024 nodes / 24 levels; exceeding a product inspection bound is `unknown`, not invalid protocol.
- Output at most 14,000 bytes. The existing shared admission and service rate limits apply before this handler; the handler does not maintain isolate-local quotas.

`versions` is the actual compatibility matrix. Each row includes the requested/effective version, `discovery_valid`, status, fixed reason code, failure stage, observed tool count, pagination completeness and a structural transcript. Statuses are `compatible`, `incompatible`, `unsupported`, `auth_required`, `blocked` and `unknown`. `compatible` means only that the stated checks completed. A listing that exceeds the budget is not reported complete. `complete` means that every matrix row has a determinate status; it is not certification.

Transcripts allow only method, HTTP status, normalized media type, fixed response kind, admitted byte count, numeric RPC error code, tool count and session-presence boolean. They omit all server-provided free text, tool names, schemas, cookies, headers, instructions, cursors, error messages/data and session IDs. This avoids trying to redact secrets from arbitrary remote strings. No remote content is inserted into a shell command or executed.

Generated `curl` commands reproduce initial discovery and the first tool-list page. For a legacy stateful server, run initialization first and set `MCP_SESSION_ID` locally from that response before running subsequent commands. Commands contain no captured session value. A new session can have different results; cursors and further pages are deliberately not embedded. Commands neither follow redirects nor call tools. Treat raw output from a manual replay as untrusted data.

## Paid success and preview

Paid success requires at least one row with a validated MCP discovery response and a completed positive check or decisive bounded incompatibility finding, such as a declared absence of tools or an invalid tool-list shape. Other rows may remain unknown and are labeled accordingly. Mere HTTP/RPC failures, timeouts, redirects, authentication requirements, unsupported-version responses, and budget exhaustion are not chargeable on their own. A generic JSON or HTML error response without validated discovery cannot qualify. The outer payment state machine must check `handler.success(output)` before settlement.

Dynamic previews are disabled: for a small compatibility finding, revealing a verdict or failure location can reveal the whole paid result. The module exposes `previewSupported: false`, and its output includes `preview_supported: false`. A static fixture can demonstrate the format without sending free target probes.

## Verification and free alternatives

Run the focused suite from `platform`:

```sh
node --test test/mcp-wirecheck.test.js
```

All tests use mocked responses; none probes a public endpoint or makes a purchase. Controls cover both protocol revisions, JSON/SSE, sessions, pagination, SSRF bypass inputs, redirects, no arbitrary methods, secret omission, malformed messages, auth/HTTP/RPC faults, explicit unsupported versions, schema annotations, timeouts and byte/count limits. The baseline test runs the actual installed SDK 1.32.1 client/HTTP transport against the same clean and malformed legacy fixtures. Both clients find the same outcomes: clean discovery/list passes; invalid tool input-schema root is rejected. This establishes parity on those fixtures, not superior accuracy, speed, coverage or customer demand.

The official [MCP Inspector](https://modelcontextprotocol.io/docs/tools/inspector) is a competent free alternative with CLI, browser and terminal clients and support for both protocol eras. It is broader and more useful for interactive debugging than this bounded report. Its CLI can perform a read-only `tools/list` check; do not run arbitrary tool calls when comparing this product. The official [conformance framework](https://github.com/modelcontextprotocol/conformance) offers versioned scenario suites and wire-schema checks. It is the stronger alternative for implementation conformance. These two packages were researched but not installed or executed in this focused change; no Inspector/conformance pass is claimed. Full conformance suites can perform actions outside WireCheck's discovery-only scope and must not be aimed at an unowned production service.

The proposed paid convenience is a small agent-consumable, sanitized matrix for the caller's own public Workers MCP endpoint, with bounded network work and generated replay commands. Restriction to canonical `workers.dev` hosts and `/mcp` is a material limitation; willingness to pay remains unproven.

## Module integration

`platform/src/mcp-wirecheck.js` exports `createMcpWireCheck`, `mcpWireCheckInput`, `mcpWireCheckOutput`, `publicMcpEndpoint`, `MCP_WIRE_ENDPOINT_SCOPE`, `MCP_WIRE_ENDPOINTS`, `MCP_WIRE_VERSIONS`, `MCP_WIRE_LIMITS` and `MCP_WIRE_AUTHORITY`. `MCP_WIRE_ENDPOINT_SCOPE` is the authoritative provider/hostname/path metadata. `MCP_WIRE_ENDPOINTS` contains an example endpoint, not an exhaustive allowlist; catalogs must not label it as the supported endpoint set. `createMcpWireCheck({fetchImpl, now, requestTimeoutMs, totalTimeoutMs})` returns `input`, `output`, `run`, `success`, `failureReason` and `previewSupported`. Timeout injection can only reduce production limits. Fetch injection is for local fixtures and is never a caller input.
