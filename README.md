# AgentToolbox

A stable catalog for small agent tools and measured product experiments.

Public site: **https://agnttoolbx.agenttoolbox2026.workers.dev**

- HTTP catalog: /v1/products
- Product contracts: /v1/products/{id}
- MCP: /mcp
- Agent guide: /llms.txt
- Schemas: /openapi.json

The active catalog is honestly empty. Retry gate is retired; its old public
route is disabled and its source, D1 history and experiment reports are preserved.
The catalog can be searched and navigated without JavaScript. HTML, JSON and MCP
read one registry.

## Run and validate

Node.js 24+ and pnpm 11.19.0:

~~~sh
pnpm install --frozen-lockfile
pnpm --dir platform install --frozen-lockfile
pnpm dev
pnpm test
pnpm check
pnpm worker:check
pnpm smoke https://agnttoolbx.agenttoolbox2026.workers.dev
~~~

Platform code lives in platform/. The original src/, test/ and scripts/ remain
historical experiment code. Explicit legacy scripts are available; they are not
the new deployment.

The supplied original PNG is platform/public/agenttoolbox-icon.png; layout uses
the original pixels. There are no remote fonts or image services.

## Payments and measurement

Current official @x402/core and @x402/evm 2.28.0 are integrated through an explicit
durable settlement adapter. Mock tests cover challenge headers, exact contract
matching, failed outcomes, concurrency/replay, storage failures, timeout/unknown
state and free-credit exhaustion. An unsigned challenge was verified in workerd.

**No paid product is live and no real settlement test has been performed.**
The recipient and Base native-USDC network are owner-confirmed. A useful concrete
product contract and user-controlled payment verification remain outstanding. Capability advertising
and mocked settlement do not establish paid readiness.

Private report: pnpm report:remote. It returns per-product/version UTC daily
counts, channel, sample classification, execution/outcome totals and optional
repeat pseudonyms. Payment ledger reporting distinguishes facilitator reports
from independently reconciled revenue. There is no public admin or analytics
endpoint. Searches, IP addresses and raw inputs are not stored in telemetry.

Read [the current brief](BUILD.md), [platform operations](docs/platform-operations.md),
[x402 implementation](docs/platform-x402.md), and the preserved
[fresh-agent comparison](docs/fresh-agent-report.md). No usefulness or customer
claims are inferred from synthetic checks.
