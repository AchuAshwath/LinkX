import type { BrowserMemory } from "./memory"
import type { BrowserReadingSnapshot } from "./session"

export interface BrowserReadingDebugSession {
  getSnapshot(): BrowserReadingSnapshot
  subscribe(listener: () => void): () => void
}

export interface BrowserBudget {
  model_id: string
  model_input_capacity: number
  input_limit: number
  output_reserve: number
  estimated_input_tokens: number
  history_messages: number
  omitted_history_messages: number
}

interface BrowserBudgetEvent {
  threadId: string
  budget: BrowserBudget
}

export interface BrowserReadingDebugSnapshot {
  state: BrowserReadingSnapshot["state"]
  ownerChatId: string | null
  threadId: string | null
  draftNonce: string | null
  model: string | null
  queue: { pending: number }
  gaps: number
  capacityReached: boolean
  budget: BrowserBudget | null
  memory: {
    usedBytes: number
    maxBytes: number
    summary: string
    notes: ReturnType<BrowserMemory["snapshot"]>["notes"]
  }
}

export interface BrowserReadingDebugApi {
  enable(options?: { content?: boolean }): void
  disable(): void
  snapshot(): BrowserReadingDebugSnapshot
}

interface InstallBrowserReadingDebugOptions {
  session: BrowserReadingDebugSession
  memory: BrowserMemory
}

const MAX_MEMORY_BYTES = 32768
const BUDGET_EVENT_NAME = "browser-reading-budget"
const BUDGET_FIELDS = [
  "model_id",
  "model_input_capacity",
  "input_limit",
  "output_reserve",
  "estimated_input_tokens",
  "history_messages",
  "omitted_history_messages",
] as const
const NUMERIC_BUDGET_FIELDS = BUDGET_FIELDS.slice(1)

declare global {
  interface Window {
    browserReadingDebug?: BrowserReadingDebugApi
  }
}

function copyMemory(memory: BrowserMemory) {
  const current = memory.snapshot()
  return {
    summary: current.summary,
    notes: current.notes.map((note) => ({ ...note })),
  }
}

function countBytes(value: { summary: string; notes: readonly unknown[] }) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

type NumericBudget = Omit<BrowserBudget, "model_id">

function parseNumericBudget(
  value: Record<string, unknown>,
): NumericBudget | null {
  for (const field of NUMERIC_BUDGET_FIELDS) {
    const fieldValue = value[field]
    if (typeof fieldValue !== "number") return null
    if (!Number.isSafeInteger(fieldValue) || fieldValue < 0) return null
  }

  return {
    model_input_capacity: value.model_input_capacity as number,
    input_limit: value.input_limit as number,
    output_reserve: value.output_reserve as number,
    estimated_input_tokens: value.estimated_input_tokens as number,
    history_messages: value.history_messages as number,
    omitted_history_messages: value.omitted_history_messages as number,
  }
}

export function parseBrowserBudget(value: unknown): BrowserBudget | null {
  if (!isRecord(value)) return null
  if (typeof value.model_id !== "string") return null
  const numeric = parseNumericBudget(value)
  if (!numeric) return null

  return {
    model_id: value.model_id,
    ...numeric,
  }
}

function normalizeModelId(modelId: string) {
  return modelId.startsWith("openai/")
    ? modelId.slice("openai/".length)
    : modelId
}

function isActive(snapshot: BrowserReadingSnapshot) {
  return (
    snapshot.state === "ready" ||
    snapshot.state === "reading" ||
    snapshot.state === "question"
  )
}

function matchesSessionThread(
  snapshot: BrowserReadingSnapshot,
  threadId: string,
) {
  return [
    snapshot.threadId,
    snapshot.ownerChatId,
    snapshot.draftNonce,
  ].includes(threadId)
}

function copyBudget(budget: BrowserBudget): BrowserBudget {
  return {
    model_id: budget.model_id,
    model_input_capacity: budget.model_input_capacity,
    input_limit: budget.input_limit,
    output_reserve: budget.output_reserve,
    estimated_input_tokens: budget.estimated_input_tokens,
    history_messages: budget.history_messages,
    omitted_history_messages: budget.omitted_history_messages,
  }
}

function parseBudgetEvent(event: Event): BrowserBudgetEvent | null {
  if (!(event instanceof CustomEvent)) return null
  if (!isRecord(event.detail)) return null
  if (typeof event.detail.threadId !== "string") return null
  const budget = parseBrowserBudget(event.detail.budget)
  if (!budget) return null
  return { threadId: event.detail.threadId, budget }
}

