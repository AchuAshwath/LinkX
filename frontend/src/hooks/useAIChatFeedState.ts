import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import * as React from "react"
import { AiThreadsService, type ChatThreadPublic } from "@/client"
import { extractTextParts } from "@/components/Chat/ChatMessage"
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
import {
  findDeepestLeaf,
  findSiblingByDirection,
  resolveActiveBranch,
} from "@/hooks/useTranscriptTree"

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

function isPendingMessage(m: ChatUIMessage, serverIds: Set<string>): boolean {
  if (serverIds.has(m.id)) return false
  if (m.id.startsWith("local_")) return true
  return m.status === "queued" || m.status === "streaming"
}

function hasActiveTurn(messages: ChatUIMessage[]): boolean {
  return messages.some((m) => m.status === "queued" || m.status === "streaming")
}

function mergePendingTurns(
  current: ChatUIMessage[],
  transcriptMessages: ChatUIMessage[],
): ChatUIMessage[] {
  const serverIds = new Set(transcriptMessages.map((m) => m.id))
  const pendingTurns = current.filter((m) => isPendingMessage(m, serverIds))
  return [...transcriptMessages, ...pendingTurns]
}

function resolveMergedTranscriptMessages({
  current,
  transcriptMessages,
}: {
  current: ChatUIMessage[]
  transcriptMessages: ChatUIMessage[]
}): ChatUIMessage[] {
  if (current.length === 0) {
    return transcriptMessages
  }
  if (hasActiveTurn(current)) {
    return mergePendingTurns(current, transcriptMessages)
  }
  if (transcriptMessages.length === 0) {
    const hasOptimistic = current.some((m) => m.id.startsWith("local_"))
    if (hasOptimistic) return current
  }
  if (transcriptMessages.length >= current.length) {
    return transcriptMessages
  }
  return current
}

function matchesExpectedThread(
  detailId?: string,
  expectedThreadId?: string | null,
): boolean {
  if (!expectedThreadId) return true
  return detailId === expectedThreadId
}

function extractTranscriptMessages(
  detail: unknown,
  expectedThreadId?: string | null,
): ChatUIMessage[] | null {
  if (!detail || typeof detail !== "object") return null
  const typed = detail as {
    id?: string
    transcript?: { messages?: ChatUIMessage[] }
  }
  if (!matchesExpectedThread(typed.id, expectedThreadId)) {
    return null
  }
  return typed.transcript?.messages ?? null
}

function extractServerActiveLeafId(
  detail: unknown,
  expectedThreadId?: string | null,
): string | null {
  if (!detail || typeof detail !== "object") return null
  const typed = detail as {
    id?: string
    active_leaf_id?: string | null
    transcript?: { active_leaf_id?: string | null }
  }
  if (!matchesExpectedThread(typed.id, expectedThreadId)) {
    return null
  }
  return typed.active_leaf_id ?? typed.transcript?.active_leaf_id ?? null
}

function syncTranscriptToState({
  threadId,
  transcriptMessages,
  setMessagesByThread,
}: {
  threadId: string
  transcriptMessages: ChatUIMessage[]
  setMessagesByThread: React.Dispatch<
    React.SetStateAction<Record<string, ChatUIMessage[]>>
  >
}) {
  setMessagesByThread((prev) => ({
    ...prev,
    [threadId]: resolveMergedTranscriptMessages({
      current: prev[threadId] ?? [],
      transcriptMessages,
    }),
  }))
}

function syncLeafIdToState({
  threadId,
  leafId,
  setActiveLeafIdByThread,
}: {
  threadId: string
  leafId: string | null
  setActiveLeafIdByThread: React.Dispatch<
    React.SetStateAction<Record<string, string | null>>
  >
}) {
  if (!leafId) return
  setActiveLeafIdByThread((prev) => {
    if (prev[threadId] === leafId) return prev
    return { ...prev, [threadId]: leafId }
  })
}

