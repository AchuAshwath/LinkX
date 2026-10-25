import { describe, expect, it } from "vitest"
import type { ChatUIMessage } from "@/components/Chat/types"
import {
  attachBrowserActivity,
  parseBrowserActivityEvent,
  retainBrowserActivities,
  updateBrowserActivity,
} from "../activity"

function turn() {
  return {
    userMsg: {
      id: "local-user",
      role: "user",
      parts: [{ type: "text", text: "Question" }],
    } as ChatUIMessage,
    assistantMsg: {
      id: "local-assistant",
      role: "assistant",
      parts: [],
    } as ChatUIMessage,
  }
}

describe("browser activity display metadata", () => {
  it("bounds extracted previews by Unicode code point and preserves shortened state", () => {
    const event = parseBrowserActivityEvent({
      state: "reading",
      message: "Reading shared view.",
      tool_id: "frame-a",
      tool_state: "completed",
      note_preview: `${"🧭".repeat(600)}extra`,
      preview_truncated: false,
    })
    expect(event?.note_preview).toBe(`${"🧭".repeat(599)}…`)
    expect(event?.preview_truncated).toBe(true)
  })

  it("accepts bounded failure text and rejects oversized failure fields", () => {
    const valid = parseBrowserActivityEvent({
      state: "reading",
      message: "Reading shared view.",
      tool_id: "frame-a",
      tool_state: "failed",
      failure_code: "output_truncated",
      failure_message: "The model response was truncated.",
    })
    const invalid = parseBrowserActivityEvent({
      state: "reading",
      message: "Reading shared view.",
      tool_id: "frame-b",
      tool_state: "failed",
      failure_code: "x".repeat(65),
      failure_message: "x".repeat(201),
    })

    expect(valid?.failure_code).toBe("output_truncated")
    expect(valid?.failure_message).toBe("The model response was truncated.")
    expect(invalid?.failure_code).toBeUndefined()
    expect(invalid?.failure_message).toBeUndefined()
  })

  it("keeps warnings and steps outside answer parts and retains them after a server refresh", () => {
    const question = { operation_id: "00000000-0000-4000-8000-000000000123" }
    const local = attachBrowserActivity({ turn: turn(), question })
    const checking = updateBrowserActivity({
      activity: local.assistantMsg.browserActivity,
      event: { state: "checking", message: "Checking browser context…" },
    })
    const warning = updateBrowserActivity({
      activity: checking,
      event: {
        state: "incomplete",
        message: "Some shared views could not be captured or read.",
      },
    })
    local.assistantMsg.browserActivity = warning
    const server: ChatUIMessage = {
      id: "turn_00000000000040008000000000000123_assistant",
      role: "assistant",
      parts: [{ type: "text", text: "The badge is P2R7." }],
    }
    const refreshed = retainBrowserActivities({
      current: [local.assistantMsg],
      messages: [server],
    })
    expect(refreshed[0].parts).toEqual(server.parts)
    expect(refreshed[0].browserActivity?.warning).toBe(
      "Some shared views could not be captured or read.",
    )
    expect(
      refreshed[0].browserActivity?.steps.map((step) => step.state),
    ).toEqual(["waiting", "checking"])
    expect(local.userMsg.id).toBe("local-user")
    expect(local.assistantMsg.id).toBe("local-assistant")
    expect(server.browserActivity).toBeUndefined()
  })

  it("does not add browser metadata to an ordinary turn", () => {
    const ordinary = turn()
    expect(attachBrowserActivity({ turn: ordinary })).toBe(ordinary)
    expect(ordinary.assistantMsg.browserActivity).toBeUndefined()
  })

  it("updates a read tool by id as it moves from running to completion", () => {
    const running = updateBrowserActivity({
      event: {
        state: "reading",
        message: "Reading shared view.",
        tool_id: "frame-a",
        tool_state: "running",
        view_index: 1,
        view_count: 2,
      },
    })
    const completed = updateBrowserActivity({
      activity: running,
      event: {
        state: "reading",
        message: "Reading shared view.",
        tool_id: "frame-a",
        tool_state: "completed",
        view_index: 1,
        view_count: 2,
        note_chars: 123,
        note_preview: "A product page with its price and details.",
        preview_truncated: true,
        duration_ms: 48,
      },
    })
    expect(completed.tools).toEqual([
      {
        id: "frame-a",
        name: "read_shared_view",
        state: "completed",
        input: { view_index: 1, view_count: 2 },
        output: {
          note_chars: 123,
          note_preview: "A product page with its price and details.",
          preview_truncated: true,
        },
        durationMs: 48,
      },
    ])
    expect(completed.steps).toEqual([])
  })

  it("stores the safe failure message with the later activity warning", () => {
    const failed = updateBrowserActivity({
      event: {
        state: "reading",
        message: "Reading shared view.",
        tool_id: "frame-a",
        tool_state: "failed",
        failure_code: "output_truncated",
        failure_message: "The model response was truncated.",
      },
    })
    const withWarning = updateBrowserActivity({
      activity: failed,
      event: {
        state: "incomplete",
        message: "A shared view could not be read.",
      },
    })

    expect(withWarning.tools?.[0].output).toEqual({
      failure_message: "The model response was truncated.",
    })
    expect(withWarning.warning).toBe("A shared view could not be read.")
  })

  it("keeps an incomplete warning when there is no failed read tool", () => {
    const activity = updateBrowserActivity({
      event: {
        state: "incomplete",
        message: "Some shared views could not be captured or read.",
      },
    })

    expect(activity.warning).toBe(
      "Some shared views could not be captured or read.",
    )
  })

  it("bounds oversized direct completion events in display metadata", () => {
    const activity = updateBrowserActivity({
      event: {
        state: "reading",
        message: "Reading shared view.",
        tool_id: "frame-a",
        tool_state: "completed",
        note_preview: `${"🧭".repeat(601)}`,
      },
    })
    const output = activity.tools?.[0].output
    expect(Array.from(output?.note_preview as string)).toHaveLength(600)
    expect(output?.note_preview).toBe(`${"🧭".repeat(599)}…`)
    expect(output?.preview_truncated).toBe(true)
  })

  it("does not invent a completed read when the tool outcome is missing", () => {
    const activity = updateBrowserActivity({
      event: {
        state: "reading",
        message: "Reading shared view.",
        tool_id: "frame-a",
      },
    })
    expect(activity.tools).toBeUndefined()
  })
})
