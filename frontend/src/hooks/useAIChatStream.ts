import * as React from "react"
import type { ChatMessageRequest, ObservationPacket } from "@/client"
import type { DraftArtifact, TrendingArtifact } from "@/components/Chat/types"
import {
  clearAuthAndRedirect,
  getStoredToken,
  isJwtExpired,
} from "@/utils/auth"

export interface StreamEventHandlers {
  onThought?: (content: string) => void
  onTextDelta?: (text: string) => void
  onToolStart?: (name: string, input: unknown) => void
  onToolOutput?: (name: string, output: unknown) => void
  onDraftArtifact?: (artifact: DraftArtifact) => void
  onTrendingArtifact?: (artifact: TrendingArtifact) => void
  onObservationUsage?: (usage: ObservationUsagePayload) => void
  onDone?: () => void
  onError?: (error: string) => void
  onAbort?: () => void
}

export interface ObservationUsagePayload {
  estimated_input_tokens: number
  input_limit: number
  output_reserve: number
  model_id: string
  frame_count: number
  history_frames: number
  revision: number
  source_epoch: number
  width: number
  height: number
  captured_at: string
  delivered_at: string
  frame_presented_at_ms: number | null
}

export interface ThreadObservationUsage {
  threadId: string
  data: ObservationUsagePayload
}

interface ParsedEventData {
  content?: string
  name?: string
  input?: unknown
  output?: unknown
  post_id?: string
  platform?: string
  message?: string
  topics?: unknown[]
  estimated_input_tokens?: number
  input_limit?: number
  output_reserve?: number
  model_id?: string
  frame_count?: number
  history_frames?: number
  revision?: number
  source_epoch?: number
  width?: number
  height?: number
  captured_at?: string
  delivered_at?: string
  frame_presented_at_ms?: number | null
}

type EventAction = (
  data: ParsedEventData,
  handlers: StreamEventHandlers,
) => void

const EVENT_ACTIONS: Record<string, EventAction> = {
  thought: (d, h) => h.onThought?.(d.content || ""),
  text_delta: (d, h) => h.onTextDelta?.(d.content || ""),
  tool_start: (d, h) => d.name && h.onToolStart?.(d.name, d.input),
  tool_output: (d, h) => d.name && h.onToolOutput?.(d.name, d.output),
  draft_artifact: (d, h) => h.onDraftArtifact?.(d as unknown as DraftArtifact),
  trending_artifact: (d, h) =>
    h.onTrendingArtifact?.(d as unknown as TrendingArtifact),
  observation_usage: (d, h) => h.onObservationUsage?.(readObservationUsage(d)),
  done: (_, h) => h.onDone?.(),
  error: (d, h) => h.onError?.(d.message || "Unknown stream error"),
}

function readObservationUsage(data: ParsedEventData): ObservationUsagePayload {
  return {
    estimated_input_tokens: data.estimated_input_tokens ?? 0,
    input_limit: data.input_limit ?? 0,
    output_reserve: data.output_reserve ?? 0,
    model_id: data.model_id ?? "",
    frame_count: data.frame_count ?? 0,
    history_frames: data.history_frames ?? 0,
    revision: data.revision ?? 0,
    source_epoch: data.source_epoch ?? 0,
    width: data.width ?? 0,
    height: data.height ?? 0,
    captured_at: data.captured_at ?? "",
    delivered_at: data.delivered_at ?? "",
    frame_presented_at_ms: data.frame_presented_at_ms ?? null,
  }
}

function parseDataLine(
  payload: string,
  eventType: string,
  handlers: StreamEventHandlers,
) {
  try {
    const parsed = JSON.parse(payload) as ParsedEventData
    EVENT_ACTIONS[eventType]?.(parsed, handlers)
  } catch {
    // Non-JSON payload ignored
  }
}

