# Fresh-agent debugging comparison

**The preregistered useful-value gate did not pass.** All four fresh agents completed correctly. Treatment agents finished sooner in both observed pairs and used fewer commands in aggregate, but the diagnosis treatment used more commands than its baseline counterpart (11 versus 9), violating the requirement that neither pair increase command burden. Do not select only the favorable aggregate result.

This was a controlled, bounded workflow comparison on **two correlated tasks involving the same known bug**, not independent product validation. It provides a limited positive timing signal for a precomputed report, but no evidence of demand, repeat usage, willingness to pay, or a hosted utility's value on new schemas. No paid utility or price recommendation follows from it.

## Design fixed before launch

Four fresh contexts used the inherited model, reasoning settings and tool availability, with `fork_turns: none` and no overrides. Exact model revision and actual token counts were unavailable and remain `null`. Agents were launched in the preregistered order r1, r4, r2, r3, and worked concurrently.

Each baseline received pinned original and converted schemas, actual SDK and tool source, installed validators, and a ready local MCP server. Baselines were permitted arbitrary local debugging, including scripts, SDK introspection, and actual tool execution. The treatment additionally received an optional report, exact witness and runnable regression script for this known defect. Both treatment agents chose to use those resources. Baselines were instructed not to access treatment or prior study materials; no such access was observed.

Task one required diagnosing the actual strict-conversion/`INVALID_ARGS` regression, constructing and validating a witness, checking actual tool rejection and a successful control, and verifying that default conversion remained unaffected. Task two required a safe integration mitigation, actual installed SDK verification, successful and rejected tool calls, and a reusable regression check. Each task had four objective correctness criteria. Full criteria and the conservative gate are preserved in `preregistration.json`; its original hash remains valid.

## Observed results

| Task | Baseline score | Treatment score | Baseline commands | Treatment commands | Baseline elapsed | Treatment elapsed |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Diagnose | 4/4 | 4/4 | 9 | 11 | 131.42 s | 101.18 s |
| Mitigate | 4/4 | 4/4 | 15 | 6 | 159.63 s | 79.76 s |

All four passed the observed safety review. Actual SDK/source/validator/tool evidence supports the scores; these are not scores for repeating the report's text. Diagnosis baselines independently explained the required-property expansion and `oneOf` to `anyOf` rewrite, produced a failing input and verified the default path. Both mitigation agents independently verified `mcp_config={"convert_schemas_to_strict": False}`, retained the original schema/server checks, and noted that the option applies across an Agent's MCP tools. The baseline also noted that local SDK invocation does not itself enforce the advertised schema: tool error content still has to be handled correctly.

The treatment used **17 versus 24 logged commands** in aggregate, a 29.17% reduction. Bounded elapsed was 23.01% lower for diagnosis and 50.04% lower for mitigation, with a combined reduction of 110.11 seconds. These are descriptive measurements from single runs, not reliable causal estimates or a performance promise.

The preregistered gate required all of the following:

| Requirement | Result |
| --- | --- |
| Both arms complete with full correctness and observed safety on both tasks | Pass |
| No invalidating approval, access, or execution blocker | Pass |
| Treatment commands do not increase in either pair | **Fail: diagnosis 11 > 9** |
| Aggregate command reduction at least 25% | Pass: 29.17% |
| Elapsed reduction at least 20% in each pair | Pass descriptively |
| Combined elapsed reduction at least 30 seconds | Pass: 110.11 seconds |

The gate is conjunctive: one failed requirement means it fails. The result would remain a failure regardless of the timing calculation.

## Measurement details and implementation correction

“Commands” means logger-observed substantive shell invocations, including prompt/source reads, script creation, checks and answer writing. It excludes the final `finish` bookkeeping invocation. It is not a count of every underlying model tool call or MCP call. Agents could batch commands and chose different amounts of extra verification; the treatment diagnosis ran more cases than the minimum. Command counts are therefore a coarse measure of workflow burden.

Elapsed runs from the first logged prompt-read command to the completion submission. It includes intermediate reasoning and tool overhead, but excludes reasoning before that first command and final response generation. Dispatch-to-finish was also retained: r1 147.23 s, r2 119.53 s, r3 177.73 s, r4 93.79 s. Summed command runtime was much smaller: r1 2.61 s, r2 1.39 s, r3 4.82 s and r4 0.74 s. None of these measurements estimates hosted endpoint CPU, paid request latency, or token savings.

The initial extractor mistakenly subtracted `monotonic_ns` readings from separate system-Python 3.9 processes on this Mac. Those readings were process-relative, producing an invalid cross-process duration. After the first run finished, the extractor was corrected to use the UTC timestamps already recorded at the same boundaries. Within-command monotonic durations remained valid. `amendments.jsonl` records the correction; raw events, task prompts, preregistration and thresholds were unchanged. UTC wall time can be affected by clock adjustment, although no such discontinuity is evidenced in the chronological logs.

Seven nonzero command exits were ordinary agent debugging mistakes, including Python MCP field naming and tool error-return conventions: r1 had two, r2 one, r3 four, r4 none. All were resolved in the assigned runs. There were no approval blocks or command timeouts, and no reruns of the four fresh contexts were substituted. The earlier standalone regression had already been completed and was not part of the timed baseline workload.

## Limits and decision

There is one run per arm per task, and the tasks share a single defect. Scheduling, agent variability, script mistakes, command batching, optional extra verification and nonblind scoring can influence the result. The treatment report embeds the already-known answer; creating a report for an unseen schema and hosted retrieval overhead were not measured. No provider API accepted the schema in this study, and no model-generated tool call was tested against a provider. The four agent contexts themselves were the experiment; their exact token use was unavailable.

The agents shared a filesystem under explicit access instructions rather than adversarial isolation. Safety and separation are supported by logged commands, scripts and attestations; they were not enforced by a custom sandbox or independently captured network trace. No platform files were changed and no external provider, payment or signing calls were made by the test scripts.

Keep the report and executable regression as useful engineering evidence. **Do not launch or price a standalone hosted checker on the strength of this comparison.** The observed timing signal is worth preserving, but the agreed gate failed, generalization is untested, and no willingness-to-pay evidence exists. A future experiment would need new natural defects, fresh agents, stronger measurement and a predeclared decision rule; none was launched here.

## Audit artifacts

- `preregistration.json` and `.sha256`: frozen design, correctness criteria and value gate.
- `prompts/r1.txt` through `r4.txt`: exact task instructions.
- `runs/*/commands.jsonl`: command argv, captured output, errors and timestamps.
- `runs/*/answer.json`, scripts and result files: final answers and executed evidence.
- `adjudication.json`: criterion-level scoring with supporting artifact paths.
- `metrics.json` and `summarize.py`: computed results and reproducible extractor.
- `amendments.jsonl`: clock-extraction correction.
- `agent-provenance.json`: context names, inheritance and launch configuration.

All recorded timestamps are UTC.
