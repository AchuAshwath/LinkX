import * as React from "react"
import type { Platform } from "@/components/Common/PlatformSelector"

export interface ActiveDraftItem {
  id: string
  prompt: string
  platform: Platform | string
  startedAt: Date
}

let activeDrafts: ActiveDraftItem[] = []
const listeners = new Set<() => void>()

function emitChange() {
  listeners.forEach((listener) => {
    listener()
  })
}

export const draftingStore = {
  addDraft(draft: ActiveDraftItem) {
    activeDrafts = [draft, ...activeDrafts]
    emitChange()
  },
  removeDraft(id: string) {
    activeDrafts = activeDrafts.filter((d) => d.id !== id)
    emitChange()
  },
  getDrafts() {
    return activeDrafts
  },
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}

export function useActiveDrafts(): ActiveDraftItem[] {
  return React.useSyncExternalStore(
    draftingStore.subscribe,
    draftingStore.getDrafts,
    draftingStore.getDrafts,
  )
}
