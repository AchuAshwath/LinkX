import type { useMutation, useQueryClient } from "@tanstack/react-query"
import * as React from "react"
import type { ChatThreadPublic } from "@/client"
import type { AskUserToolPart, ChatUIMessage } from "@/components/Chat/types"
import type { useAIChatStream } from "@/hooks/useAIChatStream"

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

async function convertFilesToDataUrls(files?: File[]): Promise<string[]> {
  if (!files || files.length === 0) return []
  try {
    return await Promise.all(files.map(fileToDataUrl))
  } catch {
    return []
  }
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
    id: `local_user_${Date.now()}`,
    role: "user",
    parts,
    createdAt: new Date().toISOString(),
  }

  const assistantMsg: ChatUIMessage = {
    id: `local_assistant_${Date.now() + 1}`,
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
  content: string,
): ChatUIMessage[] {
  return messages.map((msg) => {
    if (msg.id !== assistantMsgId) return msg
    const parts = [...msg.parts]
    let existingIndex = -1
    for (let i = parts.length - 1; i >= 0; i--) {
      if (parts[i].type === partType) {
        existingIndex = i
        break
      }
    }

    if (existingIndex >= 0) {
      const existing = parts[existingIndex]
      if (partType === "thought" && existing.type === "thought") {
        parts[existingIndex] = {
          ...existing,
          content: existing.content + content,
        }
      } else if (partType === "text" && existing.type === "text") {
        parts[existingIndex] = {
          ...existing,
          text: existing.text + content,
        }
      }
    } else {
      if (partType === "thought") {
        parts.push({ type: "thought", content })
      } else {
        parts.push({ type: "text", text: content })
      }
    }
    return { ...msg, parts }
  })
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

async function resolveTargetThreadId(
  activeThreadId: string | null,
  promptText: string,
  createThreadMutation: ReturnType<
    typeof useMutation<ChatThreadPublic, Error, string | undefined>
  >,
  setActiveThreadId: (id: string) => void,
): Promise<string | null> {
  if (activeThreadId) return activeThreadId
  try {
    const newThread = await createThreadMutation.mutateAsync(promptText)
    setActiveThreadId(newThread.id)
    return newThread.id
  } catch {
    return null
  }
}

function resolvePromptText(trimmedText: string, hasImages: boolean): string {
  if (trimmedText) return trimmedText
  return hasImages ? "Analyze the attached image(s)" : ""
}

function shouldSkipMessageSend(
  trimmedText: string,
  hasImages: boolean,
  isStreaming: boolean,
): boolean {
  if (isStreaming) return true
  return !trimmedText && !hasImages
}

export interface UseChatTurnSenderProps {
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
}

function appendOptimisticTurn(
  promptText: string,
  base64Images: string[],
  setLocalMessages: React.Dispatch<React.SetStateAction<ChatUIMessage[]>>,
  setPendingQuestion: (q: AskUserToolPart | null) => void,
): { assistantMsgId: string } {
  const { userMsg, assistantMsg } = createMessageTurn(promptText, base64Images)
  setLocalMessages((prev) => [...prev, userMsg, assistantMsg])
  setPendingQuestion(null)
  return { assistantMsgId: assistantMsg.id }
}

function sendTurnStream({
  assistantMsgId,
  targetThreadId,
  promptText,
  base64Images,
  selectedModelId,
  setLocalMessages,
  queryClient,
  startStream,
}: {
  assistantMsgId: string
  targetThreadId: string
  promptText: string
  base64Images: string[]
  selectedModelId: string
  setLocalMessages: React.Dispatch<React.SetStateAction<ChatUIMessage[]>>
  queryClient: ReturnType<typeof useQueryClient>
  startStream: ReturnType<typeof useAIChatStream>["startStream"]
}) {
  const handlers = buildStreamHandlers({
    assistantMsgId,
    targetThreadId,
    setLocalMessages,
    queryClient,
  })
  const imagesPayload = base64Images.length > 0 ? base64Images : undefined
  startStream(
    targetThreadId,
    promptText,
    handlers,
    selectedModelId,
    imagesPayload,
  )
}

export function useChatTurnSender(props: UseChatTurnSenderProps) {
  const {
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
  } = props

  return React.useCallback(
    async (text: string, attachedImages?: File[]) => {
      const trimmedText = text.trim()
      const hasImages = Boolean(attachedImages && attachedImages.length > 0)
      if (shouldSkipMessageSend(trimmedText, hasImages, isStreaming)) return

      const base64Images = await convertFilesToDataUrls(attachedImages)
      clearThreadDraft(activeThreadId)
      const promptText = resolvePromptText(trimmedText, hasImages)
      const { assistantMsgId } = appendOptimisticTurn(
        promptText,
        base64Images,
        setLocalMessages,
        setPendingQuestion,
      )

      const targetThreadId = await resolveTargetThreadId(
        activeThreadId,
        promptText,
        createThreadMutation,
        setActiveThreadId,
      )
      if (!targetThreadId) return

      sendTurnStream({
        assistantMsgId,
        targetThreadId,
        promptText,
        base64Images,
        selectedModelId,
        setLocalMessages,
        queryClient,
        startStream,
      })
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
