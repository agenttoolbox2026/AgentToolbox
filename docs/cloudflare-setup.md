# Cloudflare setup and deployment

Deployed October 5, 2026 (America/Toronto); verification timestamps below use UTC.

- Public service: https://agenttoolbox-retry-gate.agenttoolbox2026.workers.dev
- MCP: https://agenttoolbox-retry-gate.agenttoolbox2026.workers.dev/mcp
- Worker version: `915e6bda-268a-4131-afef-dc2225c0544d`
- Account: `adfd5522541f990a9ccb27900a7e1e00`
- D1: `agenttoolbox-retry-gate-dev`, ID `9de52fc9-b28d-456a-a290-80cc60c59c18`, ENAM.
- Current plan verified in Your Chrome: Workers Free ($0). No paid upgrade.
- Payments remain `dev`; price, charge cap and settlement are all zero.

## Official agent setup

The [official setup prompt](https://developers.cloudflare.com/agent-setup/prompt.md)
was fetched on Douglas's Mac and fetched again before deployment; it was unchanged.
Applicable Codex instructions and outcomes:

1. Install all official `cloudflare/skills` globally. Completed with Codex's bundled
   Skill Installer, pinned to `41e0d19858946d18af9ee2c2feebbe2e11d829ff`: 16 skills
   installed under `~/.codex/skills/`. The prompt's generic equivalent is
   `npx -y skills add cloudflare/skills --skill '*' --yes --global`.
2. Register `https://mcp.cloudflare.com/mcp` with
   `codex mcp add cloudflare --url https://mcp.cloudflare.com/mcp`.
   Entry saved in `~/.codex/config.toml`.
3. Run `codex mcp login cloudflare`. The default broad consent was canceled.
   Douglas approved a narrowed grant, and login reported success with
   `--scopes offline_access,user:read,account:read,workers-scripts.read,workers-scripts.write,d1.read,d1.write`.
   However, a subsequent supported Codex app-server `mcpServerStatus/list` check
   returned `notLoggedIn` / `Auth required` at initialization. Cloudflare MCP
   tools are not available in this Work task. Restart/reconnect is still needed
   to establish and verify usable MCP access; do not claim MCP tool access works.
4. The prompt says to restart the agent to load newly installed skills/MCPs.
   The optional beta `cf` CLI was skipped because this project already uses pinned
   Wrangler. Other agents' setup sections do not apply.

Cloudflare MCP and the deployed application's `/mcp` are separate: the former
manages Cloudflare, while the latter exposes the five AgentToolbox product tools.
The product MCP was verified publicly despite the management MCP limitation.

## Working deployment access

Douglas separately approved the narrow Wrangler grant, then completed consent
himself in his visible Chrome window. Prior attempts returned `Consent denied`;
no access was assumed from them. The successful callback reported login success,
and `wrangler whoami` verified the intended account and exactly these scopes:

- User read and account read.
- Workers scripts write and D1 write.
- Background refresh (`offline_access`).

Wrangler 4.147.0 stores the connection in its encrypted config with the encryption
key in macOS Keychain. No token was extracted, pasted into chat or committed.
The command was:

```sh
pnpm exec wrangler login --use-keyring --scopes account:read user:read workers_scripts:write d1:write
```

Wrangler warns about other default scopes it expects; those unrelated grants
were not added. The approved scopes successfully created D1 and deployed this
Worker. The optional beta CLI and temporary preview account were not used.

## Resources and deployment

The initial authenticated D1 list was empty. One named database was created;
`0001.sql` and `0002_usage_totals.sql` applied successfully to the remote database.
The checked-in config now has the actual account/database IDs, `workers_dev=true`
and verified public origin. `PAYMENTS_MODE=dev`, `preview_urls=false` and disabled
observability are preserved. Bindings:

- `DB`: the single D1 database.
- `CLIENT_LIMIT`: 60 requests per 60 seconds.
- `SERVICE_LIMIT`: 300 requests per 60 seconds.

Dry-run passed; upload and trigger deployment succeeded. Cloudflare reported
49 ms Worker startup time (not per-request CPU) and a 252.84 KiB gzipped bundle.
No Pages, R2, Durable Objects, queues, containers, custom domain or paid add-on
was provisioned. No financial transaction or payment integration exists.

Workers Free currently has 100,000 requests/day and 10 ms CPU/invocation. D1 Free
has hard quotas, including 5 million rows read/day and 100,000 rows written/day.
Quota exhaustion can interrupt service; no paid upgrade is authorized. Rate-limit
bindings are per Cloudflare location, not a global cap. CPU distribution and
cost-to-serve at real volume remain unmeasured.

## Verification

- 14 test groups passed, including idempotency, transaction rollback, retention,
  append-only enforcement and reopening migrated local databases.
- Both local workerd/D1 migrations and local HTTP/MCP smoke passed.
- Public HTML, Markdown and JSON discovery, `/llms.txt`, `/health` and
  `/openapi.json` returned HTTP 200 from a plain external client without a bot
  challenge. Observed Cloudflare response location: YUL.
- Public `scripts/smoke.js` passed concurrent duplicate quote/result submissions,
  acceptance, feedback, terminal receipt, MCP SDK discovery of all five tools and
  unsafe-write rejection. These are synthetic fixtures, not independent users.
- Remote query-mode reporting returned five result sets with zero rows written
  and `changed_db=false`. Aggregate coverage began `2026-10-06T03:55:44.148Z`.
  Initial controlled traffic: 2 quotes, 1 stopped, 1 accepted, 1 result,
  1 eligible self-report and 1 helpful feedback. Ledger: 2 quote events,
  1 accepted event and 1 eligible no-charge event, all settlement amounts zero.
- Remote `--file` mode only returns an import execution summary; the reporting
  wrapper uses `--command=` to retrieve actual SELECT rows. See
  [production reporting](production-reporting.md).

The initial remote counts are a verification snapshot, not permanent current
usage. Do not label these events customers, independently proven recoveries or
revenue. Product value, organic discovery and willingness to pay are unproven.

## Repeatable commands

```sh
pnpm exec wrangler whoami
pnpm worker:check
pnpm exec wrangler d1 migrations apply DB --remote
pnpm exec wrangler deploy
pnpm smoke https://agenttoolbox-retry-gate.agenttoolbox2026.workers.dev
pnpm report:remote
```

Remote commands use the deployed database. For local workerd, use `--local` and
set `PUBLIC_ORIGIN:http://127.0.0.1:8787` on `wrangler dev`. Do not redirect the auth
config directory for remote commands, which would hide the saved login.

Sources: [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/),
[D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/),
[rate-limit bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/),
[Wrangler command options](https://developers.cloudflare.com/workers/wrangler/commands/general/),
[Cloudflare management MCP](https://github.com/cloudflare/mcp).
