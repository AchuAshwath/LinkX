import * as React from "react"
import type { ChatMessageRequest, ObservationPacket } from "@/client"
import type { DraftArtifact, TrendingArtifact } from "@/components/Chat/types"
import { parseBrowserActivityEvent } from "@/observation/reading/activity"
import {
  type BrowserBudget,
  parseBrowserBudget,
  publishBrowserBudget,
} from "@/observation/reading/debug"
import { isRejectedBeforeProcessingStatus } from "@/observation/reading/operationError"
import type {
  BrowserActivityEvent,
  BrowserNote,
  BrowserReceipt,
  PreparedBrowserQuestion,
} from "@/observation/reading/types"
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
  onBrowserNote?: (note: BrowserNote) => void
  onBrowserReceipt?: (receipt: BrowserReceipt) => void
  onBrowserStatus?: (status: { state: string; operation_id: string }) => void
  onBrowserBudget?: (budget: BrowserBudget) => void
  onBrowserActivity?: (activity: BrowserActivityEvent) => void
  onBrowserDispatch?: (operationId: string) => void
  onBrowserRejected?: (operationId: string) => void
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
  operation_id?: string
  state?: string
  id?: string
  sequence?: number
  text?: string
  model?: string
  uncertainty?: string
  completed_ids?: string[]
  failed_ids?: string[]
  unused_ids?: string[]
  tool_id?: string
  tool_state?: string
  view_index?: number
  view_count?: number
  note_chars?: number
  note_preview?: string
  preview_truncated?: boolean
  duration_ms?: number
  failure_code?: string
  failure_message?: string
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
  browser_status: (d, h) =>
    h.onBrowserStatus?.({
      state: d.state ?? "unknown",
      operation_id: d.operation_id ?? "",
    }),
  browser_budget: (d, h) => {
    const budget = parseBrowserBudget(d)
    if (budget) h.onBrowserBudget?.(budget)
  },
  browser_activity: (d, h) => {
    const event = parseBrowserActivityEvent(d)
    if (event) h.onBrowserActivity?.(event)
  },
  browser_note: (d, h) => {
    if (!d.id) return
    if (typeof d.sequence !== "number") return
    if (!Number.isSafeInteger(d.sequence)) return
    if (typeof d.text !== "string") return
    h.onBrowserNote?.({
      id: d.id,
      sequence: d.sequence,
      text: d.text,
      model: d.model ?? "",
      uncertainty: d.uncertainty ?? "",
    })
  },
  browser_receipt: (d, h) => {
    if (!d.operation_id) return
    h.onBrowserReceipt?.({
      operation_id: d.operation_id,
      completed_ids: d.completed_ids ?? [],
      failed_ids: d.failed_ids ?? [],
      unused_ids: d.unused_ids ?? [],
    })
  },
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
    if (done) {
      buffer += decoder.decode()
      if (buffer) parseSSELines([buffer], currentEvent, handlers)
      break
    }

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
  const body = await validatedResponseBody(response)
  const completion = onceCompletion(handlers)
  try {
    await readStreamChunks(body.getReader(), completion.handlers)
  } catch (err: unknown) {
    reportStreamFailure(err, completion.handlers)
  }
  if (!completion.terminal())
    completion.handlers.onError?.("Stream ended before completion.")
}

async function validatedResponseBody(response: Response) {
  if (!response.ok) {
    const message = chatErrorMessage(await response.text())
    throw new Error(message || `HTTP ${response.status}`)
  }
  if (!response.body) throw new Error("Missing stream response body")
  return response.body
}

function reportStreamFailure(err: unknown, handlers: StreamEventHandlers) {
  if (isAbortError(err)) throw err
  handleStreamError(err, handlers)
}

function isAbortError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "name" in err &&
    err.name === "AbortError"
  )
}

function chatErrorMessage(raw: string): string {
  try {
    const { detail } = JSON.parse(raw)
    if (typeof detail === "string") return detail
    if (typeof detail?.message === "string") return detail.message
  } catch {
    return raw
  }
  return raw
}

