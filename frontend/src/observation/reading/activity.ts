import type { BrowserActivity, ChatUIMessage } from "@/components/Chat/types"
import type { BrowserActivityEvent, PreparedBrowserQuestion } from "./types"

const MAX_STEPS = 8
const MAX_NOTE_PREVIEW_CODE_POINTS = 600

function readNotePreview(value: unknown) {
  if (typeof value !== "string") return undefined
  const points = Array.from(value)
  return points.length <= MAX_NOTE_PREVIEW_CODE_POINTS
    ? value
    : `${points.slice(0, MAX_NOTE_PREVIEW_CODE_POINTS - 1).join("")}…`
}

function readPreviewTruncated(data: {
  note_preview?: unknown
  preview_truncated?: unknown
}) {
  const wasReported = typeof data.preview_truncated === "boolean"
  const isOverLimit =
    typeof data.note_preview === "string" &&
    Array.from(data.note_preview).length > MAX_NOTE_PREVIEW_CODE_POINTS
  if (!wasReported && !isOverLimit) return undefined
  return data.preview_truncated === true || isOverLimit
}

function validPositiveInteger(value: number | undefined): value is number {
  return value !== undefined && Number.isSafeInteger(value) && value > 0
}

function validNonNegativeFinite(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value >= 0
}

function readPositiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && validPositiveInteger(value)
    ? value
    : undefined
}

function readNonNegativeFinite(value: unknown): number | undefined {
  return typeof value === "number" && validNonNegativeFinite(value)
    ? value
    : undefined
}

function readToolState(value: unknown): BrowserActivityEvent["tool_state"] {
  if (value === "running" || value === "completed" || value === "failed")
    return value
  return undefined
}

function readToolId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  return value.trim() ? value : undefined
}

function readBoundedText(
  value: unknown,
  maxLength: number,
): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined
  return value.length <= maxLength ? value : undefined
}

function addOptionalToolFields(
  event: BrowserActivityEvent,
  data: {
    tool_id?: unknown
    tool_state?: unknown
    view_index?: unknown
    view_count?: unknown
    note_chars?: unknown
    note_preview?: unknown
    preview_truncated?: unknown
    duration_ms?: unknown
    failure_code?: unknown
    failure_message?: unknown
  },
) {
  const fields = {
    tool_id: readToolId(data.tool_id),
    tool_state: readToolState(data.tool_state),
    view_index: readPositiveInteger(data.view_index),
    view_count: readPositiveInteger(data.view_count),
    note_chars: readNonNegativeFinite(data.note_chars),
    note_preview: readNotePreview(data.note_preview),
    preview_truncated: readPreviewTruncated(data),
    duration_ms: readNonNegativeFinite(data.duration_ms),
    failure_code: readBoundedText(data.failure_code, 64),
    failure_message: readBoundedText(data.failure_message, 200),
  }
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) Object.assign(event, { [key]: value })
  }
}

export function parseBrowserActivityEvent(data: {
  state?: unknown
  message?: unknown
  tool_id?: unknown
  tool_state?: unknown
  view_index?: unknown
  view_count?: unknown
  note_chars?: unknown
  note_preview?: unknown
  preview_truncated?: unknown
  duration_ms?: unknown
  failure_code?: unknown
  failure_message?: unknown
}): BrowserActivityEvent | undefined {
  const state = data.state
  if (state !== "checking" && state !== "reading" && state !== "incomplete")
    return undefined
  if (typeof data.message !== "string") return undefined
  const event: BrowserActivityEvent = {
    state,
    message: data.message.slice(0, 500),
  }
  addOptionalToolFields(event, data)
  return event
}

function createReadOutput(event: BrowserActivityEvent) {
  if (event.tool_state === "failed") {
    return event.failure_message
      ? { failure_message: event.failure_message }
      : undefined
  }
  const notePreview = readNotePreview(event.note_preview)
  const values = {
    note_chars: event.note_chars,
    note_preview: notePreview,
    preview_truncated:
      notePreview === undefined
        ? undefined
        : (readPreviewTruncated(event) ?? false),
  }
  const output = Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined),
  )
  return Object.keys(output).length > 0 ? output : undefined
}

function createReadTool(event: BrowserActivityEvent) {
  if (event.state !== "reading") return undefined
  if (!event.tool_id || !event.tool_state) return undefined
  return {
    id: event.tool_id,
    name: "read_shared_view",
    state: event.tool_state,
    input: {
      view_index: event.view_index,
      view_count: event.view_count,
    },
    output: createReadOutput(event),
    durationMs: event.duration_ms,
  } as const
}

function updateReadTools(
  current: BrowserActivity,
  event: BrowserActivityEvent,
): BrowserActivity | undefined {
  const next = createReadTool(event)
  if (!next) return undefined
  const tools = current.tools ?? []
  const existing = tools.findIndex((tool) => tool.id === next.id)
  return {
    ...current,
    tools:
      existing < 0
        ? [...tools, next]
        : tools.map((tool, index) => (index === existing ? next : tool)),
  }
}

function sameStep(
  latest: BrowserActivity["steps"][number] | undefined,
  event: BrowserActivityEvent,
) {
  return latest?.state === event.state && latest.message === event.message
}

export function attachBrowserActivity({
  turn,
  question,
}: {
  turn: { userMsg: ChatUIMessage; assistantMsg: ChatUIMessage }
  question?: Pick<PreparedBrowserQuestion, "operation_id">
}) {
  if (!question) return turn
  return {
    userMsg: turn.userMsg,
    assistantMsg: {
      ...turn.assistantMsg,
      browserActivity: {
        requestId: question.operation_id,
        steps: [
          { state: "waiting" as const, message: "Preparing browser context…" },
        ],
        warning: null,
      },
    },
  }
}

export function updateBrowserActivity({
  activity,
  event,
}: {
  activity?: BrowserActivity
  event: BrowserActivityEvent
}): BrowserActivity {
  const current = activity ?? { steps: [], warning: null }
  if (event.state === "incomplete")
    return { ...current, warning: event.message }
  const updatedTools = updateReadTools(current, event)
  if (updatedTools) return updatedTools
  const latest = current.steps[current.steps.length - 1]
  if (sameStep(latest, event)) return current
  return {
    ...current,
    steps: [
      ...current.steps,
      { state: event.state, message: event.message },
    ].slice(-MAX_STEPS),
  }
}

export function retainBrowserActivities({
  current,
  messages,
}: {
  current: ChatUIMessage[]
  messages: ChatUIMessage[]
}): ChatUIMessage[] {
  const activities = new Map<string, BrowserActivity>()
  for (const message of current) {
    const activity = message.browserActivity
    if (!activity) continue
    activities.set(message.id, activity)
    if (activity.requestId)
      activities.set(
        `turn_${activity.requestId.replace(/-/g, "")}_assistant`,
        activity,
      )
  }
  return messages.map((message) => {
    const activity = activities.get(message.id)
    return activity ? { ...message, browserActivity: activity } : message
  })
}
