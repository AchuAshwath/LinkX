const REJECTED_BEFORE_PROCESSING_STATUSES = new Set([
  401, 403, 404, 409, 413, 422,
])

export class BrowserOperationError extends Error {
  readonly rejectedBeforeProcessing = true

  constructor(readonly status: number) {
    super(`Observation request failed (${status}).`)
    this.name = "BrowserOperationError"
  }
}

export function isRejectedBeforeProcessingStatus(status: number): boolean {
  return REJECTED_BEFORE_PROCESSING_STATUSES.has(status)
}
