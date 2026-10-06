# Retry-gate learning protocol

Written before the local trial. Hypothesis: agents facing unfamiliar tool failures
save time/tokens or avoid unsafe actions by using a deterministic gate. This is
not established; a caller that already implements the rules may gain nothing.

## First local comparison

Timebox: one ten-minute controlled run and necessary fixes. Participant: the
building Codex agent driving a deterministic HTTP fixture and official MCP SDK
client. This is designer-assisted integration evidence, not a fresh independent
agent, customer, organic discovery or a paid trial.

Run the same three tasks both with and without the service:

| Task | Initial failure | Correct success/safety condition |
| --- | --- | --- |
| Read catalog | HTTP 429, Retry-After 1 second | one later retry returns 200 |
| Read inventory | HTTP 503, Retry-After 0 | one retry returns 200 |
| Submit an order | timeout; state-changing, no idempotency | stop; no duplicate action |

Baseline: a competent caller that respects Retry-After and refuses unsafe writes.
Do not compare only against blind retry. Helper: discover MCP tools, quote at a
zero cap, accept, wait, execute one retry locally, submit digest/outcome, inspect
receipt and feedback. Repeat the safe catalog task using the same random agent
pseudonym to verify instrumentation. This scripted repeat is not retention.

Record schema/setup failures, completion, attempts, recommendation latency,
elapsed time, self-report evidence and any founder intervention. Save measured
results, not a proposed count presented as completed work. Do not invent token,
money or time savings; compare elapsed times and qualify local timing noise.

Payment shown: 0 atomic USDC; acceptance is dev, settlement count and revenue zero.
Payment intent, willingness to pay and settlement remain untested. Cost-to-serve
is unknown until actual hosting/facilitator billing is measured; local latency is
only a cost proxy. Operator effort is optional self-report, not observed labor.

## Fresh-agent controlled follow-up (completed)

The [October 6 UTC fresh-agent study](fresh-agent-report.md) dispatched 12 contexts
against a fixed real repository snapshot with matched synthetic fault schedules.
Ten executed; four complete pairs were equal in correctness, stopping and upstream
calls. All five executed treatment agents chose not to call the optional gate.
Two observations were excluded after automatic approval rejections. Actual token
counts are unavailable. This supplies no measured incremental gate benefit or
gate-call overhead, and does not justify product expansion. The frozen private
local audit bundle contains the runnable protocol and detailed logs.

## Next organic external trial (proposed, not run)

After public setup/access verification, invite one fresh agent to one real task
and expose only the MCP description. Compare its existing retry approach on a
matched task. Capture discovery source, setup effort, correctness, latency,
reported savings and whether it returns without prompting. Stop if the helper
increases effort without saving failures or preventing unsafe work. Fix a concrete
blocker before broadening cases. Do not add infrastructure to compensate for no
observed benefit. No invitations or messages are sent by this implementation.

Proceed to a payment trial only after the success-evidence rule, network/address,
testnet behavior and explicit spending cap are approved. A successful payment is
directional evidence; repeat useful paid calls matter more.

## Economics worksheet (assumptions, not a forecast)

For monthly contribution target T, fee P, average serving/facilitator cost C and
variable support cost S (all in the same currency): required successful paid calls
= ceil(T / (P - C - S)), if the denominator is positive. Include unsuccessful calls
in serving costs. At an illustrative $1,000/month, $0.02 success fee and combined
$0.002 cost per paid call, the requirement is 55,556 paid calls/month; at $0.01 fee,
it is 125,000. Neither prices nor costs are validated. Dev calls never count toward
these totals. Organic discovery, repeat paid use, net revenue and support burden
remain the business tests; raw calls and compliments are insufficient.
