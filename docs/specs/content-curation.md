# Spec: Content Curation Agent

> **Status:** 🔲 Outline — needs discussion
> **Depends on:** [ai-stack](./ai-stack.md), [brand-voice](./brand-voice.md), [trending-topics](./trending-topics.md)
> **Depended on by:** [post-lifecycle](./post-lifecycle.md)

## Problem

The core value proposition of LinkX is automating the blank page problem. We need a daily automated pipeline that takes trending topics, filters them for a Brand, and generates draft posts for human review.

## Questions to Discuss

### Agent Trigger
- [ ] How is the daily curation triggered? (Cron job via Scheduler Service? Or on-demand via UI button "Curate Today"?)
- [ ] How many drafts should it generate per day per Brand? (Configurable?)

### The LangGraph Workflow
- [ ] Step 1: Fetch relevant trending topics for the Brand.
- [ ] Step 2: Ideation — agent proposes 3-5 post angles based on trends.
- [ ] Step 3: Drafting — agent writes the full post content using the Brand Voice.
- [ ] Step 4: Formatting — agent adapts the draft for the specific platform (e.g., thread for X, long-form for LinkedIn).
- [ ] Step 5: Pause — save to DB as `status='draft'`, wait for human review.

### Human-in-the-Loop
- [ ] How does the user interact with the draft? (Accept as-is, edit manually, or "chat to refine"?)
- [ ] If the user says "Make this funnier", does it go back through the LangGraph workflow, or is it a separate lightweight chat interaction?

## Topics to Spec Out

1. LangGraph node definitions and state schema
2. Prompts for Ideation, Drafting, and Formatting
3. Database integration (saving agent outputs as `Post` rows)
4. Integration with existing `PromptDraftStudio` UI for refinement chat
