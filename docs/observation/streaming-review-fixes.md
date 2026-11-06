# Streaming Review Fixes

Started: 2026-11-02. Updated: 2026-11-06.

## Readiness and browser-action review

- Readiness `insufficient` now ends evidence preparation without draining pending
  images. The existing unused-frame receipts remain attached to the prepared
  result so the answer path can report the known gaps without rereading them.
- Action authorization now matches anchored direct requests and strict action
  objects with supported polite prefixes, rather than searching substrings. Coverage includes “How do
  I…”, “show me how”, “explain how”, instructions, advice questions, and
  hypothetical requests. A direct request such as “Can you create a draft
  post?” remains supported. This is a conservative phrase grammar, not a
  general natural-language authorization classifier.
- Browser history fitting now has one shared planner for readiness and legacy
  evaluation requests. Both retain their public methods and distinct schemas,
  prompts, and validation errors.
- Validation diagnostic extraction shares one bounded helper while retaining
  the per-schema field allowlists.

## Verification

Regression tests were observed failing before the fixes: educational action
questions reached wrapped tools, and explicit `insufficient` readiness read
both pending frames. The focused suite now passes, including readiness, browser
agent policy, and model evaluation tests. Ruff and mypy pass for the touched
Python modules. CodeScene reports browser-agent, model, and question at 10.0
with no findings.

## Final resumed review corrections, 6 November

- Observed educational and capability questions reaching action tools; tightened
  the supported grammar while retaining direct draft requests.
- Observed incomplete private-thought tags recovered as visible browser prose;
  browser mode now suppresses that recovery and raw reasoning fields.
- Observed `on_tool_error` leaving tool cards running; the shared stream now emits
  a sanitized failure result, persisted and replayed as failed.
- Observed out-of-order same-name frontend tools matched to the wrong card;
  event IDs now survive dispatch and correlate results, with legacy name fallback
  only when an incoming event has no ID.
- Added real ordinary-agent/HTTP/database regressions for a draft saved once and
  linked to its chat, replay without tool execution, and failure after a real
  first answer chunk without a second generation.

Each behavioral correction had an observed failing regression before the fix.
Final consolidated checks and their limits are in
[STREAMING-REVIEW.md](STREAMING-REVIEW.md).
