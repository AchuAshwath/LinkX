import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import * as React from "react"
import { AiThreadsService, type ChatThreadPublic } from "@/client"
import type {
  AskUserAnswer,
  AskUserToolPart,
  ChatUIMessage,
} from "@/components/Chat/types"
import { useAIChatStream } from "@/hooks/useAIChatStream"

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function createMessageTurn(
  text: string,
  imageUrls: string[] = [],
): {
  userMsg: ChatUIMessage
  assistantMsg: ChatUIMessage
} {
  const parts: ChatUIMessage["parts"] = []
  if (text.trim()) {
    parts.push({ type: "text", text: text.trim() })
  }
  for (const url of imageUrls) {
    parts.push({ type: "image_url", url })
  }

  const userMsg: ChatUIMessage = {
    id: `local-user-${Date.now()}`,
    role: "user",
    parts,
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

async function convertFilesToDataUrls(files?: File[]): Promise<string[]> {
  if (!files || files.length === 0) return []
  try {
    return await Promise.all(files.map(fileToDataUrl))
  } catch {
    return []
  }
}

function buildStreamHandlers({
  assistantMsgId,
  targetThreadId,
  setLocalMessages,
  queryClient,
}: {
  assistantMsgId: string
  targetThreadId: string
  setLocalMessages: React.Dispatch<React.SetStateAction<ChatUIMessage[]>>
  queryClient: ReturnType<typeof useQueryClient>
}) {
  return {
    onThought: (content: string) =>
      setLocalMessages((prev) =>
        updateAssistantPart(prev, assistantMsgId, "thought", content),
      ),
    onTextDelta: (delta: string) =>
      setLocalMessages((prev) =>
        updateAssistantPart(prev, assistantMsgId, "text", delta),
      ),
    onDone: () => {
      queryClient.invalidateQueries({ queryKey: ["ai-threads"] })
      queryClient.invalidateQueries({
        queryKey: ["ai-thread", targetThreadId],
      })
    },
  }
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

function useChatTurnSender({
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
}: {
  activeThreadId: string | null
  selectedModelId: string
  isStreaming: boolean
  setActiveThreadId: (id: string) => void
  setLocalMessages: React.Dispatch<React.SetStateAction<ChatUIMessage[]>>
  setPendingQuestion: (q: AskUserToolPart | null) => void
  clearThreadDraft: (id: string | null) => void
  createThreadMutation: ReturnType<
    typeof useMutation<ChatThreadPublic, Error, string | undefined>
  >
  startStream: ReturnType<typeof useAIChatStream>["startStream"]
  queryClient: ReturnType<typeof useQueryClient>
}) {
  return React.useCallback(
    async (text: string, attachedImages?: File[]) => {
      const trimmedText = text.trim()
      const hasImages = Boolean(attachedImages && attachedImages.length > 0)
      if ((!trimmedText && !hasImages) || isStreaming) return

      const base64Images = await convertFilesToDataUrls(attachedImages)
      clearThreadDraft(activeThreadId)
      const promptText =
        trimmedText || (hasImages ? "Analyze the attached image(s)" : "")
      const { userMsg, assistantMsg } = createMessageTurn(
        promptText,
        base64Images,
      )
      setLocalMessages((prev) => [...prev, userMsg, assistantMsg])
      setPendingQuestion(null)

      let targetThreadId = activeThreadId
      if (!targetThreadId) {
        try {
          const newThread = await createThreadMutation.mutateAsync(promptText)
          targetThreadId = newThread.id
          setActiveThreadId(newThread.id)
        } catch {
          return
        }
      }

      const handlers = buildStreamHandlers({
        assistantMsgId: assistantMsg.id,
        targetThreadId,
        setLocalMessages,
        queryClient,
      })

      startStream(
        targetThreadId,
        promptText,
        handlers,
        selectedModelId,
        base64Images.length > 0 ? base64Images : undefined,
      )
    },
    [
      activeThreadId,
      clearThreadDraft,
      isStreaming,
      createThreadMutation,
      selectedModelId,
      startStream,
      queryClient,
      setActiveThreadId,
      setLocalMessages,
      setPendingQuestion,
    ],
  )
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
  const initialLoadedRef = React.useRef(false)

  React.useEffect(() => {
    if (threads.length > 0 && !initialLoadedRef.current) {
      setActiveThreadId(threads[0].id)
      initialLoadedRef.current = true
    }
  }, [threads])

  useThreadTranscript({ activeThreadId, isStreaming, setLocalMessages })

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
