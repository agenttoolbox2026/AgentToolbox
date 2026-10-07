# AgentToolbox agent front door

This independent Worker serves `https://agi.agenttoolbox2026.workers.dev`.
The original site and every operation remain at
`https://agnttoolbx.agenttoolbox2026.workers.dev`.

The new Worker contains HTML/Markdown/JSON guides and two static assets. It has
no D1, KV, financial, private admin, payment, service or scheduled bindings.
It never calls the backend on behalf of a visitor. API and MCP requests on this
host fail with `421 canonical_api_required` without consuming or forwarding the
body, credentials or query string. OpenAPI and x402 discovery GET/HEAD aliases
redirect to the canonical server. All operational links are absolute.
Invocation logs are disabled and trace sampling is zero; the Worker emits no
logs, so accidental visitor credentials are not copied into application logs.

## Rebuild and verify

Use the pinned repository dependencies and Node 24:

```sh
npm run agi:build
npm run agi:test
npm run agi:check
npm test
npm run check
npm run agi:dev
```

`agi/src/model.js` imports the actual platform registry, success contract
canonicalizer, creator terms and referral terms at build time. Its generated
snapshot contains no payment recipient or private configuration. The runtime
does not import the platform service or payment SDK. HTML and machine routes
use this same snapshot; current authoritative schemas, criteria, payment
requirements, examples, previews, reviews, forms and MCP remain canonical API
links. Rebuild whenever canonical contracts change. A source hash is explicitly
a snapshot, never authorization. The buyer guide requires verification of
current success and payment hashes before authorization.

The white branded header, black readable content and separate human mission
page follow the owner's design. Essential content is server-rendered with no
JavaScript. Original icon bytes are preserved. The branded human page describes
the marketplace vision and current experimental/manual activation stage.

Seller forms live on the canonical origin, retaining its capability checks and
request export/import implementation. This Worker collects no capabilities.
Reviewed metadata does not imply a published/executable adapter or payout.

## Deployment boundary

Only run deployment with `--config agi/wrangler.jsonc`. The config names `agi`;
never deploy the original `platform/wrangler.jsonc` as part of this task.
Use the existing authorized account and normal encrypted Wrangler login.
No account, grants, secrets, routes, domain purchases or migrations are needed.

```sh
npm run agi:build
npm run agi:check
wrangler deploy --config agi/wrangler.jsonc
node agi/scripts/readback.js https://agi.agenttoolbox2026.workers.dev
```

Readback performs synthetic/read-only discovery and inert requests rejected by
the presentation Worker. MCP `tools/list` is read-only. It performs no paid
invocation, live preview, positive proposal/update/referral registration or
transfer. It recomputes all four live success/payment pins and verifies the
original site remains reachable. Passing readback does not prove paid demand
or independently verify a live settlement.
