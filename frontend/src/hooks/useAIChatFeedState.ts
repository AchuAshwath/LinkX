import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import * as React from "react"
import { AiThreadsService, type ChatThreadPublic } from "@/client"
import type {
  AskUserAnswer,
  AskUserToolPart,
  ChatUIMessage,
  QueuedTurn,
} from "@/components/Chat/types"
import { useAIChatStream } from "@/hooks/useAIChatStream"
import {
  buildStreamHandlers,
  useChatTurnSender,
} from "@/hooks/useChatTurnSender"

function useThreadTranscript({
  activeThreadId,
  streamingThreadId,
  queuedThreadIds,
  setMessagesByThread,
}: {
  activeThreadId: string | null
  streamingThreadId: string | null
  queuedThreadIds: string[]
  setMessagesByThread: React.Dispatch<
    React.SetStateAction<Record<string, ChatUIMessage[]>>
  >
}) {
  const { data: activeThreadDetail } = useQuery({
    queryKey: ["ai-thread", activeThreadId],
    queryFn: () => AiThreadsService.getChatThread({ id: activeThreadId! }),
    enabled: Boolean(activeThreadId),
  })

  React.useEffect(() => {
    if (!activeThreadId) return
    if (activeThreadId === streamingThreadId) return
    if (queuedThreadIds.includes(activeThreadId)) return

    const transcriptMessages =
      (activeThreadDetail?.transcript as { messages?: ChatUIMessage[] })
        ?.messages || null

    if (!transcriptMessages) return

    setMessagesByThread((prev) => {
      const current = prev[activeThreadId] ?? []
      const hasOptimistic = current.some(
        (m) => m.id.startsWith("local_") || m.status === "queued",
      )
      if (hasOptimistic && transcriptMessages.length === 0) {
        return prev
      }
      return {
        ...prev,
        [activeThreadId]:
          transcriptMessages.length >= current.length
            ? transcriptMessages
            : current,
      }
    })
  }, [
    activeThreadDetail,
    activeThreadId,
    streamingThreadId,
    queuedThreadIds,
    setMessagesByThread,
  ])
}

function useThreadDrafts() {
  const [threadDrafts, setThreadDrafts] = React.useState<
    Record<string, string>
  >({})

  const setThreadDraft = React.useCallback(
    (threadId: string | null, text: string) => {
      const key = threadId ?? "new-chat"
      setThreadDrafts((prev) => ({ ...prev, [key]: text }))
    },
    [],
  )

  const clearThreadDraft = React.useCallback((threadId: string | null) => {
    const key = threadId ?? "new-chat"
    setThreadDrafts((prev) => {
      if (!(key in prev)) return prev
      const copy = { ...prev }
      delete copy[key]
      return copy
    })
  }, [])

  return { threadDrafts, setThreadDraft, clearThreadDraft }
}

function useInitialActiveThread(
  threads: ChatThreadPublic[],
  initialThreadId: string | undefined,
  setActiveThreadId: (id: string) => void,
) {
  const initialLoadedRef = React.useRef(false)
  React.useEffect(() => {
    if (initialThreadId) {
      setActiveThreadId(initialThreadId)
      initialLoadedRef.current = true
      return
    }
    if (threads.length > 0 && !initialLoadedRef.current) {
      setActiveThreadId(threads[0].id)
      initialLoadedRef.current = true
    }
  }, [threads, initialThreadId, setActiveThreadId])
}

function useCreateThreadMutation(
  queryClient: ReturnType<typeof useQueryClient>,
  setActiveThreadId: (id: string) => void,
) {
  return useMutation({
    mutationFn: (prompt?: string) =>
      AiThreadsService.createChatThread({
        requestBody: { origin: "composer", prompt },
      }),
    onSuccess: (newThread) => {
      queryClient.invalidateQueries({ queryKey: ["ai-threads"] })
      setActiveThreadId(newThread.id)
    },
  })
}

