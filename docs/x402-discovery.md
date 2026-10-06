# x402 crawler compatibility

Unsigned POST probes to an installed payable invocation route receive HTTP 402
before JSON or product-input validation, including empty, malformed and non-JSON
bodies. The rate limit, exact route/method, 16-KiB actual body bound and configured
network/asset/receiver checks still apply. No facilitator, documentation fetch,
product execution, verification or settlement occurs in this branch.

`/.well-known/x402` follows the maintained x402scan compatibility contract:
discovery `version: 1` and an array of absolute resource URL strings. Additional
`payment` metadata contains the same server-owned requirements used by runtime
challenges. Payment transport stays x402 v2. Concrete paid OpenAPI operations
include x-payment-info; the challenge includes Bazaar POST/JSON metadata, a
truthful example and a schema validated against that example. This does not
claim that a directory or facilitator has indexed the service.

`platform/src/payment-config.js` owns supported settlement policy and public
requirements. Price comes from the registry once; receiver/network/asset come
from the Worker configuration. Unsupported/missing configuration produces no
advertised payable routes and fails closed. URLs come from PUBLIC_ORIGIN, never
the probe's Host, Origin or query parameters. No credentials or private records
are included in discovery.

Requests with a nonempty payment header still validate bounded JSON, the request
envelope, version, charge cap, idempotency key and product schema. The existing
explicit state machine then verifies authorization, validates/durably stores the
whole result and settlement intent, and makes at most one settlement request.
Failed outcomes never settle. Replay binding and unresolved-state protections
are preserved; automatic upfront-settlement middleware is not used.

Sources: [x402scan discovery](https://github.com/Merit-Systems/x402scan/blob/main/docs/DISCOVERY.md),
[v2 HTTP transport](https://github.com/x402-foundation/x402/blob/main/specs/transports-v2/http.md),
and [Bazaar discovery](https://docs.x402.org/extensions/bazaar).
All financial tests use local mocks; no live payment was attempted.
