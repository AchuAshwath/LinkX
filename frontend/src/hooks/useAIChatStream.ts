import * as React from "react"
import type { DraftArtifact } from "@/components/Chat/types"

export interface StreamEventHandlers {
  onThought?: (content: string) => void
  onTextDelta?: (text: string) => void
  onToolStart?: (name: string, input: unknown) => void
  onToolOutput?: (name: string, output: unknown) => void
  onDraftArtifact?: (artifact: DraftArtifact) => void
  onDone?: () => void
  onError?: (error: string) => void
}

interface ParsedEventData {
  content?: string
  name?: string
  input?: unknown
  output?: unknown
  post_id?: string
  platform?: string
  message?: string
}

type EventAction = (
  data: ParsedEventData,
  handlers: StreamEventHandlers,
) => void

const EVENT_ACTIONS: Record<string, EventAction> = {
  thought: (d, h) => h.onThought?.(d.content || ""),
  text_delta: (d, h) => h.onTextDelta?.(d.content || ""),
  tool_start: (d, h) => d.name && h.onToolStart?.(d.name, d.input),
  tool_output: (d, h) => d.name && h.onToolOutput?.(d.name, d.output),
  draft_artifact: (d, h) => h.onDraftArtifact?.(d as unknown as DraftArtifact),
  done: (_, h) => h.onDone?.(),
  error: (d, h) => h.onError?.(d.message || "Unknown stream error"),
}

function parseSSELines(
  lines: string[],
  currentEvent: string,
  handlers: StreamEventHandlers,
): string {
  let eventType = currentEvent
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    if (trimmed.startsWith("event:")) {
      eventType = trimmed.slice(6).trim()
    } else if (trimmed.startsWith("data:")) {
      try {
        const parsed = JSON.parse(trimmed.slice(5).trim()) as ParsedEventData
        EVENT_ACTIONS[eventType]?.(parsed, handlers)
      } catch {
        // Non-JSON payload ignored
      }
    }
  }
  return eventType
}

async function readStreamChunks(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  handlers: StreamEventHandlers,
) {
  const decoder = new TextDecoder()
  let buffer = ""
  let currentEvent = "message"

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop() || ""
    currentEvent = parseSSELines(lines, currentEvent, handlers)
  }
}

async function streamResponse(
  response: Response,
  handlers: StreamEventHandlers,
) {
  if (!response.ok) {
    const err = await response.text()
    throw new Error(err || `HTTP ${response.status}`)
  }
  if (!response.body) {
    throw new Error("Missing stream response body")
  }

  await readStreamChunks(response.body.getReader(), handlers)
  handlers.onDone?.()
}

function getAuthToken(): string {
  if (typeof window !== "undefined" && typeof localStorage !== "undefined") {
    return localStorage.getItem("access_token") || ""
  }
  return ""
}

async function executeChatStreamRequest({
  threadId,
  message,
  handlers,
  model,
  images,
  signal,
}: {
  threadId: string
  message: string
  handlers: StreamEventHandlers
  model?: string
  images?: string[]
  signal: AbortSignal
}) {
  const token = getAuthToken()
  const response = await fetch(`/api/v1/ai/threads/${threadId}/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ message, model, images }),
    signal,
  })

  await streamResponse(response, handlers)
}

export function useAIChatStream() {
  const [isStreaming, setIsStreaming] = React.useState(false)
  const abortControllerRef = React.useRef<AbortController | null>(null)

  const stop = React.useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    setIsStreaming(false)
  }, [])

  const startStream = React.useCallback(
    async (
      threadId: string,
      message: string,
      handlers: StreamEventHandlers = {},
      model?: string,
      images?: string[],
    ) => {
      stop()
      const controller = new AbortController()
      abortControllerRef.current = controller
      setIsStreaming(true)

      try {
        await executeChatStreamRequest({
          threadId,
          message,
          handlers,
          model,
          images,
          signal: controller.signal,
        })
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") {
          return
        }
        const errMsg = err instanceof Error ? err.message : "Streaming failed"
        handlers.onError?.(errMsg)
      } finally {
        setIsStreaming(false)
        abortControllerRef.current = null
      }
    },
    [stop],
  )

  return {
    isStreaming,
    startStream,
    stop,
  }
}