function onceCompletion(handlers: StreamEventHandlers) {
  let completed = false
  let failed = false
  return {
    terminal: () => completed || failed,
    handlers: {
      ...handlers,
      onDone: () => {
        if (completed || failed) return
        completed = true
        handlers.onDone?.()
      },
      onError: (error: string) => {
        if (completed || failed) return
        failed = true
        handlers.onError?.(error)
      },
    },
  }
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
  browserQuestion,
  signal,
}: {
  threadId: string
  message: string
  handlers: StreamEventHandlers
  model?: string
  images?: string[]
  editMessageId?: string
  observation?: Readonly<ObservationPacket>
  browserQuestion?: PreparedBrowserQuestion
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

  const readyQuestion = await refreshBrowserQuestion(browserQuestion, signal)
  const { requestBody, endpoint } = chatRequestPayload({
    threadId,
    message,
    model,
    images,
    editMessageId,
    observation,
    browserQuestion: readyQuestion,
  })
  if (browserQuestion) {
    handlers.onBrowserDispatch?.(browserQuestion.operation_id)
  }
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(requestBody),
    signal,
  })

  notifyBrowserRejection({ response, browserQuestion, handlers })

  if (response.status === 401) {
    handleAuthExpired(
      handlers,
      "Your session has expired. Redirecting to login...",
    )
    return
  }

  await streamResponse(response, handlers)
}

function notifyBrowserRejection({
  response,
  browserQuestion,
  handlers,
}: {
  response: Response
  browserQuestion?: PreparedBrowserQuestion
  handlers: StreamEventHandlers
}): void {
  if (!browserQuestion) return
  if (!isRejectedBeforeProcessingStatus(response.status)) return
  handlers.onBrowserRejected?.(browserQuestion.operation_id)
}

async function refreshBrowserQuestion(
  question: PreparedBrowserQuestion | undefined,
  signal: AbortSignal,
): Promise<PreparedBrowserQuestion | undefined> {
  if (!question?.ready) return question
  const context = await question.ready(signal)
  if (signal.aborted) throw new DOMException("Question cancelled", "AbortError")
  return { ...question, context }
}

function chatRequestPayload(options: Omit<StartStreamRequest, "handlers">) {
  const browser = options.browserQuestion
  if (browser)
    return {
      endpoint: `/api/v1/ai/threads/${options.threadId}/browser-chat`,
      requestBody: {
        message: options.message,
        model: browser.model,
        request_id: browser.operation_id,
        browser_context: browser.context,
      },
    }
  const requestBody: ChatMessageRequest = {
    message: options.message,
    model: options.model,
    images: options.images,
    edit_message_id: options.editMessageId,
    ...(options.observation ? { observation: options.observation } : {}),
  }
  return {
    endpoint: `/api/v1/ai/threads/${options.threadId}/chat`,
    requestBody,
  }
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
  if (isAbortError(err)) {
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
  browserQuestion?: PreparedBrowserQuestion
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

  const terminalHandlers = createRequestTerminalHandlers(request.handlers)
  const streamRequest = { ...request, handlers: terminalHandlers }
  const streamHandlers = createStreamHandlers({
    request: streamRequest,
    runtime,
    generation,
    controller,
  })
  try {
    await executeChatStreamRequest({
      ...streamRequest,
      handlers: streamHandlers,
      signal: controller.signal,
    })
  } catch (err: unknown) {
    handleStreamError(err, terminalHandlers)
  } finally {
    if (runtime.abortControllerRef.current === controller) {
      runtime.setIsStreaming(false)
      runtime.setStreamingThreadId(null)
      runtime.streamingThreadIdRef.current = null
      runtime.abortControllerRef.current = null
    }
  }
}

function createRequestTerminalHandlers(
  handlers: StreamEventHandlers,
): StreamEventHandlers {
  let terminal = false
  const invokeTerminal = (callback: (() => void) | undefined) => {
    if (terminal) return
    terminal = true
    callback?.()
  }
  return {
    ...handlers,
    onDone: () => invokeTerminal(handlers.onDone),
    onError: (message) => invokeTerminal(() => handlers.onError?.(message)),
    onAbort: () => invokeTerminal(handlers.onAbort),
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
    onBrowserBudget: (budget) => {
      if (runtime.abortControllerRef.current !== controller) return
      if (controller.signal.aborted) return
      if (import.meta.env.DEV)
        publishBrowserBudget({ threadId: request.threadId, budget })
      request.handlers.onBrowserBudget?.(budget)
    },
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
      request: Omit<StartStreamRequest, "handlers"> & {
        handlers?: StreamEventHandlers
      },
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
        { ...request, handlers: request.handlers ?? {} },
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
