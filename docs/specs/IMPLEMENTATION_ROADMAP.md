# LinkX Implementation Roadmap

**Status:** Planning → In Progress  
**Last Updated:** March 11, 2026  
**Related Spec:** [PERSONA_TEAM_SPEC.md](./PERSONA_TEAM_SPEC.md)

---

## Executive Summary

This roadmap outlines the remaining implementation work for the Persona + Team Integration and Post Scheduler system. The specification has been consolidated into a single comprehensive document, but the **scheduler service implementation** remains the critical missing component.

### Current Status

| Component | Status | Notes |
|-----------|--------|-------|
| Database Schema (Phase 3) | ✅ Complete | Alembic migration `e7f8a9b0c1d2_add_post_reliability_fields_phase3.py` created |
| Post Model | ✅ Complete | All Phase 3 fields added (retry_count, error_code, etc.) |
| Backend API | ✅ Complete | persona_id required, persona_access enforced |
| Scheduler Service | ❌ Missing | **Critical - No implementation yet** |
| Admin Endpoints | ❌ Missing | Status, monitoring, metrics endpoints needed |
| Frontend UI | ⚠️ Partial | Post state display not implemented |
| Tests | ❌ Missing | Integration tests for scheduler behavior |

---

## Work Breakdown

### 1. Scheduler Service Implementation (Backend)

**Priority:** HIGH  
**Effort:** 20-25 hours  
**Status:** Not started

#### 1.1 Service Architecture

Create `backend/app/services/scheduler.py` with the following components:

- **SchedulerService class**: Main orchestrator
  - Poll database for scheduled posts (status='scheduled', scheduled_at <= NOW)
  - Lock acquisition/release for distributed deployments
  - Post processing loop with error handling
  - Graceful shutdown handling

- **RetryPolicy class**: Exponential backoff logic
  - Initial delay: 60 seconds
  - Max retries: 3
  - Backoff multiplier: 2x
  - Calculate next_retry_at timestamp

- **ErrorClassifier class**: Determine if error is retryable
  - Retryable: 429 (rate limit), 5xx (server error), timeouts
  - Non-retryable: 401 (auth), 400 (bad request), 403 (forbidden)
  - Store error_code and error_message for diagnostics

#### 1.2 Implementation Details

**Configuration** (add to `backend/app/core/config.py`):
```python
SCHEDULER_POLL_INTERVAL: int = 30  # seconds
SCHEDULER_MAX_RETRIES: int = 3
SCHEDULER_INITIAL_RETRY_DELAY: int = 60  # seconds
SCHEDULER_BACKOFF_MULTIPLIER: float = 2.0
SCHEDULER_ENABLED: bool = True
```

**Database Query**:
- Use index on (persona_id, status, scheduled_at) for efficiency
- Query: `SELECT * FROM post WHERE status='scheduled' AND scheduled_at <= NOW() ORDER BY scheduled_at ASC LIMIT 100`

**Post State Transitions**:
```
scheduled → publishing → published (success)
scheduled → publishing → scheduled (retryable error, reschedule)
scheduled → publishing → failed (non-retryable error, manual intervention required)
```

**Distributed Lock** (using Redis):
- Lock key: `linkx:scheduler:lock`
- Lock duration: SCHEDULER_POLL_INTERVAL * 2 (60 seconds)
- Use Redis SET with NX and EX flags
- Release lock immediately after processing batch

**Idempotency**:
- Check `external_post_id` before publishing (prevents duplicate posts)
- Store linkedin/external platform's response ID
- Atomic transaction: update post status and external_post_id together

#### 1.3 Dependencies

Add to `backend/pyproject.toml`:
```toml
"apscheduler>=3.10.0,<4.0.0",  # Background job scheduling
```

**Note:** APScheduler chosen over Celery for simplicity (single-process scheduler in one container). If multi-instance scheduling needed later, migrate to Celery.

#### 1.4 Integration with Existing Code

- Use existing `PublishFailure` class from `services/publishing.py`
- Use existing `publish_post()` function for actual publishing
- Use existing `get_persona_role()` from `services/access.py` for access checks
- Update `models.py` Post model (already done - has all Phase 3 fields)

