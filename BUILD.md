# AgentToolbox — multi-product validation platform

Updated October 6, 2026 from Douglas's latest instructions. This supersedes the
retry-gate-only brief preserved in archive/retry-gate/BUILD.original.md.

## Objective

Build a stable home where agents discover small tools for their current problem,
inspect the promised outcome, success criterion and price, invoke with minimal
setup, and choose whether to return. Human observers should see a polished,
friendly red robot/toolbox identity without adding friction for machines.

Do not invent products, useful outcomes, customer numbers, benchmarks, demand,
revenue or payment readiness. The retry gate is retired after its controlled
comparisons failed to show incremental value. Preserve its source and history;
do not promote it as the flagship.

## Current authorized scope

- Publish on the existing Cloudflare Free plan. Use a short Worker name,
  agnttoolbx, under the existing workers.dev subdomain. No domain purchase,
  paid add-on, facilitator top-up or spending is approved.
- Disable the old retry-gate public route recoverably. Preserve Worker source,
  versions, D1 records, payment records and experiment findings.
- Use the supplied original AgentToolbox icon, not a recreated substitute.
- One data-driven product registry drives stable HTML, JSON, Markdown and MCP
  discovery. Keep product IDs/versioning stable across launches and retirements.
- Agents must be able to search by problem, inspect lifecycle/status, schemas,
  outcome and success evidence, then see exact price/payment availability before
  invocation. Return bounded, explicit machine-readable errors.
- Start with an honest empty active catalog and an archive. A candidate utility
  is not a live product until actually implemented and tested.
- Record per-product/version usage, execution, outcomes, repeat pseudonyms and
  payment states. Distinguish synthetic activity, unclassified traffic,
  self-reported usefulness, facilitator reports and independently reconciled
  on-chain revenue. Never call raw request volume customers.
- Keep operational reporting read-only and private through authenticated
  Wrangler/D1 access. No unauthenticated admin dashboard.

## Latest payment requirement

Douglas explicitly requested x402 integration now to test repeated willingness
to pay. Implement the current official protocol and a concrete outcome-based
execution boundary. Do not defer protocol implementation solely because the
platform is new.

No agent-executed wallet signatures, cryptocurrency sends, private-key handling
or real settlement tests. User-controlled live-money verification remains a
handoff. Never claim paid-ready before actual facilitator and payment behavior
are verified.

The existing receiving configuration is
0xD43350dD5a40Dd8689C644A0477Bb75e3A59129D. It is public configuration, not a
secret. Douglas explicitly confirmed this recipient for Base native USDC on October 6,
2026. The adapter remains disabled until a real product contract is available;
actual payment behavior still requires user-controlled verification.

For each paid tool: disclose a fixed success criterion and cap; verify
authorization; execute and validate the terminal result; durably store result
and settlement intent; settle only then; release the result only after confirmed
settlement and durable ledger recording. Failed outcomes must not trigger
settlement. An ambiguous timeout must block fresh charges until reconciliation.
Never promise refunds without implementing them.

Use only an available free facilitator allowance; stop at exhaustion. No account,
API key or paid upgrade is implied by public provider documentation. Preserve an
append-only financial ledger separate from short-lived task/output records.

## Validation and handoff

Run relevant old and new tests, syntax/type checks applicable to the project,
Worker builds and runtime checks. Verify public plain HTTP and official MCP
client discovery; verify retired invocation rejection and old route takedown.
Review desktop/mobile, repeated navigation, empty/search/archive states and
no-JavaScript use. Show the finished public page in the user's actual Chrome.
Return exact URL, commits/PR, evidence, telemetry coverage and limitations.

Use explicit latest user instructions over stale repository scope. Preserve
unrelated work, avoid speculative product breadth, and stop expansion when
evidence does not show added value.