function useThreadTranscript({
  activeThreadId,
  streamingThreadId,
  queuedThreadIds,
  setMessagesByThread,
  setActiveLeafIdByThread,
}: {
  activeThreadId: string | null
  streamingThreadId: string | null
  queuedThreadIds: string[]
  setMessagesByThread: React.Dispatch<
    React.SetStateAction<Record<string, ChatUIMessage[]>>
  >
  setActiveLeafIdByThread: React.Dispatch<
    React.SetStateAction<Record<string, string | null>>
  >
}) {
  const { data: activeThreadDetail } = useQuery({
    queryKey: ["ai-thread", activeThreadId],
    queryFn: () => AiThreadsService.getChatThread({ id: activeThreadId! }),
    enabled: Boolean(activeThreadId),
  })

  React.useEffect(() => {
    if (
      !activeThreadId ||
      shouldSkipTranscriptSync({
        activeThreadId,
        streamingThreadId,
        queuedThreadIds,
      })
    ) {
      return
    }

    const messages = extractTranscriptMessages(
      activeThreadDetail,
      activeThreadId,
    )
    if (messages) {
      syncTranscriptToState({
        threadId: activeThreadId,
        transcriptMessages: messages,
        setMessagesByThread,
      })
    }

    const leafId = extractServerActiveLeafId(activeThreadDetail, activeThreadId)
    syncLeafIdToState({
      threadId: activeThreadId,
      leafId,
      setActiveLeafIdByThread,
    })
  }, [
    activeThreadDetail,
    activeThreadId,
    streamingThreadId,
    queuedThreadIds,
    setMessagesByThread,
    setActiveLeafIdByThread,
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
  activeThreadId: string | null,
  setActiveThreadId: (id: string) => void,
) {
  const initialLoadedRef = React.useRef(false)
  React.useEffect(() => {
    if (initialLoadedRef.current) {
      return
    }
    if (activeThreadId) {
      initialLoadedRef.current = true
      return
    }
    if (initialThreadId) {
      setActiveThreadId(initialThreadId)
      initialLoadedRef.current = true
      return
    }
    if (threads.length > 0) {
      setActiveThreadId(threads[0].id)
      initialLoadedRef.current = true
    }
  }, [threads, initialThreadId, activeThreadId, setActiveThreadId])
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
        nextTurn.editMessageId,
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
  activeLeafIdByThread,
  setActiveLeafIdByThread,
}: {
  activeThreadId: string | null
  messagesByThread: Record<string, ChatUIMessage[]>
  setMessagesByThread: React.Dispatch<
    React.SetStateAction<Record<string, ChatUIMessage[]>>
  >
  activeLeafIdByThread: Record<string, string | null>
  setActiveLeafIdByThread: React.Dispatch<
    React.SetStateAction<Record<string, string | null>>
  >
}) {
  const activeKey = activeThreadId ?? "new-chat"
  const localMessages = messagesByThread[activeKey] ?? []
  const activeLeafId = activeThreadId
    ? (activeLeafIdByThread[activeThreadId] ?? null)
    : null

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

  const displayMessages = React.useMemo(
    () => resolveActiveBranch(localMessages, activeLeafId),
    [localMessages, activeLeafId],
  )

  const handleSwitchBranch = React.useCallback(
    (messageId: string, direction: "prev" | "next") => {
      const sibling = findSiblingByDirection(
        localMessages,
        messageId,
        direction,
      )
      if (!sibling) return
      const targetLeafId = findDeepestLeaf(localMessages, sibling.id)
      if (activeThreadId) {
        setActiveLeafIdByThread((prev) => ({
          ...prev,
          [activeThreadId]: targetLeafId,
        }))
        AiThreadsService.updateChatThread({
          id: activeThreadId,
          requestBody: { active_leaf_id: targetLeafId },
        }).catch(() => {})
      }
    },
    [activeThreadId, localMessages, setActiveLeafIdByThread],
  )

  return {
    localMessages: displayMessages,
    allMessages: localMessages,
    setLocalMessages,
    activeLeafId,
    handleSwitchBranch,
  }
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
  const [activeLeafIdByThread, setActiveLeafIdByThread] = React.useState<
    Record<string, string | null>
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
    activeLeafIdByThread,
    setActiveLeafIdByThread,
    pendingQuestion,
    setPendingQuestion,
  }
}

type ChatFeedCore = ReturnType<typeof useChatFeedCore>
type TurnQueueState = ReturnType<typeof useTurnQueue>

function formatAnswersText(answers: AskUserAnswer[]): string {
  return answers
    .map((a) => a.answer)
    .filter(Boolean)
    .join("; ")
}

interface ExecuteThreadDeletionOptions {
  deletedId: string
  streamingThreadId: string | null
  stopStream: (id: string) => void
  cancelQueuedTurn: (id: string) => void
  setMessagesByThread: React.Dispatch<
    React.SetStateAction<Record<string, ChatUIMessage[]>>
  >
}

function executeThreadDeletion({
  deletedId,
  streamingThreadId,
  stopStream,
  cancelQueuedTurn,
  setMessagesByThread,
}: ExecuteThreadDeletionOptions) {
  if (streamingThreadId === deletedId) {
    stopStream(deletedId)
  }
  cancelQueuedTurn(deletedId)
  setMessagesByThread((prev) => removeThreadMessages(prev, deletedId))
}

