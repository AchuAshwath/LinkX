import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import * as React from "react"
import { AiThreadsService, type ChatThreadPublic } from "@/client"
import { extractTextParts } from "@/components/Chat/ChatMessage"
import type {
  AskUserAnswer,
  AskUserToolPart,
  ChatUIMessage,
} from "@/components/Chat/types"
import { useAIChatStream } from "@/hooks/useAIChatStream"
import { useQueueProcessor } from "@/hooks/useChatQueueProcessor"
import { useChatTurnQueue } from "@/hooks/useChatTurnQueue"
import type {
  ChatTurnSender,
  ThreadDraftRecoveryToken,
} from "@/hooks/useChatTurnSender"
import { useChatTurnSender } from "@/hooks/useChatTurnSender"
import {
  findDeepestLeaf,
  findSiblingByDirection,
  resolveActiveBranch,
} from "@/hooks/useTranscriptTree"
import { retainBrowserActivities } from "@/observation/reading/activity"
import type { BrowserReadingSession } from "@/observation/reading/session"
import { isScrapePrompt } from "@/utils/scrapeThread"

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

function isMatchingLastServerUser(
  m: ChatUIMessage,
  lastServerUserText?: string,
): boolean {
  if (m.role !== "user" || !lastServerUserText) return false
  const userText = m.parts?.find((p) => p.type === "text")?.text?.trim()
  return userText === lastServerUserText
}

function isTurnMessagePending(
  m: ChatUIMessage,
  serverIds: Set<string>,
  lastServerUserText?: string,
): boolean {
  if (serverIds.has(m.id)) return false
  if (isMatchingLastServerUser(m, lastServerUserText)) return false
  if (m.status === "queued" || m.status === "streaming") return true
  return m.id.startsWith("local_")
}

function extractPendingTurnMessages(
  current: ChatUIMessage[],
  transcriptMessages: ChatUIMessage[],
): ChatUIMessage[] {
  const serverIds = new Set(transcriptMessages.map((m) => m.id))
  const lastServer = transcriptMessages[transcriptMessages.length - 1]
  const lastServerUserText =
    lastServer?.role === "user"
      ? lastServer.parts?.find((p) => p.type === "text")?.text?.trim()
      : undefined

  return current.filter((m) =>
    isTurnMessagePending(m, serverIds, lastServerUserText),
  )
}

function hasActiveTurn(messages: ChatUIMessage[]): boolean {
  return messages.some((m) => m.status === "queued" || m.status === "streaming")
}

function attachParentToServerTail(
  pendingTurns: ChatUIMessage[],
  lastServerMsg?: ChatUIMessage,
) {
  if (!lastServerMsg || pendingTurns.length === 0) return
  const first = pendingTurns[0]
  if (first && first.parentId == null) {
    pendingTurns[0] = { ...first, parentId: lastServerMsg.id }
  }
}