#### 1.5 Logging & Metrics

Add structured logging:
```python
logger.info("scheduler_poll_start", extra={
    "scheduled_posts_found": count,
    "timestamp": now_iso
})

logger.info("post_publishing", extra={
    "post_id": str(post.id),
    "persona_id": str(post.persona_id),
    "platform": post.platform
})

logger.error("publish_failed", extra={
    "post_id": str(post.id),
    "error_code": error_code,
    "retry_count": post.retry_count,
    "next_retry_at": next_retry_at.isoformat()
})
```

Prometheus metrics to add:
- `linkx_scheduler_posts_published_total` (counter)
- `linkx_scheduler_posts_failed_total` (counter)
- `linkx_scheduler_posts_retried_total` (counter)
- `linkx_scheduler_poll_duration_seconds` (histogram)
- `linkx_scheduler_lock_wait_duration_seconds` (histogram)

#### 1.6 Testing Strategy

**Unit Tests** (`backend/tests/services/test_scheduler.py`):
- Test state transitions with mocked publish_post
- Test exponential backoff calculation
- Test error classification logic
- Test distributed lock behavior (with mocked Redis)
- Test idempotency (duplicate external_post_id)

**Integration Tests** (`backend/tests/api/routes/test_posts_scheduler.py`):
- Create test post with scheduled_at in past
- Run scheduler poll
- Verify post state changes to published
- Verify LinkedIn API was called (mocked)
- Test retry behavior with simulated failures

---

### 2. Admin Endpoints (Backend)

**Priority:** HIGH  
**Effort:** 5-8 hours  
**Status:** Not started

#### 2.1 New Endpoints

Add to `backend/app/api/routes/admin.py`:

**GET /api/v1/admin/scheduler/status**
```python
Response:
{
  "status": "running|stopped|error",
  "last_poll": "2026-03-11T17:30:45Z",
  "next_poll": "2026-03-11T17:31:15Z",
  "posts_in_queue": 12,
  "posts_failed": 3,
  "uptime_seconds": 3600
}
```

**GET /api/v1/admin/scheduler/pending-posts**
- Query params: persona_id (optional), limit=100, skip=0
- Returns: List of posts with status='scheduled', ordered by scheduled_at ASC
- Fields: id, persona_id, content, platform, scheduled_at, retry_count, error_code

**GET /api/v1/admin/scheduler/failed-posts**
- Query params: persona_id (optional), limit=100, skip=0
- Returns: Posts with status='failed', including error details
- Fields: id, persona_id, content, platform, error_code, error_message, last_retry_at

**POST /api/v1/admin/scheduler/run-now**
- Manually trigger scheduler poll (for testing/emergencies)
- Response: { "posts_processed": 5, "posts_published": 3, "posts_failed": 0 }

**GET /api/v1/admin/scheduler/metrics**
- Returns Prometheus metrics in text format
- Include scheduler-specific counters and histograms

#### 2.2 Access Control

All admin endpoints require:
- Current user must be superuser (`is_superuser=True`)
- Or admin of a persona (for persona-scoped endpoints)

---

### 3. Frontend UI Updates

**Priority:** MEDIUM  
**Effort:** 10-15 hours  
**Status:** Not started

#### 3.1 Post State Display

Update post list/card components to show state badges:

**States and Visual Indicators:**
- `draft` → Gray badge "Draft"
- `scheduled` → Blue badge with calendar "Scheduled" + scheduled_at time
- `publishing` → Orange spinner "Publishing..."
- `published` → Green checkmark "Published"
- `failed` → Red badge "Failed" with error icon

**Implementation:**
- Update `frontend/src/components/PostCard.tsx`
- Add status badge component
- Display scheduled_at if applicable
- Show error details in tooltip on failed state

#### 3.2 Error Details Display

For posts with status='failed':
- Show error_code (e.g., "LINKEDIN_AUTH_ERROR")
- Show error_message (e.g., "Invalid OAuth token")
- Show last_retry_at timestamp
- Conditional: Show retry button if user is admin/owner

#### 3.3 Retry Action

Add retry button for failed posts (admin/owner only):