function budgetMatchesSession(
  current: BrowserReadingSnapshot,
  event: BrowserBudgetEvent,
) {
  if (!isActive(current)) return false
  if (!matchesSessionThread(current, event.threadId)) return false
  if (current.model === null) return false
  return (
    normalizeModelId(event.budget.model_id) === normalizeModelId(current.model)
  )
}

export function publishBrowserBudget({
  threadId,
  budget,
}: BrowserBudgetEvent): void {
  if (typeof window === "undefined") return
  window.dispatchEvent(
    new CustomEvent(BUDGET_EVENT_NAME, {
      detail: { threadId, budget: copyBudget(budget) },
    }),
  )
}

function buildSnapshot(
  session: BrowserReadingDebugSession,
  memory: BrowserMemory,
  readBudget: () => BrowserBudget | null,
): BrowserReadingDebugSnapshot {
  const current = session.getSnapshot()
  const memorySnapshot = copyMemory(memory)
  return {
    state: current.state,
    ownerChatId: current.ownerChatId,
    threadId: current.threadId,
    draftNonce: current.draftNonce,
    model: current.model,
    queue: { pending: current.pendingCount },
    gaps: current.gapCount,
    capacityReached: current.capacityReached,
    budget: readBudget(),
    memory: {
      usedBytes: countBytes(memorySnapshot),
      maxBytes: MAX_MEMORY_BYTES,
      ...memorySnapshot,
    },
  }
}

function createLogEvent(
  snapshot: BrowserReadingDebugSnapshot,
  includeContent: boolean,
) {
  return {
    state: snapshot.state,
    ownerChatId: snapshot.ownerChatId,
    threadId: snapshot.threadId,
    draftNonce: snapshot.draftNonce,
    model: snapshot.model,
    queue: snapshot.queue,
    gaps: snapshot.gaps,
    capacityReached: snapshot.capacityReached,
    budget: snapshot.budget,
    memory: {
      usedBytes: snapshot.memory.usedBytes,
      maxBytes: snapshot.memory.maxBytes,
      noteCount: snapshot.memory.notes.length,
      summaryChars: snapshot.memory.summary.length,
      ...(includeContent
        ? {
            summary: snapshot.memory.summary,
            notes: snapshot.memory.notes,
          }
        : {}),
    },
  }
}

export function installBrowserReadingDebug({
  session,
  memory,
}: InstallBrowserReadingDebugOptions): () => void {
  if (typeof window === "undefined") return () => {}

  let enabled = false
  let includeContent = false
  let budget: BrowserBudget | null = null
  let budgetThreadId: string | null = null
  let budgetModel: string | null = null
  const clearBudget = () => {
    budget = null
    budgetThreadId = null
    budgetModel = null
  }
  const clearAndReadBudget = () => {
    clearBudget()
    return null
  }
  const readBudget = () => {
    const current = session.getSnapshot()
    if (budget === null) return null
    if (!isActive(current)) return clearAndReadBudget()
    if (budgetThreadId === null) return clearAndReadBudget()
    if (!matchesSessionThread(current, budgetThreadId)) {
      return clearAndReadBudget()
    }
    if (current.model === null) return clearAndReadBudget()
    if (normalizeModelId(current.model) !== budgetModel) {
      return clearAndReadBudget()
    }
    return budget
  }
  const logSnapshot = () => {
    const snapshot = api.snapshot()
    console.log("[Browser reading]", createLogEvent(snapshot, includeContent))
  }
  const api: BrowserReadingDebugApi = {
    enable(options) {
      enabled = true
      includeContent = options?.content === true
      logSnapshot()
    },
    disable() {
      enabled = false
      includeContent = false
    },
    snapshot() {
      return buildSnapshot(session, memory, readBudget)
    },
  }

  const onSessionUpdate = () => {
    readBudget()
    if (enabled) logSnapshot()
  }

  const onBudgetEvent = (event: Event) => {
    const parsed = parseBudgetEvent(event)
    if (!parsed) return
    const current = session.getSnapshot()
    if (!budgetMatchesSession(current, parsed)) return

    budget = parsed.budget
    budgetThreadId = parsed.threadId
    budgetModel = normalizeModelId(current.model ?? "")
    if (enabled) logSnapshot()
  }

  const unsubscribe = session.subscribe(onSessionUpdate)
  window.addEventListener(BUDGET_EVENT_NAME, onBudgetEvent)
  window.browserReadingDebug = api

  return () => {
    unsubscribe()
    window.removeEventListener(BUDGET_EVENT_NAME, onBudgetEvent)
    if (window.browserReadingDebug === api) {
      delete window.browserReadingDebug
    }
  }
}
