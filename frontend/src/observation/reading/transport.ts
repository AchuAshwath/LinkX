import { getStoredToken } from "@/utils/auth"
import {
  BrowserOperationError,
  isRejectedBeforeProcessingStatus,
} from "./operationError"
import type { BrowserReadingTransport } from "./session"
import type { BrowserFrame, BrowserNote, OperationStatus } from "./types"

const BASE_PATH = "/api/v1/ai/observation"
const REQUEST_TIMEOUT_MS = 60_000
const METADATA_TIMEOUT_MS = 5_000
const UNKNOWN_MESSAGES = {
  read: "Observation read outcome is unknown.",
  compact: "Observation compaction outcome is unknown.",
}

interface FetchResponse {
  ok: boolean
  status: number
  json(): Promise<unknown>
}

type Fetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<FetchResponse>

interface ReadInput {
  operation_id: string
  model: string
  frame: BrowserFrame
}

interface CompactInput {
  operation_id: string
  model: string
  summary: string
  notes: BrowserNote[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function matchesOperation(
  value: unknown,
  operationId: string,
): value is Record<string, unknown> {
  return isRecord(value) && value.operation_id === operationId
}

function isOperationState(value: unknown): value is OperationStatus["state"] {
  return value === "active" || value === "settled" || value === "unknown"
}

function requestHeaders(): HeadersInit {
  const token = getStoredToken()
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  }
}

async function requestJson(
  fetcher: Fetcher,
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  const response = await fetcher(path, {
    method: "POST",
    headers: requestHeaders(),
    body: JSON.stringify(body),
    signal,
  })
  if (!response.ok) {
    if (isRejectedBeforeProcessingStatus(response.status)) {
      throw new BrowserOperationError(response.status)
    }
    throw new Error(`Observation request failed (${response.status}).`)
  }
  return response.json()
}

function operationStatus(value: unknown, operationId: string): OperationStatus {
  if (!matchesOperation(value, operationId)) {
    return { operation_id: operationId, state: "unknown", cancelled: false }
  }
  if (!isOperationState(value.state)) {
    return { operation_id: operationId, state: "unknown", cancelled: false }
  }
  return {
    operation_id: operationId,
    state: value.state,
    cancelled: value.cancelled === true,
  }
}

async function getOperationStatus(
  fetcher: Fetcher,
  operationId: string,
): Promise<OperationStatus> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), METADATA_TIMEOUT_MS)
  try {
    const response = await fetcher(`${BASE_PATH}/operations/${operationId}`, {
      method: "GET",
      headers: requestHeaders(),
      signal: controller.signal,
    })
    if (!response.ok) {
      return { operation_id: operationId, state: "unknown", cancelled: false }
    }
    return operationStatus(await response.json(), operationId)
  } catch {
    return { operation_id: operationId, state: "unknown", cancelled: false }
  } finally {
    clearTimeout(timer)
  }
}

async function settleOperation(
  fetcher: Fetcher,
  operationId: string,
): Promise<OperationStatus> {
  const status = await getOperationStatus(fetcher, operationId)
  if (status.state !== "active") return status
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), METADATA_TIMEOUT_MS)
  try {
    await fetcher(`${BASE_PATH}/operations/${operationId}`, {
      method: "DELETE",
      headers: requestHeaders(),
      signal: controller.signal,
    })
  } catch {
    // Verify below; cancellation may have reached the server despite a lost response.
  } finally {
    clearTimeout(timer)
  }
  return getOperationStatus(fetcher, operationId)
}

async function requestWithTimeout({
  fetcher,
  path,
  body,
  operationId,
  unknownMessage,
}: {
  fetcher: Fetcher
  path: string
  body: unknown
  operationId: string
  unknownMessage: string
}): Promise<unknown> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    return await requestJson(fetcher, path, body, controller.signal)
  } catch (error) {
    if (controller.signal.aborted) {
      const status = await settleOperation(fetcher, operationId)
      if (status.state !== "settled") {
        throw new Error(unknownMessage)
      }
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

function isBoundedNote(value: unknown, input: ReadInput): value is BrowserNote {
  return (
    isRecord(value) &&
    value.id === input.frame.id &&
    value.sequence === input.frame.sequence &&
    typeof value.text === "string" &&
    value.text.length <= 8000 &&
    value.model === input.model &&
    typeof value.uncertainty === "string" &&
    value.uncertainty.length <= 2000
  )
}

function readResponse(value: unknown, input: ReadInput) {
  if (!matchesOperation(value, input.operation_id)) {
    throw new Error("Observation read response did not match its operation.")
  }
  if (!isBoundedNote(value.note, input)) {
    throw new Error("Observation read returned an invalid note.")
  }
  return { operation_id: input.operation_id, note: value.note }
}

function compactResponse(value: unknown, input: CompactInput) {
  const operationId = input.operation_id
  if (!isRecord(value) || value.operation_id !== operationId) {
    throw new Error(
      "Observation compaction response did not match its operation.",
    )
  }
  if (typeof value.summary !== "string" || value.summary.length > 8192) {
    throw new Error("Observation compaction returned an invalid summary.")
  }
  return { operation_id: operationId, summary: value.summary }
}

export function createBrowserReadingTransport(
  fetcher: Fetcher = fetch as Fetcher,
): BrowserReadingTransport {
  return {
    read: createOperation({ fetcher, kind: "read", parse: readResponse }),
    compact: createOperation({
      fetcher,
      kind: "compact",
      parse: compactResponse,
    }),
    settle(operationId) {
      return settleOperation(fetcher, operationId)
    },
  }
}

function createOperation<
  Input extends { operation_id: string },
  Output,
>(options: {
  fetcher: Fetcher
  kind: "read" | "compact"
  parse: (value: unknown, input: Input) => Output
}) {
  return async (input: Input): Promise<Output> => {
    const result = await requestWithTimeout({
      fetcher: options.fetcher,
      path: `${BASE_PATH}/${options.kind}`,
      body: input,
      operationId: input.operation_id,
      unknownMessage: UNKNOWN_MESSAGES[options.kind],
    })
    return options.parse(result, input)
  }
}
