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

function dispatchSSEEvent(
  eventName: string,
  data: ParsedEventData,
  handlers: StreamEventHandlers,
) {
  switch (eventName) {
    case "thought":
      handlers.onThought?.(data.content || "")
      break
    case "text_delta":
      handlers.onTextDelta?.(data.content || "")
      break
    case "tool_start":
      if (data.name) handlers.onToolStart?.(data.name, data.input)
      break
    case "tool_output":
      if (data.name) handlers.onToolOutput?.(data.name, data.output)
      break
    case "draft_artifact":
      handlers.onDraftArtifact?.(data as unknown as DraftArtifact)
      break
    case "done":
      handlers.onDone?.()
      break
    case "error":
      handlers.onError?.(data.message || "Unknown stream error")
      break
  }
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
      const dataStr = trimmed.slice(5).trim()
      try {
        const parsed = JSON.parse(dataStr) as ParsedEventData
        dispatchSSEEvent(eventType, parsed, handlers)
      } catch {
        // Non-JSON SSE payload ignored
      }
    }
  }
  return eventType
}

async function streamResponse(
  response: Response,
  handlers: StreamEventHandlers,
) {
  if (!response.ok) {
    const errText = await response.text()
    throw new Error(errText || `Server error: ${response.status}`)
  }
  if (!response.body) {
    throw new Error("No response body received from stream")
  }

  const reader = response.body.getReader()
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

  handlers.onDone?.()
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
    ) => {
      stop()
      const controller = new AbortController()
      abortControllerRef.current = controller
      setIsStreaming(true)

      const token = localStorage.getItem("access_token") || ""

      try {
        const response = await fetch(`/api/v1/ai/threads/${threadId}/chat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ message }),
          signal: controller.signal,
        })

        await streamResponse(response, handlers)
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
