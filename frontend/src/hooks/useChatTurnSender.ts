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
import { ensureMessageParentIds } from "@/hooks/useTranscriptTree"
import type { ObservationPacket } from "@/observation/packet"
import {
  attachBrowserActivity,
  updateBrowserActivity,
} from "@/observation/reading/activity"
import type {
  BrowserActivityEvent,
  PreparedBrowserQuestion,
} from "@/observation/reading/types"

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
  parentMsgId?: string | null
}

export function createMessageTurn({
  text,
  imageUrls = [],
  assistantStatus = "streaming",
  parentMsgId = null,
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
    parentId: parentMsgId,
    parts,
    createdAt: new Date().toISOString(),
  }

  const assistantMsg: ChatUIMessage = {
    id: `local_assistant_${Date.now() + 1}_${Math.random().toString(36).slice(2, 6)}`,
    role: "assistant",
    parentId: userMsg.id,
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

function extractArtifactPostId(
  part: ChatUIMessage["parts"][number],
): string | null {
  if (part.type !== "draft_artifact") return null
  const art = (part as any).artifact || part
  return (art.id || art.postId || (part as any).post_id || null) as
    | string
    | null
}

function mergeArtifactIntoParts(
  existingParts: ChatUIMessage["parts"],
  artifactPart: ChatUIMessage["parts"][number],
): ChatUIMessage["parts"] {
  if (artifactPart.type !== "draft_artifact") {
    return [...existingParts, artifactPart]
  }
  const targetId = extractArtifactPostId(artifactPart)
  const existingIdx = existingParts.findIndex((p) => {
    if (p.type !== "draft_artifact") return false
    const existingId = extractArtifactPostId(p)
    if (targetId && existingId) return targetId === existingId
    return true
  })
  if (existingIdx === -1) {
    return [...existingParts, artifactPart]
  }
  const updated = [...existingParts]
  updated[existingIdx] = artifactPart
  return updated
}

export function appendAssistantArtifact({
  messages,
  assistantMsgId,
  artifactPart,
}: AppendAssistantArtifactOptions): ChatUIMessage[] {
  return messages.map((msg) => {
    if (msg.id !== assistantMsgId) return msg
    return {
      ...msg,
      parts: mergeArtifactIntoParts(msg.parts, artifactPart),
    }
  })
}

export interface HandlerFactoryOptions {
  assistantMsgId: string
  targetThreadId: string
  setMessagesByThread: React.Dispatch<
    React.SetStateAction<Record<string, ChatUIMessage[]>>
  >
}

function hasMessageContent(m: ChatUIMessage): boolean {
  if (hasBrowserActivityContent(m)) return true
  return m.parts.some((p) => {
    if (p.type === "text") return Boolean(p.text?.trim())
    return true
  })
}

function hasBrowserActivityContent(m: ChatUIMessage): boolean {
  const activity = m.browserActivity
  if (!activity) return false
  return Boolean(
    activity.steps.length || activity.tools?.length || activity.warning,
  )
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
        [targetThreadId]: msgs
          .map((m) => {
            if (m.id !== assistantMsgId) return m
            return {
              ...m,
              status: "done" as const,
              interrupted: true,
            }
          })
          .filter((m) => {
            if (m.id !== assistantMsgId) return true
            return hasMessageContent(m)
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

function createBrowserActivityHandler({
  assistantMsgId,
  targetThreadId,
  setMessagesByThread,
}: HandlerFactoryOptions) {
  return (event: BrowserActivityEvent) =>
    setMessagesByThread((prev) => ({
      ...prev,
      [targetThreadId]: (prev[targetThreadId] ?? []).map((message) =>
        message.id === assistantMsgId
          ? {
              ...message,
              browserActivity: updateBrowserActivity({
                activity: message.browserActivity,
                event,
              }),
            }
          : message,
      ),
    }))
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
    onBrowserActivity: createBrowserActivityHandler(options),
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
  onThreadCreated?: (id: string) => unknown
}

export async function resolveTargetThreadId({
  activeThreadId,
  promptText,
  createThreadMutation,
  setActiveThreadId,
  onThreadCreated,
}: ResolveTargetThreadOptions): Promise<string | null> {
  if (activeThreadId) return activeThreadId
  try {
    const newThread = await createThreadMutation.mutateAsync(promptText)
    const accepted = onThreadCreated?.(newThread.id)
    if (accepted === false) return null
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
  setActiveLeafIdByThread?: React.Dispatch<
    React.SetStateAction<Record<string, string | null>>
  >
  setMessagesByThread: React.Dispatch<
    React.SetStateAction<Record<string, ChatUIMessage[]>>
  >
  setPendingQuestion: (q: AskUserToolPart | null) => void
  clearThreadDraft: (id: string | null) => void
  setThreadDraft?: (id: string | null, text: string) => void
  clearMatchingDraft?: (
    id: string | null,
    text: string,
  ) => ThreadDraftRecoveryToken | null
  restoreDraftIfEmpty?: (
    id: string | null,
    recovery: ThreadDraftRecoveryToken | null,
  ) => void
  createThreadMutation: ReturnType<
    typeof useMutation<ChatThreadPublic, Error, string | undefined>
  >
  enqueueTurn: (turn: QueuedTurn) => void
  processQueue: () => void
}

export type ThreadCreatedCallback = (threadId: string) => unknown

export interface ThreadDraftRecoveryToken {
  revision: number
  text: string
}

export interface ApplyOptimisticTurnOptions {
  messages: ChatUIMessage[]
  userMsg: ChatUIMessage
  assistantMsg: ChatUIMessage
  editMessageId?: string
}

export function applyOptimisticTurn({
  messages,
  userMsg,
  assistantMsg,
  editMessageId,
}: ApplyOptimisticTurnOptions): ChatUIMessage[] {
  const normalized = ensureMessageParentIds(messages)
  if (!editMessageId) {
    const lastMsg = normalized[normalized.length - 1]
    userMsg.parentId = userMsg.parentId ?? (lastMsg ? lastMsg.id : null)
    assistantMsg.parentId = userMsg.id
    return [...normalized, userMsg, assistantMsg]
  }

  const target = normalized.find((m) => m.id === editMessageId)
  if (!target) {
    return [...normalized, userMsg, assistantMsg]
  }

  if (target.role === "user") {
    userMsg.parentId = target.parentId ?? null
    userMsg.forkedFromId = target.id
    assistantMsg.parentId = userMsg.id
    return [...normalized, userMsg, assistantMsg]
  }

  // Assistant regeneration or retry - create sibling assistant turn
  assistantMsg.parentId = target.parentId ?? null
  return [...normalized, assistantMsg]
}

interface DispatchTurnOptions {
  onQueued?: () => void
  onAcknowledged?: (accepted: boolean) => void
  targetThreadId: string
  promptText: string
  base64Images: string[]
  selectedModelId: string
  assistantMsg: ChatUIMessage
  userMsg: ChatUIMessage
  editMessageId?: string
  observation?: Readonly<ObservationPacket>
  browserQuestion?: PreparedBrowserQuestion
  setActiveLeafIdByThread?: React.Dispatch<
    React.SetStateAction<Record<string, string | null>>
  >
  setMessagesByThread: React.Dispatch<
    React.SetStateAction<Record<string, ChatUIMessage[]>>
  >
  setPendingQuestion: (q: AskUserToolPart | null) => void
  enqueueTurn: (turn: QueuedTurn) => void
  processQueue: () => void
}

function dispatchQueuedTurn({
  onQueued,
  onAcknowledged,
  targetThreadId,
  promptText,
  base64Images,
  selectedModelId,
  assistantMsg,
  userMsg,
  editMessageId,
  observation,
  browserQuestion,
  setActiveLeafIdByThread,
  setMessagesByThread,
  setPendingQuestion,
  enqueueTurn,
  processQueue,
}: DispatchTurnOptions) {
  setMessagesByThread((prev) => ({
    ...prev,
    [targetThreadId]: applyOptimisticTurn({
      messages: prev[targetThreadId] ?? [],
      userMsg,
      assistantMsg,
      editMessageId,
    }),
  }))
  setActiveLeafIdByThread?.((prev) => ({
    ...prev,
    [targetThreadId]: assistantMsg.id,
  }))
  setPendingQuestion(null)

  const queuedTurn: QueuedTurn = {
    id: `queue_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    threadId: targetThreadId,
    promptText,
    base64Images: base64Images.length > 0 ? base64Images : undefined,
    selectedModelId,
    assistantMsgId: assistantMsg.id,
    editMessageId,
    ...(observation ? { observation } : {}),
    ...(browserQuestion ? { browserQuestion } : {}),
    ...(browserQuestion ? { requestId: browserQuestion.operation_id } : {}),
    onAcknowledged,
  }

  enqueueTurn(queuedTurn)
  onQueued?.()
  processQueue()
}

interface ExecuteSendOptions extends UseChatTurnSenderProps {
  text: string
  attachedImages?: File[]
  editMessageId?: string
  targetThreadIdOverride?: string
  onThreadCreated?: ThreadCreatedCallback
  observation?: Readonly<ObservationPacket>
  browserQuestion?: PreparedBrowserQuestion
  isResolvingThreadRef: React.MutableRefObject<boolean>
}

interface ResolvedSend {
  targetThreadId: string
  sourceThreadId: string | null
  promptText: string
  base64Images: string[]
}

async function resolveSend(
  options: ExecuteSendOptions,
): Promise<ResolvedSend | null> {
  const base64Images = await convertFilesToDataUrls(options.attachedImages)
  const hasImages = Boolean(options.attachedImages?.length)
  const promptText = resolvePromptText({
    trimmedText: options.text.trim(),
    hasImages,
  })
  const sourceThreadId =
    options.targetThreadIdOverride ?? options.activeThreadId
  const targetThreadId = await resolveTargetThreadId({
    activeThreadId: sourceThreadId,
    promptText,
    createThreadMutation: options.createThreadMutation,
    setActiveThreadId: options.setActiveThreadId,
    onThreadCreated: options.onThreadCreated,
  })
  if (!targetThreadId) return null
  return {
    targetThreadId,
    sourceThreadId,
    promptText,
    base64Images,
  }
}

function prepareSendDraft(options: ExecuteSendOptions, send: ResolvedSend) {
  if (!options.browserQuestion) {
    if (!options.editMessageId) options.clearThreadDraft(send.sourceThreadId)
    return
  }
  if (send.targetThreadId !== send.sourceThreadId)
    options.setThreadDraft?.(send.targetThreadId, send.promptText)
}

interface BrowserDraftLifecycleOptions {
  browserQuestion?: PreparedBrowserQuestion
  sourceThreadId: string | null
  targetThreadId: string
  promptText: string
  clearMatchingDraft?: UseChatTurnSenderProps["clearMatchingDraft"]
  restoreDraftIfEmpty?: UseChatTurnSenderProps["restoreDraftIfEmpty"]
}

interface BrowserDraftLifecycle {
  onQueued?: () => void
  onAcknowledged?: (accepted: boolean) => void
}

function createBrowserDraftLifecycle(
  options: BrowserDraftLifecycleOptions,
): BrowserDraftLifecycle {
  if (!options.browserQuestion) return {}
  let settled = false
  let recovery: ThreadDraftRecoveryToken | null = null
  return {
    onQueued: () => {
      recovery =
        options.clearMatchingDraft?.(
          options.targetThreadId,
          options.promptText,
        ) ?? null
      if (options.sourceThreadId !== options.targetThreadId)
        options.clearMatchingDraft?.(options.sourceThreadId, options.promptText)
    },
    onAcknowledged: (accepted) => {
      if (settled) return
      settled = true
      if (accepted) return
      options.restoreDraftIfEmpty?.(options.targetThreadId, recovery)
    },
  }
}

function dispatchResolvedSend(options: ExecuteSendOptions, send: ResolvedSend) {
  const isBusy = options.isStreaming || options.streamingThreadId !== null
  const turn = createMessageTurn({
    text: send.promptText,
    imageUrls: send.base64Images,
    assistantStatus: isBusy ? "queued" : "streaming",
  })
  const { userMsg, assistantMsg } = attachBrowserActivity({
    turn,
    question: options.browserQuestion,
  })
  const draftLifecycle = createBrowserDraftLifecycle({
    browserQuestion: options.browserQuestion,
    sourceThreadId: send.sourceThreadId,
    targetThreadId: send.targetThreadId,
    promptText: send.promptText,
    clearMatchingDraft: options.clearMatchingDraft,
    restoreDraftIfEmpty: options.restoreDraftIfEmpty,
  })
  dispatchQueuedTurn({
    onQueued: draftLifecycle.onQueued,
    targetThreadId: send.targetThreadId,
    promptText: send.promptText,
    base64Images: send.base64Images,
    selectedModelId: options.browserQuestion?.model ?? options.selectedModelId,
    assistantMsg,
    userMsg,
    editMessageId: options.editMessageId,
    observation: options.observation,
    browserQuestion: options.browserQuestion,
    onAcknowledged: draftLifecycle.onAcknowledged,
    setActiveLeafIdByThread: options.setActiveLeafIdByThread,
    setMessagesByThread: options.setMessagesByThread,
    setPendingQuestion: options.setPendingQuestion,
    enqueueTurn: options.enqueueTurn,
    processQueue: options.processQueue,
  })
}

async function executeChatTurnSend(
  options: ExecuteSendOptions,
): Promise<boolean> {
  const hasImages = Boolean(options.attachedImages?.length)
  if (shouldSkipMessageSend({ trimmedText: options.text.trim(), hasImages }))
    return false
  if (options.isResolvingThreadRef.current) return false
  options.isResolvingThreadRef.current = true
  try {
    const send = await resolveSend(options)
    if (!send) return false
    prepareSendDraft(options, send)
    dispatchResolvedSend(options, send)
    options.isResolvingThreadRef.current = false
    return true
  } finally {
    options.isResolvingThreadRef.current = false
  }
}

export interface ChatTurnOptions {
  targetThreadIdOverride?: string
  onThreadCreated?: ThreadCreatedCallback
  observation?: Readonly<ObservationPacket>
  browserQuestion?: PreparedBrowserQuestion
}

export type ChatTurnSender = (
  text: string,
  attachedImages?: File[],
  editMessageId?: string,
  options?: ChatTurnOptions,
) => Promise<boolean>

export function useChatTurnSender(props: UseChatTurnSenderProps) {
  const isResolvingThreadRef = React.useRef(false)

  return React.useCallback(
    (
      text: string,
      attachedImages?: File[],
      editMessageId?: string,
      options?: ChatTurnOptions,
    ) =>
      executeChatTurnSend({
        ...props,
        text,
        attachedImages,
        editMessageId,
        ...options,
        isResolvingThreadRef,
      }),
    [props],
  )
}
