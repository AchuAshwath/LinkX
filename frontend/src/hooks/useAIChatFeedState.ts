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

function shouldSkipTranscriptSync({
  activeThreadId,
  streamingThreadId,
  queuedThreadIds,
}: {
  activeThreadId: string | null
  streamingThreadId: string | null
  queuedThreadIds: string[]
}): boolean {
  if (!activeThreadId) return true
  if (activeThreadId === streamingThreadId) return true
  return queuedThreadIds.includes(activeThreadId)
}

function resolveMergedTranscriptMessages({
  current,
  transcriptMessages,
}: {
  current: ChatUIMessage[]
  transcriptMessages: ChatUIMessage[]
}): ChatUIMessage[] {
  const hasOptimistic = current.some(
    (m) => m.id.startsWith("local_") || m.status === "queued",
  )
  if (hasOptimistic && transcriptMessages.length === 0) {
    return current
  }
  return transcriptMessages.length >= current.length
    ? transcriptMessages
    : current
}

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
    if (
      shouldSkipTranscriptSync({
        activeThreadId,
        streamingThreadId,
        queuedThreadIds,
      })
    ) {
      return
    }

    const transcriptMessages =
      (activeThreadDetail?.transcript as { messages?: ChatUIMessage[] })
        ?.messages || null

    if (!transcriptMessages) return

    setMessagesByThread((prev) => ({
      ...prev,
      [activeThreadId!]: resolveMergedTranscriptMessages({
        current: prev[activeThreadId!] ?? [],
        transcriptMessages,
      }),
    }))
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

function filterOutCancelledTurnMessages(
  msgs: ChatUIMessage[],
  cancelled: QueuedTurn[],
): ChatUIMessage[] {
  const cancelledAssistantIds = new Set(cancelled.map((c) => c.assistantMsgId))
  const cancelledPrompts = new Set(cancelled.map((c) => c.promptText))
  return msgs.filter((m) => {
    if (cancelledAssistantIds.has(m.id)) return false
    if (m.role === "user") {
      const matchesPrompt = m.parts.some(
        (p) => p.type === "text" && cancelledPrompts.has(p.text),
      )
      if (matchesPrompt) return false
    }
    return true
  })
}

function useTurnQueue({
  setThreadDraft,
  setMessagesByThread,
}: {
  setThreadDraft: (threadId: string | null, text: string) => void
  setMessagesByThread: React.Dispatch<
    React.SetStateAction<Record<string, ChatUIMessage[]>>
  >
}) {
  const turnQueueRef = React.useRef<QueuedTurn[]>([])
  const [turnQueue, setTurnQueue] = React.useState<QueuedTurn[]>([])

  const queuedThreadIds = React.useMemo(
    () => turnQueue.map((t) => t.threadId),
    [turnQueue],
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

      if (cancelled.length > 0 && cancelled[0].promptText) {
        setThreadDraft(threadId, cancelled[0].promptText)
      }

      setMessagesByThread((prev) => {
        const msgs = prev[threadId] ?? []
        return {
          ...prev,
          [threadId]: filterOutCancelledTurnMessages(msgs, cancelled),
        }
      })
    },
    [setThreadDraft, setMessagesByThread],
  )

  return {
    turnQueue,
    turnQueueRef,
    queuedThreadIds,
    enqueueTurn,
    dequeueTurn,
    cancelQueuedTurn,
  }
}

function executeStopAction({
  activeThreadId,
  streamingThreadId,
  queuedThreadIds,
  stopStream,
  cancelQueuedTurn,
}: {
  activeThreadId: string | null
  streamingThreadId: string | null
  queuedThreadIds: string[]
  stopStream: (id?: string) => void
  cancelQueuedTurn: (id: string) => void
}) {
  if (!activeThreadId) {
    stopStream()
    return
  }
  if (activeThreadId === streamingThreadId) {
    stopStream(activeThreadId)
    return
  }
  if (queuedThreadIds.includes(activeThreadId)) {
    cancelQueuedTurn(activeThreadId)
    return
  }
  stopStream()
}

function removeThreadMessages(
  prev: Record<string, ChatUIMessage[]>,
  deletedId: string,
): Record<string, ChatUIMessage[]> {
  if (!(deletedId in prev)) return prev
  const copy = { ...prev }
  delete copy[deletedId]
  return copy
}

