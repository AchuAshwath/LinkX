import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import * as React from "react"
import { AiThreadsService, type ChatThreadPublic } from "@/client"
import type {
  AskUserAnswer,
  AskUserToolPart,
  ChatUIMessage,
} from "@/components/Chat/types"
import { useAIChatStream } from "@/hooks/useAIChatStream"

function createMessageTurn(text: string): {
  userMsg: ChatUIMessage
  assistantMsg: ChatUIMessage
} {
  const userMsg: ChatUIMessage = {
    id: `local-user-${Date.now()}`,
    role: "user",
    parts: [{ type: "text", text: text.trim() }],
    createdAt: new Date().toISOString(),
  }

  const assistantMsg: ChatUIMessage = {
    id: `local-assistant-${Date.now()}`,
    role: "assistant",
    parts: [],
    createdAt: new Date().toISOString(),
  }

  return { userMsg, assistantMsg }
}

function updateAssistantPart(
  messages: ChatUIMessage[],
  assistantMsgId: string,
  partType: "thought" | "text",
  delta: string,
): ChatUIMessage[] {
  return messages.map((msg) => {
    if (msg.id !== assistantMsgId) return msg
    const parts = [...msg.parts]
    const lastIndex = parts.length - 1
    const lastPart = parts[lastIndex]

    if (lastPart && lastPart.type === partType) {
      if (lastPart.type === "thought") {
        parts[lastIndex] = {
          ...lastPart,
          content: (lastPart.content || "") + delta,
        }
      } else {
        parts[lastIndex] = {
          ...lastPart,
          text: (lastPart.text || "") + delta,
        }
      }
    } else if (partType === "thought") {
      parts.push({ type: "thought", content: delta })
    } else {
      parts.push({ type: "text", text: delta })
    }
    return { ...msg, parts }
  })
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
    enabled: !!activeThreadId,
  })

  React.useEffect(() => {
    if (isStreaming) return

    const threadChanged = previousThreadIdRef.current !== activeThreadId
    previousThreadIdRef.current = activeThreadId

    if (activeThreadId && activeThreadDetail?.transcript) {
      const msgs =
        (activeThreadDetail.transcript as { messages?: ChatUIMessage[] })
          ?.messages || []

      if (threadChanged) {
        setLocalMessages(msgs)
      } else {
        setLocalMessages((current) => {
          if (msgs.length >= current.length) {
            return msgs
          }
          return current
        })
      }
    } else if (!activeThreadId) {
      setLocalMessages([])
    }
  }, [activeThreadDetail, isStreaming, activeThreadId, setLocalMessages])
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

  const [activeThreadId, setActiveThreadId] = React.useState<string | null>(
    null,
  )
  const [localMessages, setLocalMessages] = React.useState<ChatUIMessage[]>([])
  const [pendingQuestion, setPendingQuestion] =
    React.useState<AskUserToolPart | null>(null)
  const [threadDrafts, setThreadDrafts] = React.useState<
    Record<string, string>
  >({})
  const initialLoadedRef = React.useRef(false)

  React.useEffect(() => {
    if (threads.length > 0 && !initialLoadedRef.current) {
      setActiveThreadId(threads[0].id)
      initialLoadedRef.current = true
    }
  }, [threads])

  useThreadTranscript({ activeThreadId, isStreaming, setLocalMessages })

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

  const createThreadMutation = useMutation({
    mutationFn: (prompt?: string) =>
      AiThreadsService.createChatThread({
        requestBody: { origin: "composer", prompt },
      }),
    onSuccess: (newThread) => {
      queryClient.invalidateQueries({ queryKey: ["ai-threads"] })
      setActiveThreadId(newThread.id)
    },
  })

  const handleSendMessage = React.useCallback(
    (text: string) => {
      if (!text.trim() || isStreaming) return

      clearThreadDraft(activeThreadId)
      const { userMsg, assistantMsg } = createMessageTurn(text)
      setLocalMessages((prev) => [...prev, userMsg, assistantMsg])
      setPendingQuestion(null)

      async function execute() {
        let targetThreadId = activeThreadId
        if (!targetThreadId) {
          try {
            const newThread = await createThreadMutation.mutateAsync(
              text.trim(),
            )
            targetThreadId = newThread.id
            setActiveThreadId(newThread.id)
          } catch {
            return
          }
        }

        startStream(
          targetThreadId,
          text.trim(),
          {
            onThought: (content) =>
              setLocalMessages((prev) =>
                updateAssistantPart(prev, assistantMsg.id, "thought", content),
              ),
            onTextDelta: (delta) =>
              setLocalMessages((prev) =>
                updateAssistantPart(prev, assistantMsg.id, "text", delta),
              ),
            onDone: () => {
              queryClient.invalidateQueries({ queryKey: ["ai-threads"] })
              queryClient.invalidateQueries({
                queryKey: ["ai-thread", targetThreadId],
              })
            },
          },
          selectedModelId,
        )
      }

      execute()
    },
    [
      activeThreadId,
      clearThreadDraft,
      isStreaming,
      createThreadMutation,
      selectedModelId,
      startStream,
      queryClient,
    ],
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