**POST /api/v1/posts/{id}/retry** (backend - NEW)
- Reset retry_count to 0
- Set status back to 'scheduled'
- Set scheduled_at to NOW (immediate retry)
- Return updated post

Frontend behavior:
- Button appears only for status='failed' and user is admin/owner
- Click → API call → Toast notification (success/error)
- Post state updates to 'scheduled' and disappears from failed list

#### 3.4 Admin Dashboard (New Page)

Create `frontend/src/pages/AdminScheduler.tsx`:

**Layout:**
- Scheduler status card (running, uptime, next poll)
- Stats cards (posts in queue, failed posts, total published today)
- Pending posts table (sortable by scheduled_at, searchable by persona)
- Failed posts table (sortable by error, searchable by persona)
- Action buttons: "Run scheduler now" (trigger admin endpoint), "Refresh"

**Permissions:**
- Only accessible to superuser
- Show only posts from personas they have access to (if applicable)

---

### 4. Testing

**Priority:** MEDIUM  
**Effort:** 8-10 hours  
**Status:** Not started

#### 4.1 Unit Tests

**File:** `backend/tests/services/test_scheduler.py`

Tests to implement:
- [ ] Test scheduler initialization and shutdown
- [ ] Test post selection query (correct status and scheduled_at filtering)
- [ ] Test distributed lock acquisition and release
- [ ] Test retry policy with exponential backoff (60s, 120s, 240s)
- [ ] Test error classification (retryable vs non-retryable)
- [ ] Test state transitions (scheduled → publishing → published)
- [ ] Test state transitions (scheduled → publishing → failed)
- [ ] Test idempotency with duplicate external_post_id
- [ ] Test logging output
- [ ] Test metrics emission

#### 4.2 Integration Tests

**File:** `backend/tests/api/routes/test_posts_scheduler.py`

Tests to implement:
- [ ] Create scheduled post, run scheduler, verify published
- [ ] Create scheduled post with LinkedIn API error (retryable), verify retry scheduled
- [ ] Create scheduled post with LinkedIn API error (non-retryable), verify failed status
- [ ] Test retry endpoint resets retry_count and status
- [ ] Test admin endpoints (pending-posts, failed-posts, metrics)
- [ ] Test distributed lock prevents concurrent scheduling
- [ ] Test scheduler respects persona_access (only publishes if user has access)

#### 4.3 E2E Tests

**File:** `frontend/tests/scheduler.spec.ts`

Tests to implement:
- [ ] Create post and schedule for future date
- [ ] Verify scheduled state displays in post list
- [ ] Run scheduler and verify state changes to published
- [ ] Verify failed post displays error details
- [ ] Verify retry button appears and works
- [ ] Verify admin dashboard shows pending/failed posts

---

### 5. Configuration & Environment

**Priority:** MEDIUM  
**Effort:** 2-3 hours  
**Status:** Not started

#### 5.1 Environment Variables

Add to `.env`:
```bash
# Scheduler Configuration
SCHEDULER_ENABLED=true
SCHEDULER_POLL_INTERVAL=30
SCHEDULER_MAX_RETRIES=3
SCHEDULER_INITIAL_RETRY_DELAY=60
SCHEDULER_BACKOFF_MULTIPLIER=2.0

# Redis for distributed locks
REDIS_URL=redis://redis:6379/0
REDIS_LOCK_TIMEOUT=60

# Logging
LOG_LEVEL=INFO
STRUCTURED_LOGGING=true

# Metrics
PROMETHEUS_ENABLED=true
PROMETHEUS_PORT=9090
```

#### 5.2 Docker Configuration

Update `backend/Dockerfile` or `compose.yml`:
- Ensure Redis container is running
- Add scheduler service startup (new background task in main app)
- Ensure migrations are run before scheduler starts

#### 5.3 Deployment Documentation

Create `docs/SCHEDULER_DEPLOYMENT.md`:
- Configuration reference
- Multi-instance deployment (Redis lock coordination)
- Monitoring setup (Prometheus + Grafana)
- Troubleshooting guide
- Performance tuning (batch size, poll interval)

---

## Implementation Phases

### Phase A: Core Scheduler Service (Weeks 1-2)
1. Create scheduler service with database polling
2. Implement retry logic and error classification
3. Add distributed lock mechanism
4. Unit tests for scheduler logic
5. Integration tests with mocked LinkedIn API

