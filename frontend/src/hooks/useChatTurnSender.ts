import type { useMutation, useQueryClient } from "@tanstack/react-query"
import * as React from "react"
import type { ChatThreadPublic } from "@/client"
import type {
  AskUserToolPart,
  ChatUIMessage,
  DraftArtifact,
  QueuedTurn,
  ToolCallItem,
  TrendingArtifact,
} from "@/components/Chat/types"

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export async function convertFilesToDataUrls(
  files?: File[],
): Promise<string[]> {
  if (!files || files.length === 0) return []
  try {
    return await Promise.all(files.map(fileToDataUrl))
  } catch {
    return []
  }
}

export function createMessageTurn(
  text: string,
  imageUrls: string[] = [],
  assistantStatus: "queued" | "streaming" = "streaming",
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
    id: `local_user_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    role: "user",
    parts,
    createdAt: new Date().toISOString(),
  }

  const assistantMsg: ChatUIMessage = {
    id: `local_assistant_${Date.now() + 1}_${Math.random().toString(36).slice(2, 6)}`,
    role: "assistant",
    parts: [],
    status: assistantStatus,
    createdAt: new Date().toISOString(),
  }

  return { userMsg, assistantMsg }
}

export function updateAssistantPart(
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

export function updateAssistantToolStart(
  messages: ChatUIMessage[],
  assistantMsgId: string,
  name: string,
  input: unknown,
): ChatUIMessage[] {
  return messages.map((msg) => {
    if (msg.id !== assistantMsgId) return msg
    const parts = [...msg.parts]
    const toolItem: ToolCallItem = {
      id: `tool_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name,
      state: "running",
      input: input as Record<string, unknown>,
    }
    parts.push({
      type: "tool-call",
      toolCallId: toolItem.id,
      name,
      state: "running",
      tool: toolItem,
      input: input as Record<string, unknown>,
    })
    return { ...msg, parts }
  })
}

export function updateAssistantToolOutput(
  messages: ChatUIMessage[],
  assistantMsgId: string,
  name: string,
  output: unknown,
): ChatUIMessage[] {
  return messages.map((msg) => {
    if (msg.id !== assistantMsgId) return msg
    const parts = [...msg.parts]
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i]
      if (
        (p.type === "tool-call" ||
          (p as { type: string }).type === "tool_call") &&
        (p as { name?: string }).name === name &&
        (p as { state?: string }).state === "running"
      ) {
        const prevTool = (p as { tool?: ToolCallItem }).tool
        const updatedTool: ToolCallItem = {
          id:
            (p as { toolCallId?: string }).toolCallId ||
            prevTool?.id ||
            `tool_${Date.now()}`,
          name,
          state: "completed",
          input:
            prevTool?.input || (p as { input?: Record<string, unknown> }).input,
          output: output as Record<string, unknown>,
        }
        parts[i] = {
          type: "tool-call",
          toolCallId: updatedTool.id,
          name,
          state: "completed",
          tool: updatedTool,
          input: updatedTool.input,
          output: updatedTool.output,
        }
        break
      }
    }
    return { ...msg, parts }
  })
}

export function appendAssistantArtifact(
  messages: ChatUIMessage[],
  assistantMsgId: string,
  artifactPart: ChatUIMessage["parts"][number],
): ChatUIMessage[] {
  return messages.map((msg) => {
    if (msg.id !== assistantMsgId) return msg
    return { ...msg, parts: [...msg.parts, artifactPart] }
  })
}

