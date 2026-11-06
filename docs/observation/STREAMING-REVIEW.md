# Browser streaming implementation and review

Issue: [#189](https://github.com/AchuAshwath/LinkX/issues/189). Baseline: `8d0dd29`.
Design recorded: 2 November 2026. Final validation: 6 November 2026.
Status: implemented, independently reviewed, and validated. Commit and draft PR publication approved by the user on 6 November.

## Selected design

Use the readiness-only gate followed by the normal selected-model agent. The
gate returns structured control/evidence metadata and never final prose. The
ordinary agent generates the only answer, with normal permitted tool events.
Keep the dedicated bounded browser endpoint and temporary capture/memory model.

The [comparison](streaming-comparison-v1/REPORT.md) does not establish a latency
or quality winner. Its deterministic cases test sequencing; its four live trials
use synthetic text rather than screenshots. The live gate/tool candidates used
equal call counts in those particular trials and had substantial latency variation.
The tool candidate retained explicit planning calls, so those measured counts
must not be confused with the theoretical leaner tool-loop arithmetic in the plan.

The gate is selected for its explicit evidence-settlement point and simpler
separation between preparation and answer ownership. This is an engineering
tradeoff within the accepted bounded demo, not a claim of optimal cost or universal
readiness accuracy. The evidence-tool design remains a possible later optimization
if measured benefit justifies its completeness, repeat-call and privacy complexity.

The comparison completed 20 serial live calls before the agent received a later
16-call cap. No further comparison calls were made. Retain that execution history
rather than presenting the study as within the later cap.

## Delivered interfaces

- `BrowserModel.prepare` and `QuestionRunner.prepare`: strict no-answer control
  schema, frozen evidence, serial reads, early/general exits, broad settlement,
  explicit insufficient exit and receipts.
- `BrowserAgentPolicy` and `AgentOptions`: actual combined prompt/tool accounting
  on every model invocation, temporary escaped reference, current-user action
  guards, cancellation before actions, no browser SDK retries and bounded timeout.
- `stream_agent_events`: shared ordinary model/tool event normalization, with
  browser-only suppression of private thought recovery.
- `StreamTurn` and request-bound transcript completion: ordinary part collection,
  interrupted partials, deterministic browser IDs and structured replay without
  model/tool execution. The ordinary runner no longer writes transcripts.

## Review corrections

Independent Luna review identified action-authorization false positives for
educational/hypothetical questions and an explicit insufficient gate draining
unrelated pending images. Public-interface regressions reproduce both and the
implementation was corrected. Early integration review also found private EOF
thought promotion, missing Stop checks at tool invocation, and loss of general
or conversation evidence basis; those now have focused regressions.

The final review also identified unfinished private-thought recovery, tool errors
leaving running cards, and parallel same-name tool results matched by name.
Observed failing regressions now pass for these cases. CodeScene findings for
complexity, argument count, duplication, and cohesion were refactored against the
behavior tests. The [independent code review](streaming-final-code-review.md)
and [audit](streaming-final-audit.md) have no remaining concrete blockers.

## Validation

| Check | Result |
| --- | --- |
| Full backend suite, 6 November | 1,009 passed, 39 warnings |
| Full frontend unit suite, 6 November | 385 passed in 43 files |
| Static checks | Ruff check/format, mypy (107 files), frontend lint, TypeScript, and production build passed |
| Generated API client | Regenerated successfully; no OpenAPI or generated-client diff |
| Controlled Chrome, 6 November | [25 system checks](system-smoke.md) and [preview/source/Stop pending-image scenarios](pending-capture-close/README.md) passed |
| Regression sensitivity | Reintroducing capture-close cancellation in the test browser fails at the expected assertion |
| Live selected-model endpoint, 2 November | [90 answer chunks](streaming-live-endpoint-result.json), correct synthetic-note facts, one saved answer pair |
| CodeScene local safeguard and branch delta | Both passed; each checked 40 eligible changed files |

The complete backend run is recorded in
`/tmp/linkx-189-final-nov6-backend-tests.log`; the frontend run is in
`/tmp/linkx-189-final-nov6-frontend-tests.log`. The final frontend helper extraction
also passed 34 focused tests and TypeScript. Full suites precede only that
behavior-preserving extraction and final documentation/harness updates.

After the user-authorized implementation commit, the true branch-level CodeScene
comparison against `origin/master` passed with 40 eligible changed files checked
and no findings. The earlier zero-file result before committing was not counted
as change coverage. Commit hooks also passed, including SDK regeneration.

The controlled provider tests prove transport and lifecycle behavior, not live
model accuracy. The selected-model live endpoint result predates the final review
fixes and uses synthetic notes, not screenshots; it is incremental-delivery
evidence, not OCR or universal grounding evidence.

## Limits

The feature remains a single-process desktop Chrome demo. Model reading and
readiness judgments can be wrong; context metadata/token counts are estimates.
Tool guards use a conservative supported grammar, not a general language intent
classifier. Stop cannot recall a remote provider request or roll back an already
executed action. A crash can lose output not yet committed; this is not durable
job recovery or exactly-once external side-effect execution.

The selected-model/no-retry/no-fallback policy applies to browser read, readiness,
and final-answer generation. Ordinary tools remain available with their inherited
internals: drafting may use the global draft model and template fallback, scraping
has separate pipelines, and ordinary tool calls may run concurrently. The
sequential browser evidence lane is preserved. These tool internals are outside
this increment's model-consistency guarantee.
