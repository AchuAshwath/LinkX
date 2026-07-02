# Spec: Post Lifecycle & Workflow

> **Status:** 🔲 Outline — needs discussion
> **Depends on:** [scheduler](./scheduler.md), [content-curation](./content-curation.md)
> **Depended on by:** None

## Problem

Users need a clear UI and backend state machine to manage posts from draft, through review/approval, to scheduled, and finally published or failed. The UI needs to present this clearly (Inbox vs Calendar).

## Context

The backend currently enforces this state machine:
`draft → scheduled → publishing → published` (or `failed`)
Teams have roles: `member` (can draft), `admin`/`owner` (can schedule/publish).

## Questions to Discuss

### UI Layout: Inbox vs Calendar
- [ ] Should we have a dedicated "Draft Inbox" view where AI-generated drafts land for review?
- [ ] How does the Calendar view work? (Drag and drop to reschedule?)
- [ ] How do we display cross-platform posts? (e.g., one logical post going to LinkedIn and X at the same time)

### Team Workflows
- [ ] Do we need a formal "Needs Approval" state, or is `draft` sufficient if only admins can transition it to `scheduled`?
- [ ] Notifications: should admins be notified when drafts are ready for review?

### Editing & Previews
- [ ] How accurate do the platform previews need to be in the UI?
- [ ] How do we handle image/media uploads in the UI and attach them to the post?

## Topics to Spec Out

1. API changes required for bulk approval/scheduling
2. Frontend Route/Component changes (Inbox view, Calendar view)
3. Cross-platform post grouping (handling 1 idea mapped to N platforms)
4. State machine refinements (if any)
