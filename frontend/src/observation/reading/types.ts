/** Temporary transport values. Never write images or notes to chat storage. */
export interface BrowserFrame {
  id: string
  sequence: number
  captured_at: string
  width: number
  height: number
  image_data_url: string
}

export interface BrowserNote {
  id: string
  sequence: number
  text: string
  model: string
  uncertainty: string
}

export interface BrowserMemorySnapshot {
  summary: string
  notes: readonly BrowserNote[]
}

export interface BrowserContext extends BrowserMemorySnapshot {
  session_id: string
  generation: number
  cutoff: number
  pending_frames: readonly BrowserFrame[]
  current_view: BrowserFrame | null
  gap_count: number
}

export interface ReadRequest {
  operation_id: string
  model: string
  frame: BrowserFrame
}

export interface ReadResponse {
  operation_id: string
  note: BrowserNote
}

export interface CompactRequest extends BrowserMemorySnapshot {
  operation_id: string
  model: string
}

export interface CompactResponse {
  operation_id: string
  summary: string
}

export interface BrowserReceipt {
  operation_id: string
  completed_ids: string[]
  failed_ids: string[]
  unused_ids: string[]
}

export interface BrowserActivityEvent {
  state: "checking" | "reading" | "incomplete"
  message: string
  tool_id?: string
  tool_state?: "running" | "completed" | "failed"
  view_index?: number
  view_count?: number
  note_chars?: number
  note_preview?: string
  preview_truncated?: boolean
  duration_ms?: number
  failure_code?: string
  failure_message?: string
}

export interface OperationStatus {
  operation_id: string
  state: "active" | "settled" | "unknown"
  cancelled: boolean
}

export interface PreparedBrowserQuestion {
  context: BrowserContext
  operation_id: string
  model: string
  /** Local-only barrier; never serialized. Refreshes notes after active work settles. */
  ready?: (signal: AbortSignal) => Promise<BrowserContext>
}
