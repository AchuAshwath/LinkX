# Persona + Team Integration — Phase 3 Spec

## Summary
Phase 3 delivers scheduling/publishing reliability for persona-scoped posts. It introduces a formal post state machine, retry rules, standardized error payloads, idempotency guarantees, and observability. UI surfaces new states and allows retries for authorized roles.

## Goals
- Add explicit post state transitions for scheduled/publishing flows.
- Implement retryable error handling with a consistent error contract.
- Ensure idempotent publishing to prevent duplicate posts.
- Improve observability with structured logs and metrics.

## Non-Goals
- New social platforms beyond LinkedIn.
- Multiple accounts per persona per platform.

## State Machine
### Statuses
- draft
- scheduled
- publishing
- published
- failed

### Allowed Transitions
- draft -> scheduled
- draft -> publishing
- scheduled -> publishing
- publishing -> published
- publishing -> failed
- scheduled -> failed
- failed -> scheduled (manual retry only, admin/owner)

Invalid transitions return 400.

## Error Contract
All publish/schedule errors must return structured errors:

```json
{
  "error": "linkedin_publish_failed",
  "message": "LinkedIn API returned 429",
  "retryable": true,
  "details": {"platform": "linkedin", "status_code": 429},
  "trace_id": "..."
}
```

## Retry Policy
- Retryable errors are retried up to 3 times with exponential backoff.
- Non-retryable errors immediately mark the post as failed.
- Retry fields are persisted on the post:
  - retry_count
  - last_retry_at
  - next_retry_at (if scheduling a future retry)

## Scheduler Behavior
- Scheduler selects posts where:
  - status = scheduled
  - scheduled_at <= now
- Scheduler transitions status to publishing before attempting publish.
- Idempotency: do not publish if external_post_id already exists.
- On success: set external_post_id, published_at, status = published.
- On retryable error: increment retry_count, set last_retry_at, set next_retry_at, keep status = scheduled.
- On non-retryable error: set status = failed, store error_code/message.

## Schema Updates
Add the following fields to post:
- error_code (string)
- error_message (string)
- retry_count (int, default 0)
- last_retry_at (timestamp)
- next_retry_at (timestamp, optional)
- publishing_started_at (timestamp)

Indexes:
- (persona_id, status, scheduled_at)

## Observability
- Structured logs for publish attempts and failures with:
  - post_id, persona_id, user_id, platform, status, trace_id
- Metrics:
  - publish_attempts_total
  - publish_success_total
  - publish_fail_total (by reason)
  - publish_retry_total

## UI Changes
- Show new states: publishing, failed.
- Display error details on failed posts.
- Owner/admin can manually retry failed posts.
- Members cannot retry or publish.

## Test Plan
- Unit tests:
  - State transition validation
  - Retry classification and counters
  - Idempotent publish logic
- Integration tests:
  - Scheduler selects due posts
  - Retryable errors reschedule with backoff
  - Non-retryable errors mark failed
- UI tests:
  - Publishing and failed state display
  - Retry button visibility (owner/admin only)
  - Retry action updates state

## Assumptions
- Phase 1 persona access and Phase 2 persona-first posts are complete.
- Tokens are persona-scoped and SocialAccounts are persona-linked.