function useQueueProcessor({
  turnQueueRef,
  dequeueTurn,
  setMessagesByThread,
  queryClient,
  startStream,
}: {
  turnQueueRef: React.MutableRefObject<QueuedTurn[]>
  dequeueTurn: () => QueuedTurn | undefined
  setMessagesByThread: React.Dispatch<
    React.SetStateAction<Record<string, ChatUIMessage[]>>
  >
  queryClient: ReturnType<typeof useQueryClient>
  startStream: ReturnType<typeof useAIChatStream>["startStream"]
}) {
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
  }, [dequeueTurn, queryClient, startStream, turnQueueRef, setMessagesByThread])

  return processQueue
}

function useActiveThreadMessages({
  activeThreadId,
  messagesByThread,
  setMessagesByThread,
}: {
  activeThreadId: string | null
  messagesByThread: Record<string, ChatUIMessage[]>
  setMessagesByThread: React.Dispatch<
    React.SetStateAction<Record<string, ChatUIMessage[]>>
  >
}) {
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
    [activeThreadId, setMessagesByThread],
  )

  return { localMessages, setLocalMessages }
}

function useThreadStreamingStatus({
  streamingThreadId,
  queuedThreadIds,
}: {
  streamingThreadId: string | null
  queuedThreadIds: string[]
}) {
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

  return { isThreadStreaming, isThreadQueued }
}

function useChatFeedCore(initialThreadId?: string) {
  const queryClient = useQueryClient()
  const streamState = useAIChatStream()
  const draftState = useThreadDrafts()
  const [activeThreadId, setActiveThreadId] = React.useState<string | null>(
    initialThreadId ?? null,
  )
  const [messagesByThread, setMessagesByThread] = React.useState<
    Record<string, ChatUIMessage[]>
  >({})
  const [pendingQuestion, setPendingQuestion] =
    React.useState<AskUserToolPart | null>(null)

  return {
    queryClient,
    streamState,
    draftState,
    activeThreadId,
    setActiveThreadId,
    messagesByThread,
    setMessagesByThread,
    pendingQuestion,
    setPendingQuestion,
  }
}

type ChatFeedCore = ReturnType<typeof useChatFeedCore>
type TurnQueueState = ReturnType<typeof useTurnQueue>

function useThreadActions({
  core,
  queueState,
  handleSendMessage,
}: {
  core: ChatFeedCore
  queueState: TurnQueueState
  handleSendMessage: (text: string, attachedImages?: File[]) => Promise<void>
}) {
  const { streamingThreadId, stop: stopStream } = core.streamState
  const {
    activeThreadId,
    setActiveThreadId,
    setMessagesByThread,
    setPendingQuestion,
  } = core
  const { queuedThreadIds, cancelQueuedTurn } = queueState

  const handleThreadDeleted = React.useCallback(
    (deletedId: string) => {
      if (streamingThreadId === deletedId) {
        stopStream(deletedId)
      }
      cancelQueuedTurn(deletedId)
      setMessagesByThread((prev) => removeThreadMessages(prev, deletedId))
    },
    [streamingThreadId, stopStream, cancelQueuedTurn, setMessagesByThread],
  )

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
  }, [setActiveThreadId, setMessagesByThread, setPendingQuestion])

  const handleStop = React.useCallback(() => {
    executeStopAction({
      activeThreadId,
      streamingThreadId,
      queuedThreadIds,
      stopStream,
      cancelQueuedTurn,
    })
  }, [
    activeThreadId,
    cancelQueuedTurn,
    queuedThreadIds,
    stopStream,
    streamingThreadId,
  ])

  return {
    handleThreadDeleted,
    handleQuestionAnswer,
    handleNewChat,
    handleStop,
  }
}