function useThreadActions({
  core,
  queueState,
  handleSendMessage,
}: {
  core: ChatFeedCore
  queueState: TurnQueueState
  handleSendMessage: (
    text: string,
    attachedImages?: File[],
    editMessageId?: string,
  ) => Promise<void>
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
      executeThreadDeletion({
        deletedId,
        streamingThreadId,
        stopStream,
        cancelQueuedTurn,
        setMessagesByThread,
      })
    },
    [streamingThreadId, stopStream, cancelQueuedTurn, setMessagesByThread],
  )

  const handleQuestionAnswer = React.useCallback(
    (_toolCallId: string, answers: AskUserAnswer[]) => {
      const text = formatAnswersText(answers)
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

  useInitialActiveThread(
    threads,
    initialThreadId,
    core.activeThreadId,
    core.setActiveThreadId,
  )
  useThreadTranscript({
    activeThreadId: core.activeThreadId,
    streamingThreadId: core.streamState.streamingThreadId,
    queuedThreadIds: queueState.queuedThreadIds,
    setMessagesByThread: core.setMessagesByThread,
    setActiveLeafIdByThread: core.setActiveLeafIdByThread,
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
    setActiveLeafIdByThread: core.setActiveLeafIdByThread,
    setMessagesByThread: core.setMessagesByThread,
    setPendingQuestion: core.setPendingQuestion,
    clearThreadDraft: core.draftState.clearThreadDraft,
    createThreadMutation,
    enqueueTurn: queueState.enqueueTurn,
    processQueue,
  })

  return { handleSendMessage }
}

interface UseMessageEditingProps {
  localMessages: ChatUIMessage[]
  handleSendMessage: (
    text: string,
    attachedImages?: File[],
    editMessageId?: string,
  ) => Promise<void>
  stopStream: () => void
  isStreaming: boolean
}

function findPrecedingUserMessage(
  messages: ChatUIMessage[],
  assistantMsgId: string,
): ChatUIMessage | null {
  const idx = messages.findIndex((m) => m.id === assistantMsgId)
  if (idx <= 0) return null
  for (let i = idx - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      return messages[i]
    }
  }
  return null
}

function findLastUserMessage(messages: ChatUIMessage[]): ChatUIMessage | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      return messages[i]
    }
  }
  return null
}

function useMessageEditing({
  localMessages,
  handleSendMessage,
  stopStream,
  isStreaming,
}: UseMessageEditingProps) {
  const [editingMessageId, setEditingMessageId] = React.useState<string | null>(
    null,
  )

  const handleStartEdit = React.useCallback((messageId: string) => {
    setEditingMessageId(messageId)
  }, [])

  const handleCancelEdit = React.useCallback(() => {
    setEditingMessageId(null)
  }, [])

  const handleEditMessage = React.useCallback(
    async (messageId: string, newText: string) => {
      setEditingMessageId(null)
      if (isStreaming) {
        stopStream()
      }
      await handleSendMessage(newText, undefined, messageId)
    },
    [handleSendMessage, isStreaming, stopStream],
  )

  const handleRegenerate = React.useCallback(
    async (assistantMsgId: string) => {
      const preceding = findPrecedingUserMessage(localMessages, assistantMsgId)
      if (!preceding) return
      const text = extractTextParts(preceding.parts)
      if (!text) return
      if (isStreaming) {
        stopStream()
      }
      await handleSendMessage(text, undefined, assistantMsgId)
    },
    [handleSendMessage, isStreaming, localMessages, stopStream],
  )

  const handleRetry = React.useCallback(
    async (assistantMsgId: string) => {
      await handleRegenerate(assistantMsgId)
    },
    [handleRegenerate],
  )

  const handleEditLastUserMessage = React.useCallback(() => {
    const lastUser = findLastUserMessage(localMessages)
    if (lastUser) {
      setEditingMessageId(lastUser.id)
    }
  }, [localMessages])

  return {
    editingMessageId,
    handleStartEdit,
    handleCancelEdit,
    handleEditMessage,
    handleRegenerate,
    handleRetry,
    handleEditLastUserMessage,
  }
}

function assembleFeedState({
  core,
  queueState,
  streamingStatus,
  threadActions,
  activeMessages,
  handleSendMessage,
  editingState,
}: {
  core: ChatFeedCore
  queueState: TurnQueueState
  streamingStatus: ReturnType<typeof useThreadStreamingStatus>
  threadActions: ReturnType<typeof useThreadActions>
  activeMessages: ReturnType<typeof useActiveThreadMessages>
  handleSendMessage: (
    text: string,
    attachedImages?: File[],
    editMessageId?: string,
  ) => Promise<void>
  editingState: ReturnType<typeof useMessageEditing>
}) {
  return {
    activeThreadId: core.activeThreadId,
    setActiveThreadId: core.setActiveThreadId,
    localMessages: activeMessages.localMessages,
    allMessages: activeMessages.allMessages,
    activeLeafId: activeMessages.activeLeafId,
    handleSwitchBranch: activeMessages.handleSwitchBranch,
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
    editingMessageId: editingState.editingMessageId,
    handleStartEdit: editingState.handleStartEdit,
    handleCancelEdit: editingState.handleCancelEdit,
    handleEditMessage: editingState.handleEditMessage,
    handleRegenerate: editingState.handleRegenerate,
    handleRetry: editingState.handleRetry,
    handleEditLastUserMessage: editingState.handleEditLastUserMessage,
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
    activeLeafIdByThread: core.activeLeafIdByThread,
    setActiveLeafIdByThread: core.setActiveLeafIdByThread,
  })
  const editingState = useMessageEditing({
    localMessages: activeMessages.localMessages,
    handleSendMessage,
    stopStream: threadActions.handleStop,
    isStreaming: core.streamState.isStreaming,
  })

  return assembleFeedState({
    core,
    queueState,
    streamingStatus,
    threadActions,
    activeMessages,
    handleSendMessage,
    editingState,
  })
}
