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

export interface CreateMessageTurnOptions {
  text: string
  imageUrls?: string[]
  assistantStatus?: "queued" | "streaming"
}

export function createMessageTurn({
  text,
  imageUrls = [],
  assistantStatus = "streaming",
}: CreateMessageTurnOptions): {
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

export interface UpdateAssistantPartOptions {
  messages: ChatUIMessage[]
  assistantMsgId: string
  partType: "thought" | "text"
  content: string
}

function findLastPartIndex(
  parts: ChatUIMessage["parts"],
  partType: string,
): number {
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i].type === partType) {
      return i
    }
  }
  return -1
}

function mergePartContent(
  existing: ChatUIMessage["parts"][number],
  partType: "thought" | "text",
  content: string,
): ChatUIMessage["parts"][number] {
  if (partType === "thought" && existing.type === "thought") {
    return { ...existing, content: existing.content + content }
  }
  if (partType === "text" && existing.type === "text") {
    return { ...existing, text: existing.text + content }
  }
  return existing
}

function createNewPart(
  partType: "thought" | "text",
  content: string,
): ChatUIMessage["parts"][number] {
  if (partType === "thought") {
    return { type: "thought", content }
  }
  return { type: "text", text: content }
}

function updateMessageParts(
  parts: ChatUIMessage["parts"],
  partType: "thought" | "text",
  content: string,
): ChatUIMessage["parts"] {
  const updated = [...parts]
  const existingIndex = findLastPartIndex(updated, partType)
  if (existingIndex >= 0) {
    updated[existingIndex] = mergePartContent(
      updated[existingIndex],
      partType,
      content,
    )
  } else {
    updated.push(createNewPart(partType, content))
  }
  return updated
}

export function updateAssistantPart({
  messages,
  assistantMsgId,
  partType,
  content,
}: UpdateAssistantPartOptions): ChatUIMessage[] {
  return messages.map((msg) => {
    if (msg.id !== assistantMsgId) return msg
    return {
      ...msg,
      parts: updateMessageParts(msg.parts, partType, content),
    }
  })
}

export interface UpdateAssistantToolStartOptions {
  messages: ChatUIMessage[]
  assistantMsgId: string
  name: string
  input: unknown
}

