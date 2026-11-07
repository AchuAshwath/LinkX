# Readiness-gate TDD record

Date: 2 November 2026
Scope: strict browser readiness metadata and sequential request preparation. The
browser route remains owned by the integration work.

## Red → green slices

1. **Readiness schema.** The first test failed collection because
   `ReadinessResult` did not exist. Added a strict schema with only `decision`,
   `evidence_ids`, `requires_complete`, and `answer_basis`. The red assertions
   now verify that missing required fields and an extra `answer` field are
   rejected.
2. **Provider preparation.** The provider test failed with missing
   `BrowserModel.prepare`. Added a dedicated `browser_readiness` structured
   payload and prompt. It uses the selected model, the same projected/fitted
   history and browser context as evaluation, and the readiness schema for
   output budgeting. `preflight_readiness` plans that exact payload without a
   provider call. A separate missing-field check preserves the evaluator's
   strict response validation. No answer field can pass schema validation.
3. **Request preparation.** The two-frame test failed because
   `QuestionRunner.prepare` did not exist. Added the serial readiness/read loop
   and tested that it reads both frozen views before using evidence found only
   in the second view. The caller's original context stays unchanged; the
   prepared copy contains the notes and the result retains receipts.
4. **Behavioral edges.** Added tests for early supported evidence, general
   questions that leave unrelated frames unused, broad questions that settle
   every pending frame, failed-frame gaps that keep a broad result insufficient,
   cancellation during a read, and readiness that cites unknown evidence or
   lacks both known IDs and a summary.

## Verification

- `uv run ruff check app/observation/model.py app/observation/schemas.py app/observation/question.py tests/observation/test_readiness.py` — passed.
- `uv run mypy app/observation/model.py app/observation/schemas.py app/observation/question.py` — passed.
- New readiness tests — 11 passed.
- Readiness plus existing question, evaluation, and budget tests — 36 passed.
- Full observation suite at the time — 102 passed, 17 failed. The failures
  were concentrated in existing browser API/title tests that mock the legacy
  evaluator while the route integration was moving to `prepare`; route files
  were outside this TDD slice.

This record establishes contract behavior on synthetic providers and frames.
It is not a live-model readiness-quality claim.
