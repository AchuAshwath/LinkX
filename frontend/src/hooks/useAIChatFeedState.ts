import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import * as React from "react"
import { AiThreadsService, type ChatThreadPublic } from "@/client"
import type {
  AskUserAnswer,
  AskUserToolPart,
  ChatUIMessage,
} from "@/components/Chat/types"
import { useAIChatStream } from "@/hooks/useAIChatStream"
import { useChatTurnSender } from "@/hooks/useChatTurnSender"

function syncThreadMessages({
  activeThreadId,
  transcriptMessages,
  threadChanged,
  setLocalMessages,
}: {
  activeThreadId: string | null
  transcriptMessages: ChatUIMessage[] | null
  threadChanged: boolean
  setLocalMessages: React.Dispatch<React.SetStateAction<ChatUIMessage[]>>
}) {
  if (!activeThreadId) {
    setLocalMessages([])
    return
  }
  if (!transcriptMessages) return

  if (threadChanged) {
    setLocalMessages(transcriptMessages)
    return
  }

  setLocalMessages((current) =>
    transcriptMessages.length >= current.length ? transcriptMessages : current,
  )
}

function useThreadTranscript({
  activeThreadId,
  isStreaming,
  setLocalMessages,
}: {
  activeThreadId: string | null
  isStreaming: boolean
  setLocalMessages: React.Dispatch<React.SetStateAction<ChatUIMessage[]>>
}) {
  const previousThreadIdRef = React.useRef<string | null>(null)
  const { data: activeThreadDetail } = useQuery({
    queryKey: ["ai-thread", activeThreadId],
    queryFn: () => AiThreadsService.getChatThread({ id: activeThreadId! }),
    enabled: Boolean(activeThreadId),
  })

  React.useEffect(() => {
    if (isStreaming) return

    const threadChanged = previousThreadIdRef.current !== activeThreadId
    previousThreadIdRef.current = activeThreadId

    const transcriptMessages =
      (activeThreadDetail?.transcript as { messages?: ChatUIMessage[] })
        ?.messages || null

    syncThreadMessages({
      activeThreadId,
      transcriptMessages,
      threadChanged,
      setLocalMessages,
    })
  }, [activeThreadDetail, isStreaming, activeThreadId, setLocalMessages])
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
  setActiveThreadId: (id: string) => void,
) {
  const initialLoadedRef = React.useRef(false)
  React.useEffect(() => {
    if (threads.length > 0 && !initialLoadedRef.current) {
      setActiveThreadId(threads[0].id)
      initialLoadedRef.current = true
    }
  }, [threads, setActiveThreadId])
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
}: {
  threads: ChatThreadPublic[]
  selectedModelId: string
}) {
  const queryClient = useQueryClient()
  const { isStreaming, startStream, stop: stopStream } = useAIChatStream()
  const { threadDrafts, setThreadDraft, clearThreadDraft } = useThreadDrafts()

  const [activeThreadId, setActiveThreadId] = React.useState<string | null>(
    null,
  )
  const [localMessages, setLocalMessages] = React.useState<ChatUIMessage[]>([])
  const [pendingQuestion, setPendingQuestion] =
    React.useState<AskUserToolPart | null>(null)

  useInitialActiveThread(threads, setActiveThreadId)
  useThreadTranscript({ activeThreadId, isStreaming, setLocalMessages })
  const createThreadMutation = useCreateThreadMutation(
    queryClient,
    setActiveThreadId,
  )

  const handleSendMessage = useChatTurnSender({
    activeThreadId,
    selectedModelId,
    isStreaming,
    setActiveThreadId,
    setLocalMessages,
    setPendingQuestion,
    clearThreadDraft,
    createThreadMutation,
    startStream,
    queryClient,
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
    stopStream()
    setActiveThreadId(null)
    setLocalMessages([])
    setPendingQuestion(null)
  }, [stopStream])

  return {
    activeThreadId,
    setActiveThreadId,
    localMessages,
    setLocalMessages,
    pendingQuestion,
    threadDrafts,
    setThreadDraft,
    clearThreadDraft,
    isStreaming,
    stopStream,
    handleSendMessage,
    handleQuestionAnswer,
    handleNewChat,
  }
}
