# Cloudflare setup — verified 2026-10-06 UTC

The official [agent setup prompt](https://developers.cloudflare.com/agent-setup/prompt.md)
was fetched directly on Douglas's Mac. Its applicable Codex steps are:

1. Install all skills from `cloudflare/skills` globally. Completed with Codex's
   bundled Skill Installer, pinned to `41e0d19858946d18af9ee2c2feebbe2e11d829ff`:
   16 skills in `~/.codex/skills/`. This uses Codex's supported installer instead
   of the prompt's generic `npx -y skills add cloudflare/skills --skill '*' --yes --global`.
2. Register `https://mcp.cloudflare.com/mcp` using
   `codex mcp add cloudflare --url https://mcp.cloudflare.com/mcp`.
3. Registration and OAuth completed after Douglas approved persistent access.
   The default broad request was canceled before consent. Login succeeded using
   `codex mcp login cloudflare --scopes offline_access,user:read,account:read,workers-scripts.read,workers-scripts.write,d1.read,d1.write`.
   Consent was restricted to this account: Background Access, User Read, Account
   Read, Workers Scripts Read/Write and D1 Read/Write. Codex confirmed login
   succeeded. Restart the agent to load the newly registered MCP tools.
4. The optional beta `cf` CLI (`npm install -g cf`, user-level preference, then
   `cf auth login`) was skipped. This repository already has a pinned Wrangler
   configuration. Claude/Pi/OpenCode/Cursor/Vibe instructions do not apply.

## Account and access

GitHub connector access works with admin/push permission. PR #1 remains a draft.
All 31 original checkout file hashes matched remote head
`16faf8cd5e6061c3fd29b45f30dccbc6e30842a7` before these reporting additions.

The Cloudflare dashboard was read in **Your Chrome**, using its existing sign-in.
Account `adfd5522541f990a9ccb27900a7e1e00` has:

- Workers Free as its current $0 plan; no Worker/Pages projects.
- Subdomain `agenttoolbox2026.workers.dev`.
- No D1 databases and zero reported usage.
- Hard D1 limits shown: 10 databases, 5 million rows read/day, 100,000 rows
  written/day, 5 GB total account storage.

The newly configured MCP is not exposed in this Work task. A resumed turn did not
change that. A supported Codex app-server `mcpServerStatus/list` check then found
`authStatus=notLoggedIn`: the MCP initialize handshake returns `Auth required`,
despite the earlier login command's success message. A successful OAuth callback
therefore has not established usable MCP access. No credentials were extracted.
Local `wrangler whoami` reports unauthenticated. Browser sign-in does not
authenticate Wrangler or MCP.
Wrangler OAuth is a separate grant; do not assume MCP authorization approves it.
The MCP consent screen was inspected and limited to the approved account and
Worker/D1 operations. Credentials were saved by Codex, never printed or committed.
No account security settings or billing were changed.

## Proposed free deployment

One `agenttoolbox-retry-gate` Worker and one `agenttoolbox-retry-gate-dev` D1,
with the existing two rate-limit bindings. No paid plan, R2, Pages, containers,
queues, custom domain or payment settlement. Once access is authorized:

1. Recheck identity, inventory and Free plan using authenticated API access.
2. Create the named D1 only if still absent; record its actual ID. Apply
   `0001.sql` and `0002_usage_totals.sql` to that new database.
3. Replace the local D1 placeholder; set `workers_dev=true` and `PUBLIC_ORIGIN`
   to the actual Worker origin. Keep `PAYMENTS_MODE=dev` and previews disabled.
4. Build/dry-run, deploy, and record the returned URL. The expected name would
   produce `https://agenttoolbox-retry-gate.agenttoolbox2026.workers.dev`, but this
   is a proposed address, not a live or verified deployment.
5. Check discovery with HTML/Markdown/JSON, health, OpenAPI, plain-HTTP flow and
   MCP SDK. Run `scripts/report-d1.sql` against remote D1 and reconcile the test
   counters with zero settlement. Verify bot controls do not challenge clients.

Workers Free currently has 100,000 requests/day and a 10 ms CPU/invocation limit.
The deployed SDK's real CPU behavior must be measured; local wall time is not
production CPU. Exhausted free quotas fail rather than authorizing a paid upgrade.
Rate limits are per Cloudflare location, not a strict global request cap.
Do not enable paid service to work around a failed free-plan validation.

Sources: [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/),
[D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/),
[Workers permissions](https://developers.cloudflare.com/workers/authorization/workers/),
[MCP authentication](https://github.com/cloudflare/mcp).

## Local evidence

14 tests pass, including concurrent replay counts, aggregate rollback, retention
and migration reopening. Wrangler 4.147.0 bundles successfully in dry-run. Both
migrations apply to local workerd/D1. HTTP/MCP smoke passes on localhost:8790.
The local aggregate report showed 2 quotes, 1 stopped, 1 accepted, 1 result,
1 eligible self-report and 1 helpful feedback, with zero USDC settlement.
These are controlled test events, not customers, revenue or independent outcomes.

No deployment or public URL is verified yet. Cloudflare API authentication is
the current blocker. No testnet or mainnet funds moved.

## Resume diagnosis and smallest alternate

[OpenAI MCP documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)
documents Settings > MCP servers > Restart for desktop, and notes that cloud
Work does not automatically expose local Codex configuration. The supported
[app-server API](https://learn.chatgpt.com/docs/app-server) includes configuration
reload and MCP status/call methods; the status check above failed authentication.
Do not keep retrying an unchanged login or read saved tokens manually.

The existing **Your Chrome** dashboard session remains signed in. Its Worker
create flow offers a Hello World deployment or Git integration/static upload.
The app needs two rate-limit bindings, which [Cloudflare documents as unavailable
in the dashboard](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/).
No placeholder was deployed and no remote resources were created during diagnosis.

The pinned Wrangler and its [current command docs](https://developers.cloudflare.com/workers/wrangler/commands/general/)
support selecting OAuth scopes. A separate narrowly scoped Wrangler grant was
proposed to Douglas through Toby and is pending approval:

```sh
pnpm exec wrangler login --use-keyring --scopes account:read user:read workers_scripts:write d1:write
```

Worker script management includes scripts, Durable Objects, subdomains, triggers
and tail data. D1 write allows database management. Keep broad `workers:write`,
KV, routes, Pages, R2, containers and payment access excluded. Inspect actual
consent and required background refresh access before accepting this second grant.
Store credentials through Wrangler's OS keychain support; never paste tokens into
chat. Once authorized, use the deployment sequence above without a paid upgrade.
