# Fresh-agent controlled retry comparison

Run on October 6, 2026 UTC. This is a controlled synthetic-failure study on a real,
fixed repository snapshot. It is not organic discovery, customer use or a payment
trial.

## Outcome

Twelve fresh agent contexts were dispatched; ten executed the task. Four complete
baseline/treatment pairs had equal correctness, stopping behavior and upstream
request counts. All five treatment agents that executed voluntarily skipped the
optional live retry gate. Therefore this study measures neither incremental gate
benefit nor gate-call overhead.

The evidence does not justify expanding the retry-gate product. Independent
discovery, repeat useful usage, willingness to pay and production CPU distribution
remain unmeasured.

## Protocol and scope

Both arms received the same task, model/settings inheritance, tools, competent
retry guidance and bounded retry budget. Treatment agents additionally had the
option to call the deployed gate. Gate use was not required. Contexts were fresh;
the shared filesystem was constrained through instructions, not adversarial
isolation.

Each agent read three fixed repository files through a local HTTP fixture and
reported five objectively scoreable facts. Paired runs received identical fault
schedules: healthy, HTTP 429 with Retry-After, recoverable HTTP 503, connection
reset, persistent HTTP 503 and unsupported HTTP 418. These are synthetic faults
over a genuine read-only repository task.

Snapshot tree: `733edbe2f4590bf237bb36acf705b728bbd0aad3`.
The files were `package.json`, `src/contracts.js` and
`migrations/0002_usage_totals.sql`.
Snapshot SHA-256:
`cf264fe8dade3a4639efd36720c75d7dafa3f0cf29da49f09e61e76f8bb01109`.

Scored facts: Node.js >=24; package manager pnpm@11.19.0; MCP SDK 1.32.1;
max_wait_ms 30000; and the usage_feedback trigger.

## Observations

| Observation | Result |
| --- | --- |
| Contexts dispatched | 12 |
| Contexts executing HTTP fixture reads | 10 |
| Complete comparable pairs | 4: 503, reset, persistent 503, 418 |
| Completed fact-reading runs | 6 |
| Correct observed facts | 30/30 |
| Correct bounded stops | 4 |
| Total upstream requests | 17 |
| Retries | 7; all respected the explicit 1000 ms wait |
| Executed treatment agents using the gate | 0/5 |
| Live gate calls in this trial | 0 |
| Actual token counts | Unavailable; null |
| Exact model revision | Not exposed |

The two incomplete pairs were healthy (baseline r01 blocked) and 429 (treatment
r03 blocked). Automatic approval review rejected each missing observation twice,
including after original human authorization evidence was supplied. The rejections
cited authorization and script-trust concerns. Each made zero HTTP requests.
Neither observation was bypassed or replaced; they are environment exclusions,
not product failures or successful task outcomes.

## Elapsed time

Seconds from first fetch-command invocation through the finish command, and from
dispatch through that same finish command:

| Complete pair | Baseline fetch-to-finish | Treatment fetch-to-finish | Baseline dispatch-to-finish | Treatment dispatch-to-finish |
| --- | ---: | ---: | ---: | ---: |
| Recoverable 503 | 22.676 | 24.427 | 46.646 | 62.839 |
| Connection reset | 23.352 | 21.973 | 62.462 | 46.021 |
| Persistent 503 | 17.853 | 20.071 | 46.231 | 59.598 |
| Unsupported 418 | 4.784 | 6.362 | 42.285 | 32.868 |

These timings include intervening reasoning, approvals and tool execution, but
exclude the final return/render. Dispatch timing includes launch staggering.
No timing difference can be attributed to gate calls: there were none.
There is one observation per arm/scenario, so these are descriptive results, not
a statistical estimate or causal claim.

Agents self-reported 54 exec_command invocations. The audit reconciles these to
38 logged runner commands, 12 instruction reads and four rejected calls.
The parent-observed completion time is only an upper bound.

## Evidence and interpretation

The full frozen local bundle named `fresh-agent-trial` contains REPORT.md,
results.json, a runnable README, preregistered protocol, fixture/probe/summarizer
scripts, snapshot manifests, command/upstream/lifecycle logs, prompts, per-run
answers, provenance, approval rejection evidence and a SHA-256 manifest. The
fixture was stopped after the trial. That private audit bundle is retained in the
authoring workspace and is not committed here; some source files include private
authorization transcripts. A redacted provenance copy is available in the bundle.
This repository report is a curated summary, not a standalone reproduction kit.

A remote read-only usage report after the study was unchanged from deployment
smoke testing: two synthetic quotes, one stopped quote, one accepted result and
zero settlement. It supports the recorded zero live gate calls, but is not
independent verification of an agent's upstream outcome.

The earlier designer-assisted fixture comparison and this fresh-agent study are
distinct. The earlier test exercised the gate and observed added latency. This
study allowed agents to choose, and none used it. Neither demonstrates incremental
product value. Keep the deployed experiment bounded and free; do not add payment
or product infrastructure on the strength of these results.