function processSSELine(
  line: string,
  currentEvent: string,
  handlers: StreamEventHandlers,
): string {
  const trimmed = line.trim()
  if (!trimmed) return currentEvent
  if (trimmed.startsWith("event:")) {
    return trimmed.slice(6).trim()
  }
  if (trimmed.startsWith("data:")) {
    parseDataLine(trimmed.slice(5).trim(), currentEvent, handlers)
  }
  return currentEvent
}

function parseSSELines(
  lines: string[],
  currentEvent: string,
  handlers: StreamEventHandlers,
): string {
  let eventType = currentEvent
  for (const line of lines) {
    eventType = processSSELine(line, eventType, handlers)
  }
  return eventType
}

async function readStreamChunks(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  handlers: StreamEventHandlers,
) {
  const decoder = new TextDecoder()
  let buffer = ""
  let currentEvent = "message"

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop() || ""
    currentEvent = parseSSELines(lines, currentEvent, handlers)
  }
}

async function streamResponse(
  response: Response,
  handlers: StreamEventHandlers,
) {
  if (!response.ok) {
    const err = await response.text()
    throw new Error(err || `HTTP ${response.status}`)
  }
  if (!response.body) {
    throw new Error("Missing stream response body")
  }

  await readStreamChunks(response.body.getReader(), handlers)
  handlers.onDone?.()
}

function handleAuthExpired(handlers: StreamEventHandlers, message: string) {
  handlers.onError?.(message)
  clearAuthAndRedirect()
}

