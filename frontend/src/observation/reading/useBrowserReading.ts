import { useSyncExternalStore } from "react"
import type { BrowserReadingSnapshot } from "./session"

export interface BrowserReadingSessionView {
  getSnapshot(): BrowserReadingSnapshot
  subscribe(listener: () => void): () => void
}

export function useBrowserReading(
  session: BrowserReadingSessionView,
): BrowserReadingSnapshot {
  return useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot,
  )
}