function mergePendingTurns(
  current: ChatUIMessage[],
  transcriptMessages: ChatUIMessage[],
): ChatUIMessage[] {
  const pendingTurns = extractPendingTurnMessages(current, transcriptMessages)
  const lastServer = transcriptMessages[transcriptMessages.length - 1]
  attachParentToServerTail(pendingTurns, lastServer)
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

function getFirstDefined<T>(a: T | undefined, b: T | undefined): T | undefined {
  return a !== undefined ? a : b
}

function normalizeRawMessage(raw: any): ChatUIMessage {
  if (!raw || typeof raw !== "object") return raw
  return {
    ...raw,
    parentId: getFirstDefined(raw.parentId, raw.parent_id),
    forkedFromId: getFirstDefined(raw.forkedFromId, raw.forked_from_id),
    createdAt: getFirstDefined(raw.createdAt, raw.created_at),
  }
}

function extractTranscriptMessages(
  detail: unknown,
  expectedThreadId?: string | null,
): ChatUIMessage[] | null {
  if (!detail || typeof detail !== "object") return null
  const typed = detail as {
    id?: string
    transcript?: { messages?: unknown[] }
  }
  if (!matchesExpectedThread(typed.id, expectedThreadId)) {
    return null
  }
  const rawList = typed.transcript?.messages
  if (!Array.isArray(rawList)) return null
  return rawList.map(normalizeRawMessage)
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
  setMessagesByThread((prev) => {
    const current = prev[threadId] ?? []
    const merged = retainBrowserActivities({
      current,
      messages: resolveMergedTranscriptMessages({
        current,
        transcriptMessages,
      }),
    })
    if (
      current.length === merged.length &&
      current.every((m, idx) => m.id === merged[idx]?.id)
    ) {
      return prev
    }
    return {
      ...prev,
      [threadId]: merged,
    }
  })
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

interface ThreadTranscriptProps {
  activeThreadId: string | null
  streamingThreadId: string | null
  queuedThreadIds: string[]
  setMessagesByThread: React.Dispatch<
    React.SetStateAction<Record<string, ChatUIMessage[]>>
  >
  setActiveLeafIdByThread: React.Dispatch<
    React.SetStateAction<Record<string, string | null>>
  >
  onModelLoaded?: (modelId?: string | null) => void
}

function syncThreadDetailToState({
  threadId,
  detail,
  setMessagesByThread,
  setActiveLeafIdByThread,
}: {
  threadId: string
  detail: unknown
  setMessagesByThread: React.Dispatch<
    React.SetStateAction<Record<string, ChatUIMessage[]>>
  >
  setActiveLeafIdByThread: React.Dispatch<
    React.SetStateAction<Record<string, string | null>>
  >
}) {
  const messages = extractTranscriptMessages(detail, threadId)
  if (messages) {
    syncTranscriptToState({
      threadId,
      transcriptMessages: messages,
      setMessagesByThread,
    })
  }
  const leafId = extractServerActiveLeafId(detail, threadId)
  syncLeafIdToState({
    threadId,
    leafId,
    setActiveLeafIdByThread,
  })
}

function useThreadTranscript({
  activeThreadId,
  streamingThreadId,
  queuedThreadIds,
  setMessagesByThread,
  setActiveLeafIdByThread,
  onModelLoaded,
}: ThreadTranscriptProps) {
  const { data: activeThreadDetail } = useQuery({
    queryKey: ["ai-thread", activeThreadId],
    queryFn: () => AiThreadsService.getChatThread({ id: activeThreadId! }),
    enabled: Boolean(activeThreadId),
  })

  React.useEffect(() => {
    if (activeThreadDetail) {
      onModelLoaded?.(activeThreadDetail.model)
    }
  }, [activeThreadDetail, onModelLoaded])

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

    syncThreadDetailToState({
      threadId: activeThreadId,
      detail: activeThreadDetail,
      setMessagesByThread,
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

interface ThreadDraftStateActions {
  setThreadDraft: (id: string | null, text: string) => void
  clearThreadDraft: (id: string | null) => void
  getDraftRevision: (id: string | null) => number
  clearMatchingDraft: (
    id: string | null,
    text: string,
  ) => ThreadDraftRecoveryToken | null
  restoreDraftIfEmpty: (
    id: string | null,
    recovery: ThreadDraftRecoveryToken | null,
  ) => void
}

interface ThreadDraftStateOptions {
  draftValuesRef: React.MutableRefObject<Record<string, string>>
  draftRevisionsRef: React.MutableRefObject<Record<string, number>>
  setThreadDrafts: React.Dispatch<React.SetStateAction<Record<string, string>>>
}

function writeThreadDraft(
  options: ThreadDraftStateOptions & { key: string; text: string },
) {
  const { key, text, draftValuesRef, draftRevisionsRef, setThreadDrafts } =
    options
  if ((draftValuesRef.current[key] ?? "") === text) return
  draftValuesRef.current = { ...draftValuesRef.current, [key]: text }
  draftRevisionsRef.current[key] = (draftRevisionsRef.current[key] ?? 0) + 1
  setThreadDrafts((prev) => ({ ...prev, [key]: text }))
}

function removeThreadDraft(options: ThreadDraftStateOptions & { key: string }) {
  const { key, draftValuesRef, draftRevisionsRef, setThreadDrafts } = options
  if (!(key in draftValuesRef.current)) return
  const nextValues = { ...draftValuesRef.current }
  delete nextValues[key]
  draftValuesRef.current = nextValues
  draftRevisionsRef.current[key] = (draftRevisionsRef.current[key] ?? 0) + 1
  setThreadDrafts((prev) => {
    if (!(key in prev)) return prev
    const copy = { ...prev }
    delete copy[key]
    return copy
  })
}

function clearMatchingThreadDraft(
  options: ThreadDraftStateOptions & { id: string | null; text: string },
): ThreadDraftRecoveryToken | null {
  const { id, text, draftValuesRef, draftRevisionsRef } = options
  const key = id ?? "new-chat"
  const existingText = draftValuesRef.current[key]
  if (existingText?.trim() !== text.trim()) return null
  writeThreadDraft({ ...options, key, text: "" })
  return { revision: draftRevisionsRef.current[key] ?? 0, text: existingText }
}

function restoreThreadDraftIfEmpty(
  options: ThreadDraftStateOptions & {
    id: string | null
    recovery: ThreadDraftRecoveryToken | null
  },
) {
  const { id, recovery, draftValuesRef, draftRevisionsRef } = options
  const key = id ?? "new-chat"
  if (!recovery) return
  setTimeout(() => {
    if (draftRevisionsRef.current[key] !== recovery.revision) return
    if (draftValuesRef.current[key]?.trim()) return
    writeThreadDraft({ ...options, key, text: recovery.text })
  }, 0)
}

function createThreadDraftActions(
  options: ThreadDraftStateOptions,
): ThreadDraftStateActions {
  return {
    setThreadDraft: (id, text) =>
      writeThreadDraft({ ...options, key: id ?? "new-chat", text }),
    clearThreadDraft: (id) =>
      removeThreadDraft({ ...options, key: id ?? "new-chat" }),
    getDraftRevision: (id) =>
      options.draftRevisionsRef.current[id ?? "new-chat"] ?? 0,
    clearMatchingDraft: (id, text) =>
      clearMatchingThreadDraft({ ...options, id, text }),
    restoreDraftIfEmpty: (id, recovery) =>
      restoreThreadDraftIfEmpty({ ...options, id, recovery }),
  }
}

function useThreadDrafts() {
  const [threadDrafts, setThreadDrafts] = React.useState<
    Record<string, string>
  >({})
  const draftValuesRef = React.useRef<Record<string, string>>({})
  const draftRevisionsRef = React.useRef<Record<string, number>>({})
  const actions = React.useMemo(
    () =>
      createThreadDraftActions({
        draftValuesRef,
        draftRevisionsRef,
        setThreadDrafts,
      }),
    [],
  )

  return { threadDrafts, ...actions }
}

interface InitialActiveThreadOptions {
  threads: ChatThreadPublic[]
  initialThreadId?: string
  activeThreadId: string | null
  isStreaming: boolean
  isAutoRun?: boolean
  setActiveThreadId: (id: string) => void
}

function useInitialActiveThread({
  threads,
  initialThreadId,
  activeThreadId,
  isStreaming,
  isAutoRun,
  setActiveThreadId,
}: InitialActiveThreadOptions) {
  const initialLoadedRef = React.useRef(false)
  React.useEffect(() => {
    if (initialLoadedRef.current) {
      return
    }
    if (isAutoRun) {
      initialLoadedRef.current = true
      return
    }
    if (activeThreadId || isStreaming) {
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
  }, [
    threads,
    initialThreadId,
    activeThreadId,
    isStreaming,
    isAutoRun,
    setActiveThreadId,
  ])
}

function useCreateThreadMutation(
  queryClient: ReturnType<typeof useQueryClient>,
  selectedModelId?: string,
) {
  return useMutation({
    mutationFn: (prompt?: string) => {
      const isTrending = isScrapePrompt(prompt)
      return AiThreadsService.createChatThread({
        requestBody: {
          origin: isTrending ? "trending" : "composer",
          prompt,
          topic_keyword: isTrending ? "trending_scrape" : undefined,
          model: selectedModelId || undefined,
        },
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai-threads"] })
    },
  })
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
      Boolean(
        (threadId && streamingThreadId === threadId) ||
          (!threadId && streamingThreadId !== null),
      ),
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
type TurnQueueState = ReturnType<typeof useChatTurnQueue>

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

function stopDeletedBrowserSession(
  session: BrowserReadingSession | undefined,
  id: string,
) {
  const owner = session?.getSnapshot()
  if (owner?.ownerChatId === id) {
    session?.stop()
    return
  }
  if (owner?.threadId === id) session?.stop()
}

interface ThreadActionsProps {
  browserReading?: BrowserReadingSession
  core: ChatFeedCore
  queueState: TurnQueueState
  handleSendMessage: ChatTurnSender
}

function useThreadActions({
  browserReading,
  core,
  queueState,
  handleSendMessage,
}: ThreadActionsProps) {
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
      stopDeletedBrowserSession(browserReading, deletedId)
      executeThreadDeletion({
        deletedId,
        streamingThreadId,
        stopStream,
        cancelQueuedTurn,
        setMessagesByThread,
      })
    },
    [
      streamingThreadId,
      stopStream,
      cancelQueuedTurn,
      setMessagesByThread,
      browserReading,
    ],
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
  isAutoRun,
  selectedModelId,
  setSelectedModelId,
  core,
  queueState,
  browserReading,
}: {
  threads: ChatThreadPublic[]
  initialThreadId?: string
  isAutoRun?: boolean
  selectedModelId: string
  setSelectedModelId?: (modelId?: string | null) => void
  core: ChatFeedCore
  queueState: TurnQueueState
  browserReading?: BrowserReadingSession
}) {
  const processQueue = useQueueProcessor({
    turnQueueRef: queueState.turnQueueRef,
    dequeueTurn: queueState.dequeueTurn,
    setMessagesByThread: core.setMessagesByThread,
    queryClient: core.queryClient,
    startStream: core.streamState.startStream,
    browserReading,
  })

  useInitialActiveThread({
    threads,
    initialThreadId,
    activeThreadId: core.activeThreadId,
    isStreaming: core.streamState.isStreaming,
    isAutoRun,
    setActiveThreadId: core.setActiveThreadId,
  })

  useThreadTranscript({
    activeThreadId: core.activeThreadId,
    streamingThreadId: core.streamState.streamingThreadId,
    queuedThreadIds: queueState.queuedThreadIds,
    setMessagesByThread: core.setMessagesByThread,
    setActiveLeafIdByThread: core.setActiveLeafIdByThread,
    onModelLoaded: setSelectedModelId,
  })

  const createThreadMutation = useCreateThreadMutation(
    core.queryClient,
    selectedModelId,
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
    setThreadDraft: core.draftState.setThreadDraft,
    clearMatchingDraft: core.draftState.clearMatchingDraft,
    restoreDraftIfEmpty: core.draftState.restoreDraftIfEmpty,
    createThreadMutation,
    enqueueTurn: queueState.enqueueTurn,
    processQueue,
  })

  return { handleSendMessage }
}

interface UseMessageEditingProps {
  localMessages: ChatUIMessage[]
  handleSendMessage: ChatTurnSender
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

interface ExecuteRegenerateTurnOptions {
  localMessages: ChatUIMessage[]
  assistantMsgId: string
  isStreaming: boolean
  stopStream: () => void
  handleSendMessage: ChatTurnSender
}

async function executeRegenerateTurn({
  localMessages,
  assistantMsgId,
  isStreaming,
  stopStream,
  handleSendMessage,
}: ExecuteRegenerateTurnOptions): Promise<void> {
  const preceding = findPrecedingUserMessage(localMessages, assistantMsgId)
  if (!preceding) return
  const text = extractTextParts(preceding.parts)
  if (!text) return
  if (isStreaming) {
    stopStream()
  }
  await handleSendMessage(text, undefined, assistantMsgId)
}

function useStreamGuardReset(
  isStreaming: boolean,
  editingMessageId: string | null,
  setEditingMessageId: (id: string | null) => void,
) {
  React.useEffect(() => {
    if (isStreaming && editingMessageId) {
      setEditingMessageId(null)
    }
  }, [isStreaming, editingMessageId, setEditingMessageId])
}

function usePromptRecall(localMessages: ChatUIMessage[]) {
  return React.useCallback((): string | null => {
    const lastUser = findLastUserMessage(localMessages)
    return lastUser ? extractTextParts(lastUser.parts) : null
  }, [localMessages])
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

  useStreamGuardReset(isStreaming, editingMessageId, setEditingMessageId)

  const handleStartEdit = React.useCallback(
    (messageId: string) => {
      if (isStreaming) return
      setEditingMessageId(messageId)
    },
    [isStreaming],
  )

  const handleCancelEdit = React.useCallback(() => {
    setEditingMessageId(null)
  }, [])

  const handleEditMessage = React.useCallback(
    async (messageId: string, newText: string) => {
      if (isStreaming) return
      setEditingMessageId(null)
      await handleSendMessage(newText, undefined, messageId)
    },
    [handleSendMessage, isStreaming],
  )

  const handleRegenerate = React.useCallback(
    async (assistantMsgId: string) => {
      await executeRegenerateTurn({
        localMessages,
        assistantMsgId,
        isStreaming,
        stopStream,
        handleSendMessage,
      })
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
    if (isStreaming) return
    const lastUser = findLastUserMessage(localMessages)
    if (lastUser) {
      setEditingMessageId(lastUser.id)
    }
  }, [isStreaming, localMessages])

  const handleRecallLastUserPrompt = usePromptRecall(localMessages)

  return {
    editingMessageId,
    handleStartEdit,
    handleCancelEdit,
    handleEditMessage,
    handleRegenerate,
    handleRetry,
    handleEditLastUserMessage,
    handleRecallLastUserPrompt,
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
  handleSendMessage: ChatTurnSender
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
    observationUsage: core.streamState.observationUsage,
    clearObservationUsage: core.streamState.clearObservationUsage,
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
    handleRecallLastUserPrompt: editingState.handleRecallLastUserPrompt,
  }
}

export interface UseAIChatFeedStateProps {
  threads: ChatThreadPublic[]
  selectedModelId: string
  setSelectedModelId?: (modelId?: string | null) => void
  initialThreadId?: string
  isAutoRun?: boolean
  browserReading?: BrowserReadingSession
}

export function useAIChatFeedState(options: UseAIChatFeedStateProps) {
  const core = useChatFeedCore(options.initialThreadId)
  const queueState = useChatTurnQueue({
    setThreadDraft: core.draftState.setThreadDraft,
    getDraftRevision: core.draftState.getDraftRevision,
    setMessagesByThread: core.setMessagesByThread,
    browserReading: options.browserReading,
  })
  const streamingStatus = useThreadStreamingStatus({
    streamingThreadId: core.streamState.streamingThreadId,
    queuedThreadIds: queueState.queuedThreadIds,
  })
  const { handleSendMessage } = useChatEngine({
    threads: options.threads,
    initialThreadId: options.initialThreadId,
    isAutoRun: options.isAutoRun,
    selectedModelId: options.selectedModelId,
    setSelectedModelId: options.setSelectedModelId,
    core,
    queueState,
    browserReading: options.browserReading,
  })

  const threadActions = useThreadActions({
    browserReading: options.browserReading,
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

  const previousThreadId = React.useRef(core.activeThreadId)
  React.useEffect(() => {
    if (previousThreadId.current === core.activeThreadId) return
    previousThreadId.current = core.activeThreadId
    core.streamState.clearObservationUsage()
  }, [core.activeThreadId, core.streamState.clearObservationUsage])

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