async function executeChatStreamRequest({
  threadId,
  message,
  handlers,
  model,
  images,
  editMessageId,
  observation,
  signal,
}: {
  threadId: string
  message: string
  handlers: StreamEventHandlers
  model?: string
  images?: string[]
  editMessageId?: string
  observation?: Readonly<ObservationPacket>
  signal: AbortSignal
}) {
  const token = getStoredToken()
  if (!token || isJwtExpired(token)) {
    handleAuthExpired(
      handlers,
      "Authentication session expired. Please log in again.",
    )
    return
  }

  const requestBody: ChatMessageRequest = {
    message,
    model,
    images,
    edit_message_id: editMessageId,
    ...(observation ? { observation } : {}),
  }
  const response = await fetch(`/api/v1/ai/threads/${threadId}/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(requestBody),
    signal,
  })

  if (response.status === 401) {
    handleAuthExpired(
      handlers,
      "Your session has expired. Redirecting to login...",
    )
    return
  }

  await streamResponse(response, handlers)
}

function abortActiveController(
  ref: React.MutableRefObject<AbortController | null>,
) {
  if (ref.current) {
    ref.current.abort()
    ref.current = null
  }
}

function handleStreamError(err: unknown, handlers: StreamEventHandlers) {
  if (err instanceof Error && err.name === "AbortError") {
    handlers.onAbort?.()
    return
  }
  const errMsg = err instanceof Error ? err.message : "Streaming failed"
  handlers.onError?.(errMsg)
}

interface UsageDeliveryOptions {
  threadId: string
  generation: number
  currentGeneration: React.MutableRefObject<number>
  currentController: React.MutableRefObject<AbortController | null>
  controller: AbortController
  setUsage: React.Dispatch<React.SetStateAction<ThreadObservationUsage | null>>
  onUsage?: StreamEventHandlers["onObservationUsage"]
}

function deliverCurrentObservationUsage(
  options: UsageDeliveryOptions,
  data: ObservationUsagePayload,
) {
  if (options.currentGeneration.current !== options.generation) return
  if (options.currentController.current !== options.controller) return
  if (options.controller.signal.aborted) return
  options.setUsage({ threadId: options.threadId, data })
  options.onUsage?.(data)
}

interface StartStreamRequest {
  threadId: string
  message: string
  handlers: StreamEventHandlers
  model?: string
  images?: string[]
  editMessageId?: string
  observation?: Readonly<ObservationPacket>
}

interface StreamRuntime {
  stop: () => void
  setIsStreaming: React.Dispatch<React.SetStateAction<boolean>>
  setStreamingThreadId: React.Dispatch<React.SetStateAction<string | null>>
  streamingThreadIdRef: React.MutableRefObject<string | null>
  abortControllerRef: React.MutableRefObject<AbortController | null>
  usageGenerationRef: React.MutableRefObject<number>
  setObservationUsage: React.Dispatch<
    React.SetStateAction<ThreadObservationUsage | null>
  >
}

async function runChatStream(
  runtime: StreamRuntime,
  request: StartStreamRequest,
) {
  runtime.stop()
  const generation = ++runtime.usageGenerationRef.current
  const controller = new AbortController()
  runtime.abortControllerRef.current = controller
  runtime.setIsStreaming(true)
  runtime.setStreamingThreadId(request.threadId)
  runtime.streamingThreadIdRef.current = request.threadId
  runtime.setObservationUsage(null)

  const streamHandlers = createStreamHandlers({
    request,
    runtime,
    generation,
    controller,
  })
  try {
    await executeChatStreamRequest({
      ...request,
      handlers: streamHandlers,
      signal: controller.signal,
    })
  } catch (err: unknown) {
    handleStreamError(err, request.handlers)
  } finally {
    if (runtime.abortControllerRef.current === controller) {
      runtime.setIsStreaming(false)
      runtime.setStreamingThreadId(null)
      runtime.streamingThreadIdRef.current = null
      runtime.abortControllerRef.current = null
    }
  }
}

function createStreamHandlers({
  request,
  runtime,
  generation,
  controller,
}: {
  request: StartStreamRequest
  runtime: StreamRuntime
  generation: number
  controller: AbortController
}): StreamEventHandlers {
  const usageDelivery = {
    threadId: request.threadId,
    generation,
    currentGeneration: runtime.usageGenerationRef,
    currentController: runtime.abortControllerRef,
    controller,
    setUsage: runtime.setObservationUsage,
    onUsage: request.handlers.onObservationUsage,
  }
  return {
    ...request.handlers,
    onObservationUsage: (data) =>
      deliverCurrentObservationUsage(usageDelivery, data),
  }
}

export function useAIChatStream() {
  const [isStreaming, setIsStreaming] = React.useState(false)
  const [streamingThreadId, setStreamingThreadId] = React.useState<
    string | null
  >(null)
  const [observationUsage, setObservationUsage] =
    React.useState<ThreadObservationUsage | null>(null)
  const streamingThreadIdRef = React.useRef<string | null>(null)
  const abortControllerRef = React.useRef<AbortController | null>(null)
  const usageGenerationRef = React.useRef(0)

  const stop = React.useCallback((targetThreadId?: string) => {
    if (targetThreadId && streamingThreadIdRef.current !== targetThreadId) {
      return
    }
    usageGenerationRef.current += 1
    abortActiveController(abortControllerRef)
    setIsStreaming(false)
    setStreamingThreadId(null)
    streamingThreadIdRef.current = null
  }, [])

  const startStream = React.useCallback(
    (
      threadId: string,
      message: string,
      handlers: StreamEventHandlers = {},
      model?: string,
      images?: string[],
      editMessageId?: string,
      observation?: Readonly<ObservationPacket>,
    ) =>
      runChatStream(
        {
          stop,
          setIsStreaming,
          setStreamingThreadId,
          streamingThreadIdRef,
          abortControllerRef,
          usageGenerationRef,
          setObservationUsage,
        },
        {
          threadId,
          message,
          handlers,
          model,
          images,
          editMessageId,
          observation,
        },
      ),
    [stop],
  )

  const clearObservationUsage = React.useCallback(() => {
    usageGenerationRef.current += 1
    setObservationUsage(null)
  }, [])

  return {
    isStreaming,
    streamingThreadId,
    observationUsage,
    clearObservationUsage,
    startStream,
    stop,
  }
}