**Deliverable:** Working scheduler that publishes posts and handles retries

### Phase B: Admin Monitoring (Week 2-3)
1. Implement admin endpoints (pending, failed, status, metrics)
2. Add structured logging
3. Add Prometheus metrics
4. Integration tests for admin endpoints
5. Documentation

**Deliverable:** Admin can monitor scheduler health and metrics

### Phase C: Frontend Updates (Week 3-4)
1. Update post components to show state badges
2. Implement error display and retry button
3. Build admin dashboard
4. E2E tests for UI
5. UX review and polish

**Deliverable:** Users see post states and can retry failed posts

---

## Risk Assessment & Mitigation

| Risk | Impact | Likelihood | Mitigation |
|------|--------|-----------|-----------|
| LinkedIn API rate limits | Posts fail to publish | Medium | Implement backoff delay, monitor rate limit headers |
| Database lock contention | Scheduler becomes bottleneck | Low | Use efficient query with index, limit batch size |
| Token expiration during retry | Posts fail permanently | Medium | Refresh token before retry, handle 401 specifically |
| Duplicate posts on multi-instance | Duplicate content on LinkedIn | Medium | Distributed lock + external_post_id check |
| Scheduler crashes | Posts stuck in 'publishing' state | Low | Add heartbeat monitoring, manual recovery endpoint |

---

## Success Criteria

1. ✅ Scheduler polls database every 30 seconds
2. ✅ Posts with scheduled_at <= NOW transition to 'publishing'
3. ✅ Successful publishes transition to 'published'
4. ✅ Retryable errors use exponential backoff (60s, 120s, 240s)
5. ✅ Non-retryable errors transition to 'failed'
6. ✅ Admin can view pending and failed posts
7. ✅ Admin can trigger manual retry on failed posts
8. ✅ Frontend shows post states with visual indicators
9. ✅ No duplicate posts published (idempotency verified)
10. ✅ Distributed lock prevents concurrent publishing on multi-instance

---

## Effort Estimate Summary

| Component | Hours | Owner |
|-----------|-------|-------|
| Scheduler Service | 25 | Backend |
| Admin Endpoints | 8 | Backend |
| Testing (Backend) | 10 | Backend |
| Frontend State Display | 8 | Frontend |
| Frontend Retry UI | 5 | Frontend |
| Admin Dashboard | 5 | Frontend |
| Testing (Frontend) | 7 | Frontend |
| Documentation | 3 | Tech Lead |
| **Total** | **71 hours** | |

**Timeline:** 2-3 weeks with full-time dedicated developer

---

## Next Steps

1. **Week 1:**
   - [ ] Add APScheduler to pyproject.toml
   - [ ] Create `services/scheduler.py` with core polling logic
   - [ ] Create `services/retry_policy.py` for exponential backoff
   - [ ] Create `services/error_classifier.py`
   - [ ] Write unit tests

2. **Week 2:**
   - [ ] Implement distributed lock with Redis
   - [ ] Add structured logging
   - [ ] Implement admin endpoints
   - [ ] Integration tests with mocked LinkedIn API
   - [ ] Update configuration documentation

3. **Week 3:**
   - [ ] Frontend state badges on post cards
   - [ ] Error details display
   - [ ] Retry button implementation
   - [ ] E2E tests

4. **Week 4:**
   - [ ] Admin dashboard
   - [ ] Monitoring and metrics
   - [ ] Performance testing
   - [ ] Production deployment checklist

---

## Related Documentation

- [PERSONA_TEAM_SPEC.md](./PERSONA_TEAM_SPEC.md) - Complete feature specification
- [OAUTH_ARCHITECTURE_AND_PATTERNS.md](./OAUTH_ARCHITECTURE_AND_PATTERNS.md) - Token management
- [SOCIAL_MEDIA_INTEGRATION.md](./SOCIAL_MEDIA_INTEGRATION.md) - Platform APIs
- [backend/alembic/README.md](../backend/app/alembic/README.md) - Database schema

---

**Version:** 1.0  
**Last Updated:** March 11, 2026  
**Maintained By:** Tech Lead
