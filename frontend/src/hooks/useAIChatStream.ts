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

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split("\n")
          buffer = lines.pop() || ""

          let currentEvent = "message"
          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed) continue

            if (trimmed.startsWith("event:")) {
              currentEvent = trimmed.slice(6).trim()
            } else if (trimmed.startsWith("data:")) {
              const dataStr = trimmed.slice(5).trim()
              try {
                const parsed = JSON.parse(dataStr)

                if (currentEvent === "thought" && handlers.onThought) {
                  handlers.onThought(parsed.content || "")
                } else if (
                  currentEvent === "text_delta" &&
                  handlers.onTextDelta
                ) {
                  handlers.onTextDelta(parsed.content || "")
                } else if (
                  currentEvent === "tool_start" &&
                  handlers.onToolStart
                ) {
                  handlers.onToolStart(parsed.name, parsed.input)
                } else if (
                  currentEvent === "tool_output" &&
                  handlers.onToolOutput
                ) {
                  handlers.onToolOutput(parsed.name, parsed.output)
                } else if (
                  currentEvent === "draft_artifact" &&
                  handlers.onDraftArtifact
                ) {
                  handlers.onDraftArtifact(parsed)
                } else if (currentEvent === "done" && handlers.onDone) {
                  handlers.onDone()
                } else if (currentEvent === "error" && handlers.onError) {
                  handlers.onError(parsed.message || "Unknown stream error")
                }
              } catch {
                // If not JSON, ignore or pass as raw text
              }
            }
          }
        }

        handlers.onDone?.()
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") {
          // Stream cancelled by user
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
