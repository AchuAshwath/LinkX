import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import * as React from "react"
import { AiThreadsService, type ChatThreadPublic } from "@/client"
import type {
  AskUserAnswer,
  AskUserToolPart,
  ChatUIMessage,
} from "@/components/Chat/types"
import { useAIChatStream } from "@/hooks/useAIChatStream"

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
  const initialLoadedRef = React.useRef(false)

  React.useEffect(() => {
    if (threads.length > 0 && !initialLoadedRef.current) {
      setActiveThreadId(threads[0].id)
      initialLoadedRef.current = true
    }
  }, [threads])

  const { data: activeThreadDetail } = useQuery({
    queryKey: ["ai-thread", activeThreadId],
    queryFn: () => AiThreadsService.getChatThread({ id: activeThreadId! }),
    enabled: !!activeThreadId,
  })

  React.useEffect(() => {
    if (!isStreaming) {
      if (activeThreadId && activeThreadDetail?.transcript) {
        const msgs =
          (activeThreadDetail.transcript as { messages?: ChatUIMessage[] })
            ?.messages || []
        setLocalMessages(msgs)
      } else if (!activeThreadId) {
        setLocalMessages([])
      }
    }
  }, [activeThreadDetail, isStreaming, activeThreadId])

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

      const userMsg: ChatUIMessage = {
        id: `local-user-${Date.now()}`,
        role: "user",
        parts: [{ type: "text", text: text.trim() }],
        createdAt: new Date().toISOString(),
      }

      const assistantMsgId = `local-assistant-${Date.now()}`
      const assistantMsg: ChatUIMessage = {
        id: assistantMsgId,
        role: "assistant",
        parts: [],
        createdAt: new Date().toISOString(),
      }

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
            onThought: (content) => {
              setLocalMessages((prev) =>
                prev.map((msg) => {
                  if (msg.id !== assistantMsgId) return msg
                  const parts = [...msg.parts]
                  const lastPart = parts[parts.length - 1]
                  if (lastPart && lastPart.type === "thought") {
                    lastPart.content += content
                  } else {
                    parts.push({ type: "thought", content })
                  }
                  return { ...msg, parts }
                }),
              )
            },
            onTextDelta: (delta) => {
              setLocalMessages((prev) =>
                prev.map((msg) => {
                  if (msg.id !== assistantMsgId) return msg
                  const parts = [...msg.parts]
                  const lastPart = parts[parts.length - 1]
                  if (lastPart && lastPart.type === "text") {
                    lastPart.text += delta
                  } else {
                    parts.push({ type: "text", text: delta })
                  }
                  return { ...msg, parts }
                }),
              )
            },
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
    isStreaming,
    stopStream,
    handleSendMessage,
    handleQuestionAnswer,
    handleNewChat,
  }
}
