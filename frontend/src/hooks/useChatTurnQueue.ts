import * as React from "react"
import type { ChatUIMessage, QueuedTurn } from "@/components/Chat/types"
import type { BrowserReadingSession } from "@/observation/reading/session"

interface UseChatTurnQueueOptions {
  setThreadDraft: (threadId: string | null, text: string) => void
  getDraftRevision: (threadId: string | null) => number
  setMessagesByThread: React.Dispatch<
    React.SetStateAction<Record<string, ChatUIMessage[]>>
  >
  browserReading?: BrowserReadingSession
}

interface CancelQueuedTurnsOptions {
  threadId: string
  cancelled: QueuedTurn[]
  queuedDraftRevisions: Record<string, number>
  getDraftRevision: (threadId: string | null) => number
  setThreadDraft: (threadId: string | null, text: string) => void
  browserReading?: BrowserReadingSession
}

function filterCancelledMessages(
  messages: ChatUIMessage[],
  cancelled: QueuedTurn[],
): ChatUIMessage[] {
  const assistantIds = new Set(cancelled.map((turn) => turn.assistantMsgId))
  const prompts = new Set(cancelled.map((turn) => turn.promptText))
  return messages.filter((message) => {
    if (assistantIds.has(message.id)) return false
    if (message.role !== "user") return true
    return !message.parts.some(
      (part) => part.type === "text" && prompts.has(part.text),
    )
  })
}

function canRestoreCancelledPrompt(
  turn: QueuedTurn | undefined,
  queuedRevision: number | undefined,
  currentRevision: number,
): turn is QueuedTurn {
  if (!turn?.promptText || turn.browserQuestion) return false
  return queuedRevision === currentRevision
}

function acknowledgeCancelledTurns({
  threadId,
  cancelled,
  queuedDraftRevisions,
  getDraftRevision,
  setThreadDraft,
  browserReading,
}: CancelQueuedTurnsOptions): void {
  const firstCancelled = cancelled[0]
  const latestCancelled = cancelled[cancelled.length - 1]
  const latestRevision = latestCancelled
    ? queuedDraftRevisions[latestCancelled.id]
    : undefined
  if (
    canRestoreCancelledPrompt(
      firstCancelled,
      latestRevision,
      getDraftRevision(threadId),
    )
  ) {
    setThreadDraft(threadId, firstCancelled.promptText)
  }
  cancelled.forEach((turn) => {
    delete queuedDraftRevisions[turn.id]
    turn.onAcknowledged?.(false)
    if (turn.browserQuestion) {
      browserReading?.cancelPreparedQuestion(turn.browserQuestion.operation_id)
    }
  })
}

export function useChatTurnQueue({
  setThreadDraft,
  getDraftRevision,
  setMessagesByThread,
  browserReading,
}: UseChatTurnQueueOptions) {
  const turnQueueRef = React.useRef<QueuedTurn[]>([])
  const queuedDraftRevisionsRef = React.useRef<Record<string, number>>({})
  const [turnQueue, setTurnQueue] = React.useState<QueuedTurn[]>([])

  const queuedThreadIds = React.useMemo(
    () => turnQueue.map((turn) => turn.threadId),
    [turnQueue],
  )

  const enqueueTurn = React.useCallback(
    (turn: QueuedTurn) => {
      queuedDraftRevisionsRef.current[turn.id] = getDraftRevision(turn.threadId)
      turnQueueRef.current = [...turnQueueRef.current, turn]
      setTurnQueue(turnQueueRef.current)
    },
    [getDraftRevision],
  )

  const dequeueTurn = React.useCallback((): QueuedTurn | undefined => {
    const [next, ...rest] = turnQueueRef.current
    if (next) delete queuedDraftRevisionsRef.current[next.id]
    turnQueueRef.current = rest
    setTurnQueue(rest)
    return next
  }, [])

  const cancelQueuedTurn = React.useCallback(
    (threadId: string) => {
      const cancelled = turnQueueRef.current.filter(
        (turn) => turn.threadId === threadId,
      )
      turnQueueRef.current = turnQueueRef.current.filter(
        (turn) => turn.threadId !== threadId,
      )
      setTurnQueue(turnQueueRef.current)
      acknowledgeCancelledTurns({
        threadId,
        cancelled,
        queuedDraftRevisions: queuedDraftRevisionsRef.current,
        getDraftRevision,
        setThreadDraft,
        browserReading,
      })
      setMessagesByThread((previous) => ({
        ...previous,
        [threadId]: filterCancelledMessages(
          previous[threadId] ?? [],
          cancelled,
        ),
      }))
    },
    [setThreadDraft, getDraftRevision, setMessagesByThread, browserReading],
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