export function updateAssistantToolStart({
  messages,
  assistantMsgId,
  name,
  input,
}: UpdateAssistantToolStartOptions): ChatUIMessage[] {
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

function isMatchingRunningTool(part: unknown, toolName: string): boolean {
  if (!part || typeof part !== "object") return false
  const p = part as { type?: string; name?: string; state?: string }
  if (p.name !== toolName) return false
  if (p.state !== "running") return false
  return p.type === "tool-call" || p.type === "tool_call"
}

function createCompletedToolPart(
  prevPart: unknown,
  name: string,
  output: unknown,
): ChatUIMessage["parts"][number] {
  const p = prevPart as {
    toolCallId?: string
    tool?: ToolCallItem
    input?: Record<string, unknown>
  }
  const updatedTool: ToolCallItem = {
    id: p.toolCallId || p.tool?.id || `tool_${Date.now()}`,
    name,
    state: "completed",
    input: p.tool?.input || p.input,
    output: output as Record<string, unknown>,
  }
  return {
    type: "tool-call",
    toolCallId: updatedTool.id,
    name,
    state: "completed",
    tool: updatedTool,
    input: updatedTool.input,
    output: updatedTool.output,
  }
}

export interface UpdateAssistantToolOutputOptions {
  messages: ChatUIMessage[]
  assistantMsgId: string
  name: string
  output: unknown
}

export function updateAssistantToolOutput({
  messages,
  assistantMsgId,
  name,
  output,
}: UpdateAssistantToolOutputOptions): ChatUIMessage[] {
  return messages.map((msg) => {
    if (msg.id !== assistantMsgId) return msg
    const parts = [...msg.parts]
    for (let i = parts.length - 1; i >= 0; i--) {
      if (isMatchingRunningTool(parts[i], name)) {
        parts[i] = createCompletedToolPart(parts[i], name, output)
        break
      }
    }
    return { ...msg, parts }
  })
}

export interface AppendAssistantArtifactOptions {
  messages: ChatUIMessage[]
  assistantMsgId: string
  artifactPart: ChatUIMessage["parts"][number]
}

export function appendAssistantArtifact({
  messages,
  assistantMsgId,
  artifactPart,
}: AppendAssistantArtifactOptions): ChatUIMessage[] {
  return messages.map((msg) => {
    if (msg.id !== assistantMsgId) return msg
    return { ...msg, parts: [...msg.parts, artifactPart] }
  })
}

export interface HandlerFactoryOptions {
  assistantMsgId: string
  targetThreadId: string
  setMessagesByThread: React.Dispatch<
    React.SetStateAction<Record<string, ChatUIMessage[]>>
  >
}

function createAbortHandler({
  assistantMsgId,
  targetThreadId,
  setMessagesByThread,
}: HandlerFactoryOptions) {
  return () =>
    setMessagesByThread((prev) => {
      const msgs = prev[targetThreadId] ?? []
      return {
        ...prev,
        [targetThreadId]: msgs.map((m) => {
          if (m.id !== assistantMsgId) return m
          const hasContent = m.parts.length > 0
          return {
            ...m,
            status: "done" as const,
            parts: hasContent
              ? m.parts
              : [{ type: "text" as const, text: "*(Generation stopped)*" }],
          }
        }),
      }
    })
}

function createDoneHandler({
  assistantMsgId,
  targetThreadId,
  setMessagesByThread,
  queryClient,
}: HandlerFactoryOptions & {
  queryClient: ReturnType<typeof useQueryClient>
}) {
  return () => {
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
  }
}

function createErrorHandler({
  assistantMsgId,
  targetThreadId,
  setMessagesByThread,
}: HandlerFactoryOptions) {
  return (errMsg: string) =>
    setMessagesByThread((prev) => {
      const msgs = prev[targetThreadId] ?? []
      const updated = updateAssistantPart({
        messages: msgs,
        assistantMsgId,
        partType: "text",
        content: `\n\n*(Error: ${errMsg})*`,
      })
      return {
        ...prev,
        [targetThreadId]: updated.map((m) =>
          m.id === assistantMsgId ? { ...m, status: "error" as const } : m,
        ),
      }
    })
}

function createContentHandlers({
  assistantMsgId,
  targetThreadId,
  setMessagesByThread,
}: HandlerFactoryOptions) {
  return {
    onThought: (content: string) =>
      setMessagesByThread((prev) => ({
        ...prev,
        [targetThreadId]: updateAssistantPart({
          messages: prev[targetThreadId] ?? [],
          assistantMsgId,
          partType: "thought",
          content,
        }),
      })),
    onTextDelta: (delta: string) =>
      setMessagesByThread((prev) => ({
        ...prev,
        [targetThreadId]: updateAssistantPart({
          messages: prev[targetThreadId] ?? [],
          assistantMsgId,
          partType: "text",
          content: delta,
        }),
      })),
    onToolStart: (name: string, input: unknown) =>
      setMessagesByThread((prev) => ({
        ...prev,
        [targetThreadId]: updateAssistantToolStart({
          messages: prev[targetThreadId] ?? [],
          assistantMsgId,
          name,
          input,
        }),
      })),
    onToolOutput: (name: string, output: unknown) =>
      setMessagesByThread((prev) => ({
        ...prev,
        [targetThreadId]: updateAssistantToolOutput({
          messages: prev[targetThreadId] ?? [],
          assistantMsgId,
          name,
          output,
        }),
      })),
    onTrendingArtifact: (artifact: TrendingArtifact) =>
      setMessagesByThread((prev) => ({
        ...prev,
        [targetThreadId]: appendAssistantArtifact({
          messages: prev[targetThreadId] ?? [],
          assistantMsgId,
          artifactPart: { type: "trending_artifact", artifact },
        }),
      })),
    onDraftArtifact: (artifact: DraftArtifact) =>
      setMessagesByThread((prev) => ({
        ...prev,
        [targetThreadId]: appendAssistantArtifact({
          messages: prev[targetThreadId] ?? [],
          assistantMsgId,
          artifactPart: { type: "draft_artifact", artifact },
        }),
      })),
  }
}

export function buildStreamHandlers(
  options: HandlerFactoryOptions & {
    queryClient: ReturnType<typeof useQueryClient>
  },
) {
  const contentHandlers = createContentHandlers(options)
  const onAbort = createAbortHandler(options)
  const onDone = createDoneHandler(options)
  const onError = createErrorHandler(options)

  return {
    ...contentHandlers,
    onError,
    onAbort,
    onDone,
  }
}

export interface ResolveTargetThreadOptions {
  activeThreadId: string | null
  promptText: string
  createThreadMutation: ReturnType<
    typeof useMutation<ChatThreadPublic, Error, string | undefined>
  >
  setActiveThreadId: (id: string) => void
}

export async function resolveTargetThreadId({
  activeThreadId,
  promptText,
  createThreadMutation,
  setActiveThreadId,
}: ResolveTargetThreadOptions): Promise<string | null> {
  if (activeThreadId) return activeThreadId
  try {
    const newThread = await createThreadMutation.mutateAsync(promptText)
    setActiveThreadId(newThread.id)
    return newThread.id
  } catch {
    return null
  }
}

export function resolvePromptText({
  trimmedText,
  hasImages,
}: {
  trimmedText: string
  hasImages: boolean
}): string {
  if (trimmedText) return trimmedText
  return hasImages ? "Analyze the attached image(s)" : ""
}

export function shouldSkipMessageSend({
  trimmedText,
  hasImages,
}: {
  trimmedText: string
  hasImages: boolean
}): boolean {
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

interface DispatchTurnOptions {
  targetThreadId: string
  promptText: string
  base64Images: string[]
  selectedModelId: string
  assistantMsg: ChatUIMessage
  userMsg: ChatUIMessage
  setMessagesByThread: React.Dispatch<
    React.SetStateAction<Record<string, ChatUIMessage[]>>
  >
  setPendingQuestion: (q: AskUserToolPart | null) => void
  enqueueTurn: (turn: QueuedTurn) => void
  processQueue: () => void
}

function dispatchQueuedTurn({
  targetThreadId,
  promptText,
  base64Images,
  selectedModelId,
  assistantMsg,
  userMsg,
  setMessagesByThread,
  setPendingQuestion,
  enqueueTurn,
  processQueue,
}: DispatchTurnOptions) {
  setMessagesByThread((prev) => ({
    ...prev,
    [targetThreadId]: [...(prev[targetThreadId] ?? []), userMsg, assistantMsg],
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
}

interface ExecuteSendOptions extends UseChatTurnSenderProps {
  text: string
  attachedImages?: File[]
  isResolvingThreadRef: React.MutableRefObject<boolean>
}

async function executeChatTurnSend(options: ExecuteSendOptions) {
  const trimmedText = options.text.trim()
  const hasImages = Boolean(
    options.attachedImages && options.attachedImages.length > 0,
  )
  if (shouldSkipMessageSend({ trimmedText, hasImages })) return

  if (options.isResolvingThreadRef.current) return
  options.isResolvingThreadRef.current = true

  try {
    const base64Images = await convertFilesToDataUrls(options.attachedImages)
    const promptText = resolvePromptText({ trimmedText, hasImages })
    const targetThreadId = await resolveTargetThreadId({
      activeThreadId: options.activeThreadId,
      promptText,
      createThreadMutation: options.createThreadMutation,
      setActiveThreadId: options.setActiveThreadId,
    })
    if (!targetThreadId) return

    options.clearThreadDraft(options.activeThreadId)

    const isBusy = options.isStreaming || options.streamingThreadId !== null
    const assistantStatus = isBusy ? "queued" : "streaming"

    const { userMsg, assistantMsg } = createMessageTurn({
      text: promptText,
      imageUrls: base64Images,
      assistantStatus,
    })

    dispatchQueuedTurn({
      targetThreadId,
      promptText,
      base64Images,
      selectedModelId: options.selectedModelId,
      assistantMsg,
      userMsg,
      setMessagesByThread: options.setMessagesByThread,
      setPendingQuestion: options.setPendingQuestion,
      enqueueTurn: options.enqueueTurn,
      processQueue: options.processQueue,
    })
  } finally {
    options.isResolvingThreadRef.current = false
  }
}

export function useChatTurnSender(props: UseChatTurnSenderProps) {
  const isResolvingThreadRef = React.useRef(false)

  return React.useCallback(
    (text: string, attachedImages?: File[]) =>
      executeChatTurnSend({
        ...props,
        text,
        attachedImages,
        isResolvingThreadRef,
      }),
    [props],
  )
}