export function buildStreamHandlers({
  assistantMsgId,
  targetThreadId,
  setMessagesByThread,
  queryClient,
}: {
  assistantMsgId: string
  targetThreadId: string
  setMessagesByThread: React.Dispatch<
    React.SetStateAction<Record<string, ChatUIMessage[]>>
  >
  queryClient: ReturnType<typeof useQueryClient>
}) {
  return {
    onThought: (content: string) =>
      setMessagesByThread((prev) => ({
        ...prev,
        [targetThreadId]: updateAssistantPart(
          prev[targetThreadId] ?? [],
          assistantMsgId,
          "thought",
          content,
        ),
      })),
    onTextDelta: (delta: string) =>
      setMessagesByThread((prev) => ({
        ...prev,
        [targetThreadId]: updateAssistantPart(
          prev[targetThreadId] ?? [],
          assistantMsgId,
          "text",
          delta,
        ),
      })),
    onToolStart: (name: string, input: unknown) =>
      setMessagesByThread((prev) => ({
        ...prev,
        [targetThreadId]: updateAssistantToolStart(
          prev[targetThreadId] ?? [],
          assistantMsgId,
          name,
          input,
        ),
      })),
    onToolOutput: (name: string, output: unknown) =>
      setMessagesByThread((prev) => ({
        ...prev,
        [targetThreadId]: updateAssistantToolOutput(
          prev[targetThreadId] ?? [],
          assistantMsgId,
          name,
          output,
        ),
      })),
    onTrendingArtifact: (artifact: TrendingArtifact) =>
      setMessagesByThread((prev) => ({
        ...prev,
        [targetThreadId]: appendAssistantArtifact(
          prev[targetThreadId] ?? [],
          assistantMsgId,
          {
            type: "trending_artifact",
            artifact,
          },
        ),
      })),
    onDraftArtifact: (artifact: DraftArtifact) =>
      setMessagesByThread((prev) => ({
        ...prev,
        [targetThreadId]: appendAssistantArtifact(
          prev[targetThreadId] ?? [],
          assistantMsgId,
          {
            type: "draft_artifact",
            artifact,
          },
        ),
      })),
    onError: (errMsg: string) =>
      setMessagesByThread((prev) => {
        const msgs = prev[targetThreadId] ?? []
        const updated = updateAssistantPart(
          msgs,
          assistantMsgId,
          "text",
          `\n\n*(Error: ${errMsg})*`,
        )
        return {
          ...prev,
          [targetThreadId]: updated.map((m) =>
            m.id === assistantMsgId ? { ...m, status: "error" as const } : m,
          ),
        }
      }),
    onAbort: () =>
      setMessagesByThread((prev) => {
        const msgs = prev[targetThreadId] ?? []
        return {
          ...prev,
          [targetThreadId]: msgs.map((m) => {
            if (m.id !== assistantMsgId) return m
            const hasContent = m.parts.length > 0
            if (!hasContent) {
              return {
                ...m,
                status: "done" as const,
                parts: [
                  { type: "text" as const, text: "*(Generation stopped)*" },
                ],
              }
            }
            return { ...m, status: "done" as const }
          }),
        }
      }),
    onDone: () => {
      setMessagesByThread((prev) => {
        const msgs = prev[targetThreadId] ?? []
        return {
          ...prev,
          [targetThreadId]: msgs.map((m) =>
            m.id === assistantMsgId ? { ...m, status: "done" as const } : m,
          ),
        }
      })
      queryClient.invalidateQueries({ queryKey: ["ai-threads"] })
      queryClient.invalidateQueries({
        queryKey: ["ai-thread", targetThreadId],
      })
    },
  }
}

export async function resolveTargetThreadId(
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

export function resolvePromptText(
  trimmedText: string,
  hasImages: boolean,
): string {
  if (trimmedText) return trimmedText
  return hasImages ? "Analyze the attached image(s)" : ""
}

export function shouldSkipMessageSend(
  trimmedText: string,
  hasImages: boolean,
): boolean {
  return !trimmedText && !hasImages
}

export interface UseChatTurnSenderProps {
  activeThreadId: string | null
  selectedModelId: string
  isStreaming: boolean
  streamingThreadId: string | null
  setActiveThreadId: (id: string) => void
  setMessagesByThread: React.Dispatch<
    React.SetStateAction<Record<string, ChatUIMessage[]>>
  >
  setPendingQuestion: (q: AskUserToolPart | null) => void
  clearThreadDraft: (id: string | null) => void
  createThreadMutation: ReturnType<
    typeof useMutation<ChatThreadPublic, Error, string | undefined>
  >
  enqueueTurn: (turn: QueuedTurn) => void
  processQueue: () => void
}

export function useChatTurnSender(props: UseChatTurnSenderProps) {
  const {
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
  } = props

  const isResolvingThreadRef = React.useRef(false)

  return React.useCallback(
    async (text: string, attachedImages?: File[]) => {
      const trimmedText = text.trim()
      const hasImages = Boolean(attachedImages && attachedImages.length > 0)
      if (shouldSkipMessageSend(trimmedText, hasImages)) return

      if (isResolvingThreadRef.current) return
      isResolvingThreadRef.current = true

      try {
        const base64Images = await convertFilesToDataUrls(attachedImages)
        const promptText = resolvePromptText(trimmedText, hasImages)
        const targetThreadId = await resolveTargetThreadId(
          activeThreadId,
          promptText,
          createThreadMutation,
          setActiveThreadId,
        )
        if (!targetThreadId) return

        clearThreadDraft(activeThreadId)

        const isBusy = isStreaming || streamingThreadId !== null
        const assistantStatus = isBusy ? "queued" : "streaming"

        const { userMsg, assistantMsg } = createMessageTurn(
          promptText,
          base64Images,
          assistantStatus,
        )

        setMessagesByThread((prev) => ({
          ...prev,
          [targetThreadId]: [
            ...(prev[targetThreadId] ?? []),
            userMsg,
            assistantMsg,
          ],
        }))
        setPendingQuestion(null)

        const queuedTurn: QueuedTurn = {
          id: `queue_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          threadId: targetThreadId,
          promptText,
          base64Images: base64Images.length > 0 ? base64Images : undefined,
          selectedModelId,
          assistantMsgId: assistantMsg.id,
        }

        enqueueTurn(queuedTurn)
        processQueue()
      } finally {
        isResolvingThreadRef.current = false
      }
    },
    [
      activeThreadId,
      clearThreadDraft,
      createThreadMutation,
      enqueueTurn,
      isStreaming,
      processQueue,
      selectedModelId,
      setActiveThreadId,
      setMessagesByThread,
      setPendingQuestion,
      streamingThreadId,
    ],
  )
}
