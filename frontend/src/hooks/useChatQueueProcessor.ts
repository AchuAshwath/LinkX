import type { useQueryClient } from "@tanstack/react-query"
import * as React from "react"
import type { ChatUIMessage, QueuedTurn } from "@/components/Chat/types"
import type {
  StreamEventHandlers,
  useAIChatStream,
} from "@/hooks/useAIChatStream"
import { buildStreamHandlers } from "@/hooks/useChatTurnSender"
import { connectBrowserQuestion } from "@/observation/reading/questionStream"
import type { BrowserReadingSession } from "@/observation/reading/session"

interface QueueProcessorOptions {
  turnQueueRef: React.MutableRefObject<QueuedTurn[]>
  dequeueTurn: () => QueuedTurn | undefined
  setMessagesByThread: React.Dispatch<
    React.SetStateAction<Record<string, ChatUIMessage[]>>
  >
  queryClient: ReturnType<typeof useQueryClient>
  startStream: ReturnType<typeof useAIChatStream>["startStream"]
  browserReading?: BrowserReadingSession
}

export function useQueueProcessor(options: QueueProcessorOptions) {
  const {
    turnQueueRef,
    dequeueTurn,
    setMessagesByThread,
    queryClient,
    startStream,
    browserReading,
  } = options
  const isProcessingQueueRef = React.useRef(false)

  const processQueue = React.useCallback(async () => {
    if (isProcessingQueueRef.current) return
    if (turnQueueRef.current.length === 0) return

    isProcessingQueueRef.current = true
    const nextTurn = dequeueTurn()
    if (!nextTurn) {
      isProcessingQueueRef.current = false
      return
    }

    markStreaming(options, nextTurn)

    const handlers: StreamEventHandlers = buildStreamHandlers({
      assistantMsgId: nextTurn.assistantMsgId,
      targetThreadId: nextTurn.threadId,
      setMessagesByThread,
      queryClient,
    })
    const delivery = connectBrowserQuestion({
      turn: nextTurn,
      session: browserReading,
      handlers,
    })

    try {
      if (!delivery.canDispatch()) {
        handlers.onError?.(
          "Browser reading stopped before this question was sent.",
        )
      } else {
        await startStream({
          threadId: nextTurn.threadId,
          message: nextTurn.promptText,
          handlers,
          model: nextTurn.selectedModelId,
          images: queuedImages(nextTurn),
          editMessageId: nextTurn.editMessageId,
          observation: nextTurn.observation,
          browserQuestion: nextTurn.browserQuestion,
        })
      }
    } finally {
      delivery.finish()
      isProcessingQueueRef.current = false
      if (turnQueueRef.current.length > 0) {
        setTimeout(() => {
          processQueue()
        }, 0)
      }
    }
  }, [
    dequeueTurn,
    queryClient,
    startStream,
    turnQueueRef,
    setMessagesByThread,
    browserReading,
    options,
  ])

  return processQueue
}

function queuedImages(turn: QueuedTurn): string[] | undefined {
  if (!turn.base64Images?.length) return undefined
  return turn.base64Images
}

function markStreaming(
  options: QueueProcessorOptions,
  nextTurn: QueuedTurn,
): void {
  options.setMessagesByThread((prev) => {
    const msgs = prev[nextTurn.threadId] ?? []
    return {
      ...prev,
      [nextTurn.threadId]: msgs.map((m) =>
        m.id === nextTurn.assistantMsgId ? { ...m, status: "streaming" } : m,
      ),
    }
  })
}