export function useAIChatFeedState({
  threads,
  selectedModelId,
  initialThreadId,
}: {
  threads: ChatThreadPublic[]
  selectedModelId: string
  initialThreadId?: string
}) {
  const queryClient = useQueryClient()
  const {
    isStreaming,
    streamingThreadId,
    startStream,
    stop: stopStream,
  } = useAIChatStream()
  const { threadDrafts, setThreadDraft, clearThreadDraft } = useThreadDrafts()

  const [activeThreadId, setActiveThreadId] = React.useState<string | null>(
    initialThreadId ?? null,
  )
  const [messagesByThread, setMessagesByThread] = React.useState<
    Record<string, ChatUIMessage[]>
  >({})
  const [pendingQuestion, setPendingQuestion] =
    React.useState<AskUserToolPart | null>(null)

  const turnQueueRef = React.useRef<QueuedTurn[]>([])
  const [turnQueue, setTurnQueue] = React.useState<QueuedTurn[]>([])
  const isProcessingQueueRef = React.useRef(false)

  const queuedThreadIds = React.useMemo(
    () => turnQueue.map((t) => t.threadId),
    [turnQueue],
  )

  const isThreadStreaming = React.useCallback(
    (threadId: string | null) =>
      Boolean(threadId && streamingThreadId === threadId),
    [streamingThreadId],
  )

  const isThreadQueued = React.useCallback(
    (threadId: string | null) =>
      Boolean(threadId && queuedThreadIds.includes(threadId)),
    [queuedThreadIds],
  )

  const enqueueTurn = React.useCallback((turn: QueuedTurn) => {
    turnQueueRef.current = [...turnQueueRef.current, turn]
    setTurnQueue(turnQueueRef.current)
  }, [])

  const dequeueTurn = React.useCallback((): QueuedTurn | undefined => {
    const [next, ...rest] = turnQueueRef.current
    turnQueueRef.current = rest
    setTurnQueue(rest)
    return next
  }, [])

  const cancelQueuedTurn = React.useCallback(
    (threadId: string) => {
      const cancelled = turnQueueRef.current.filter(
        (t) => t.threadId === threadId,
      )
      turnQueueRef.current = turnQueueRef.current.filter(
        (t) => t.threadId !== threadId,
      )
      setTurnQueue(turnQueueRef.current)

      // Restore prompt text to draft if available
      if (cancelled.length > 0 && cancelled[0].promptText) {
        setThreadDraft(threadId, cancelled[0].promptText)
      }

      setMessagesByThread((prev) => {
        const msgs = prev[threadId] ?? []
        const cancelledAssistantIds = new Set(
          cancelled.map((c) => c.assistantMsgId),
        )
        const cancelledPrompts = new Set(cancelled.map((c) => c.promptText))
        const filtered = msgs.filter((m) => {
          if (cancelledAssistantIds.has(m.id)) return false
          if (
            m.role === "user" &&
            m.parts.some(
              (p) => p.type === "text" && cancelledPrompts.has(p.text),
            )
          ) {
            return false
          }
          return true
        })
        return { ...prev, [threadId]: filtered }
      })
    },
    [setThreadDraft],
  )

  const handleThreadDeleted = React.useCallback(
    (deletedId: string) => {
      if (streamingThreadId === deletedId) {
        stopStream(deletedId)
      }
      cancelQueuedTurn(deletedId)
      setMessagesByThread((prev) => {
        if (!(deletedId in prev)) return prev
        const copy = { ...prev }
        delete copy[deletedId]
        return copy
      })
    },
    [streamingThreadId, stopStream, cancelQueuedTurn],
  )

  const processQueue = React.useCallback(async () => {
    if (isProcessingQueueRef.current) return
    if (turnQueueRef.current.length === 0) return

    isProcessingQueueRef.current = true
    const nextTurn = dequeueTurn()
    if (!nextTurn) {
      isProcessingQueueRef.current = false
      return
    }

    setMessagesByThread((prev) => {
      const msgs = prev[nextTurn.threadId] ?? []
      return {
        ...prev,
        [nextTurn.threadId]: msgs.map((m) =>
          m.id === nextTurn.assistantMsgId ? { ...m, status: "streaming" } : m,
        ),
      }
    })

    const handlers = buildStreamHandlers({
      assistantMsgId: nextTurn.assistantMsgId,
      targetThreadId: nextTurn.threadId,
      setMessagesByThread,
      queryClient,
    })

    const imagesPayload =
      nextTurn.base64Images && nextTurn.base64Images.length > 0
        ? nextTurn.base64Images
        : undefined

    try {
      await startStream(
        nextTurn.threadId,
        nextTurn.promptText,
        handlers,
        nextTurn.selectedModelId,
        imagesPayload,
      )
    } finally {
      isProcessingQueueRef.current = false
      if (turnQueueRef.current.length > 0) {
        setTimeout(() => {
          processQueue()
        }, 0)
      }
    }
  }, [dequeueTurn, queryClient, startStream])

  useInitialActiveThread(threads, initialThreadId, setActiveThreadId)
  useThreadTranscript({
    activeThreadId,
    streamingThreadId,
    queuedThreadIds,
    setMessagesByThread,
  })

  const createThreadMutation = useCreateThreadMutation(
    queryClient,
    setActiveThreadId,
  )

  const handleSendMessage = useChatTurnSender({
    activeThreadId,
    selectedModelId,
    isStreaming,
    streamingThreadId,
    setActiveThreadId,
    setMessagesByThread,
    setPendingQuestion,
    clearThreadDraft,
    createThreadMutation,
    enqueueTurn,
    processQueue,
  })

  const handleQuestionAnswer = React.useCallback(
    (_toolCallId: string, answers: AskUserAnswer[]) => {
      const text = answers
        .map((a) => a.answer)
        .filter(Boolean)
        .join("; ")
      if (text) {
        handleSendMessage(text)
      }
    },
    [handleSendMessage],
  )

  const handleNewChat = React.useCallback(() => {
    setActiveThreadId(null)
    setMessagesByThread((prev) => ({ ...prev, "new-chat": [] }))
    setPendingQuestion(null)
  }, [])

  const handleStop = React.useCallback(() => {
    if (!activeThreadId) {
      stopStream()
      return
    }
    if (activeThreadId === streamingThreadId) {
      stopStream(activeThreadId)
    } else if (queuedThreadIds.includes(activeThreadId)) {
      cancelQueuedTurn(activeThreadId)
    } else {
      stopStream()
    }
  }, [
    activeThreadId,
    cancelQueuedTurn,
    queuedThreadIds,
    stopStream,
    streamingThreadId,
  ])

  const activeKey = activeThreadId ?? "new-chat"
  const localMessages = messagesByThread[activeKey] ?? []

  const setLocalMessages = React.useCallback(
    (updater: React.SetStateAction<ChatUIMessage[]>) => {
      const key = activeThreadId ?? "new-chat"
      setMessagesByThread((prev) => {
        const current = prev[key] ?? []
        const updated =
          typeof updater === "function" ? updater(current) : updater
        return { ...prev, [key]: updated }
      })
    },
    [activeThreadId],
  )

  return {
    activeThreadId,
    setActiveThreadId,
    localMessages,
    setLocalMessages,
    messagesByThread,
    setMessagesByThread,
    pendingQuestion,
    threadDrafts,
    setThreadDraft,
    clearThreadDraft,
    isStreaming,
    streamingThreadId,
    queuedThreadIds,
    isThreadStreaming,
    isThreadQueued,
    turnQueue,
    cancelQueuedTurn,
    handleThreadDeleted,
    stopStream: handleStop,
    handleSendMessage,
    handleQuestionAnswer,
    handleNewChat,
  }
}