function useChatEngine({
  threads,
  initialThreadId,
  selectedModelId,
  core,
  queueState,
}: {
  threads: ChatThreadPublic[]
  initialThreadId?: string
  selectedModelId: string
  core: ChatFeedCore
  queueState: TurnQueueState
}) {
  const processQueue = useQueueProcessor({
    turnQueueRef: queueState.turnQueueRef,
    dequeueTurn: queueState.dequeueTurn,
    setMessagesByThread: core.setMessagesByThread,
    queryClient: core.queryClient,
    startStream: core.streamState.startStream,
  })

  useInitialActiveThread(threads, initialThreadId, core.setActiveThreadId)
  useThreadTranscript({
    activeThreadId: core.activeThreadId,
    streamingThreadId: core.streamState.streamingThreadId,
    queuedThreadIds: queueState.queuedThreadIds,
    setMessagesByThread: core.setMessagesByThread,
  })

  const createThreadMutation = useCreateThreadMutation(
    core.queryClient,
    core.setActiveThreadId,
  )

  const handleSendMessage = useChatTurnSender({
    activeThreadId: core.activeThreadId,
    selectedModelId,
    isStreaming: core.streamState.isStreaming,
    streamingThreadId: core.streamState.streamingThreadId,
    setActiveThreadId: core.setActiveThreadId,
    setMessagesByThread: core.setMessagesByThread,
    setPendingQuestion: core.setPendingQuestion,
    clearThreadDraft: core.draftState.clearThreadDraft,
    createThreadMutation,
    enqueueTurn: queueState.enqueueTurn,
    processQueue,
  })

  return { handleSendMessage }
}

function assembleFeedState({
  core,
  queueState,
  streamingStatus,
  threadActions,
  activeMessages,
  handleSendMessage,
}: {
  core: ChatFeedCore
  queueState: TurnQueueState
  streamingStatus: ReturnType<typeof useThreadStreamingStatus>
  threadActions: ReturnType<typeof useThreadActions>
  activeMessages: ReturnType<typeof useActiveThreadMessages>
  handleSendMessage: (text: string, attachedImages?: File[]) => Promise<void>
}) {
  return {
    activeThreadId: core.activeThreadId,
    setActiveThreadId: core.setActiveThreadId,
    localMessages: activeMessages.localMessages,
    setLocalMessages: activeMessages.setLocalMessages,
    messagesByThread: core.messagesByThread,
    setMessagesByThread: core.setMessagesByThread,
    pendingQuestion: core.pendingQuestion,
    threadDrafts: core.draftState.threadDrafts,
    setThreadDraft: core.draftState.setThreadDraft,
    clearThreadDraft: core.draftState.clearThreadDraft,
    isStreaming: core.streamState.isStreaming,
    streamingThreadId: core.streamState.streamingThreadId,
    queuedThreadIds: queueState.queuedThreadIds,
    isThreadStreaming: streamingStatus.isThreadStreaming,
    isThreadQueued: streamingStatus.isThreadQueued,
    turnQueue: queueState.turnQueue,
    cancelQueuedTurn: queueState.cancelQueuedTurn,
    handleThreadDeleted: threadActions.handleThreadDeleted,
    stopStream: threadActions.handleStop,
    handleSendMessage,
    handleQuestionAnswer: threadActions.handleQuestionAnswer,
    handleNewChat: threadActions.handleNewChat,
  }
}

export interface UseAIChatFeedStateProps {
  threads: ChatThreadPublic[]
  selectedModelId: string
  initialThreadId?: string
}

export function useAIChatFeedState(options: UseAIChatFeedStateProps) {
  const core = useChatFeedCore(options.initialThreadId)
  const queueState = useTurnQueue({
    setThreadDraft: core.draftState.setThreadDraft,
    setMessagesByThread: core.setMessagesByThread,
  })
  const streamingStatus = useThreadStreamingStatus({
    streamingThreadId: core.streamState.streamingThreadId,
    queuedThreadIds: queueState.queuedThreadIds,
  })
  const { handleSendMessage } = useChatEngine({
    threads: options.threads,
    initialThreadId: options.initialThreadId,
    selectedModelId: options.selectedModelId,
    core,
    queueState,
  })
  const threadActions = useThreadActions({
    core,
    queueState,
    handleSendMessage,
  })
  const activeMessages = useActiveThreadMessages({
    activeThreadId: core.activeThreadId,
    messagesByThread: core.messagesByThread,
    setMessagesByThread: core.setMessagesByThread,
  })

  return assembleFeedState({
    core,
    queueState,
    streamingStatus,
    threadActions,
    activeMessages,
    handleSendMessage,
  })
}
