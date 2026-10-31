# Browser reading implementation contract

This document describes the integrated browser-reading feature and its current runtime boundaries. It is a product/engineering description, not a privacy-policy or terms-of-service determination.

## Data flow and ownership

The user explicitly starts sharing a browser tab. The client samples the shared video surface, encodes bounded JPEG frames, and sends accepted frames for sequential transcription. The resulting notes and their compacted summary live in volatile browser-reading memory owned by one chat. A question snapshots that context and sends it with the ordinary conversation text needed to answer.

The feature does not read page DOM or accessibility trees, and it does not control the selected tab. The current-view direct-image question path is disabled. Questions use captured images through the sequential read operation.

Browser screenshots, notes, summaries, receipts, and progress metadata are not written as chat-message parts. Normal user questions and final assistant answers use the existing durable chat transcript. The browser memory clears when sharing stops, on reload, sign-out, or session replacement. Ending capture rejects stale results from the retained session. An already dispatched question continues using its frozen request snapshot; closing its source or preview does not cancel that chat turn. The chat Stop control explicitly cancels the question, without promising that an already-running remote provider call can be canceled. A prepared question not yet dispatched is invalidated if sharing stops during preparation.

A replacement share may start while the previous submitted question finishes. Its accepted images queue until the original request releases the processing lane. Old question notes do not repopulate cleared or replacement memory. Physical read/compaction cleanup releases its local blocker only after authoritative transport completion, a definite rejection, or confirmed server settlement. Metadata reconciliation is retried with a bounded backoff; active or unknown status alone is not proof of completion.

Chat ownership scopes browser context and model preference. A question freezes the already accepted pending-frame batch at Send time. It may use relevant conversation context and general knowledge while sharing. Browser-grounded answers require available browser evidence; model-declared evidence basis and valid evidence IDs are structural checks, not proof that every statement is factually grounded.

## API and persistence behavior

Authenticated read and compaction operations use POST endpoints under /api/v1/ai/observation. Operation status and cancellation metadata are owner-scoped. Browser questions use the dedicated POST endpoint /api/v1/ai/threads/{id}/browser-chat so its request body can be capped independently of ordinary chat image attachments.

The browser-question stream emits transient browser status, note, and receipt events alongside normal text and terminal events. A receipt accounts for each frozen pending frame as completed, failed, or unused. Browser events do not become transcript parts. The completed assistant answer is saved once before answer text is emitted. A completed request replay returns its saved answer; an unfinished duplicate does not automatically run inference again. Provider calls have no automatic retry or fallback.

## Capture, memory, and request bounds

- The capture encoder limits output to a 2048-pixel longest edge and 4,194,304 pixels. Source frames are capped at 8,388,608 pixels before encoding.
- Each JPEG data URL is limited to 2,000,000 characters. The dedicated browser-question request has an 8 MiB pre-parse body limit.
- The queue admits at most two pending frames alongside the active read. Capacity failures are reported as gaps; they do not silently replace accepted frames.
- Frames older than five minutes are discarded. A sharing session stops admitting work after 30 minutes or 200 accepted jobs; retained context can still be used for questions during the session.
- Serialized browser summary plus notes are limited to 32 KiB of UTF-8. This is a fixed research bound, not an automatically allocated percentage of each model's context window. Compaction is versioned and preserves recent notes; if protected memory cannot fit, the request fails explicitly rather than silently dropping it.
- A note is limited to 8,000 characters and a compacted summary to 8,192 characters. These field limits do not replace the serialized 32 KiB memory limit.
- An individual model operation has a 45-second deadline. Each question evaluates against its frozen context and reads pending frames sequentially as needed; supported answers may finish early, while broad questions settle the accepted batch.
- Browser tasks use a process-local coordination gate. The backend deployment must use one application process for this feature's ownership guarantees; multi-worker distributed coordination and crash-safe resumption are not provided.

The selected model's configured input capacity is checked before inference, with output and structured-schema overhead reserved. This depends on correct provider/model configuration and a tokenizer estimate. Unknown capacity is an explicit error. The feature does not silently switch models, retry provider calls, or downgrade structured output.

## Answers, errors, and visible activity

The evaluator can answer, wait for more browser evidence, or report insufficient evidence. It must declare whether support comes from browser notes, conversation, general knowledge, or a combination. Browser and mixed answers must reference valid supplied evidence or an available summary. These contracts limit unsupported paths but cannot guarantee factual accuracy.

Preparation and image-reading operations appear as transient activity in the chat. Completed reads may show a bounded excerpt of the actual transcription as plain text; the full note remains in volatile browser memory. Failures use fixed safe categories/messages and do not turn into fabricated assistant answers. The answer is persisted before it is emitted as the completed response.

The transcript follows new content while the reader remains at the end. Upward navigation pauses following; reaching the end, using Scroll to end, or moving forward at the end resumes it. Switching chats initializes the destination at its latest message.

## Known limits

Browser questions currently use a non-streamed structured evaluator and emit the final answer as one text chunk. They do not use the ordinary chat answer/tool stream or forward provider reasoning output. Integration into the normal response pipeline is deferred to [issue #189](https://github.com/AchuAshwath/LinkX/issues/189); the architecture comparison is documented in [the streaming research note](../research/browser-context-streaming-integration-2026-10-31.md). The capture-close lifecycle correction is tracked in [issue #190](https://github.com/AchuAshwath/LinkX/issues/190).

Descriptions and compaction are lossy model outputs. Dense or small text, page changes between captures, attribution, tables, charts, and diagrams can be missed or misread. The reader cannot know a future question while capturing and does not guarantee exhaustive page coverage. A manual test of the current feature does not establish accuracy on every page or model.

The validation record is summarized in [STACK-REVIEW.md](STACK-REVIEW.md) and [validation-summary.json](validation-summary.json). Those checks do not establish legal or terms-of-service compliance, cross-browser support, multi-worker safety, or correctness on the user's every page.
