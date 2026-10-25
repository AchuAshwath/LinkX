# Browser memory console diagnostics

Developer-only troubleshooting for a local browser-reading session. Use this only when you intend to inspect the selected tab's captured text.

Open the chat page, start sharing, then open the browser developer console:

    window.browserReadingDebug.enable()
    window.browserReadingDebug.snapshot()
    window.browserReadingDebug.disable()

Enabling without options logs metadata on each session update. Metadata includes state, chat/thread identifiers, selected model, queue/gap counts, capacity state, and the most recent applicable input-budget estimate. Treat those identifiers and model details as development diagnostics.

To include the actual browser notes and compacted summary in console log output, opt in explicitly:

    window.browserReadingDebug.enable({ content: true })

The snapshot method returns a detached in-memory snapshot that includes the current notes and summary regardless of whether content logging is enabled. Do not paste or share snapshot output unless the page content is appropriate to disclose. The diagnostic API does not return pending screenshot bytes.

Disable logging when finished:

    window.browserReadingDebug.disable()

Disabling stops subsequent console output; it does not clear browser memory or erase entries already written to the console. Stop sharing or end the session to clear the feature's in-memory context. This tool does not create a separate event archive.

## Fields

- State and ownership: session state, owner chat, active thread, draft nonce, and selected model.
- Queue: pending-frame count, gap count, and whether capture reached its capacity.
- Budget: selected model ID, configured input capacity, input limit after output reservation, estimated input tokens, and retained/omitted history-message counts. It is null until a question produces a matching diagnostic. It is an estimate for that evaluation, not provider-reported billing usage or a continuously refreshed count.
- Memory: serialized UTF-8 bytes used, the 32 KiB maximum, notes, and summary. The notes and summary contain captured page content.

The 32 KiB memory limit is a fixed bounded research buffer, not a dynamic percentage of the selected model's context window. Before evaluation, the server fits recent whole conversation turns around the protected question and browser memory using the configured model capacity and an output reserve. Configured capacity and token estimates can be wrong if the provider alias is misconfigured.

## Troubleshooting interpretation

Capture gaps and capacity state describe known omissions; they do not prove that all visible content was captured. Notes and summaries are lossy and can omit or misread text. The budget fields describe the latest matching evaluation only. Browser notes remain separate from the saved transcript; ordinary chat questions and answers continue to use normal transcript persistence.
