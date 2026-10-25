import type { BrowserMemorySnapshot, BrowserNote } from "./types"

export interface BrowserMemoryOptions {
  maxBytes: number
  keepRecent: number
}

export interface BrowserCompactionTicket {
  version: number
  prefixIds: readonly string[]
  summary: string
  notes: readonly BrowserNote[]
}

export type BrowserMemoryAppendResult =
  | { status: "accepted" }
  | { status: "duplicate" }
  | { status: "capacity" }

export interface BrowserMemory {
  append(note: BrowserNote): BrowserMemoryAppendResult
  snapshot(cutoff?: number): BrowserMemorySnapshot
  needsCompaction(): boolean
  beginCompaction(): BrowserCompactionTicket | null
  commitCompaction(ticket: BrowserCompactionTicket, summary: string): boolean
  clear(): void
}

const COMPACTION_PRESSURE_RATIO = 0.8
const encoder = new TextEncoder()

function copyNote(note: BrowserNote): BrowserNote {
  return Object.freeze({
    id: note.id,
    sequence: note.sequence,
    text: note.text,
    model: note.model,
    uncertainty: note.uncertainty,
  })
}

function snapshotNotes(notes: readonly BrowserNote[]) {
  return Object.freeze(notes.map(copyNote))
}

function serializedBytes(summary: string, notes: readonly BrowserNote[]) {
  return encoder.encode(JSON.stringify({ summary, notes })).byteLength
}

function lastSequence(notes: readonly BrowserNote[]) {
  return notes.reduce((last, note) => Math.max(last, note.sequence), 0)
}

export function createBrowserMemory(
  options: BrowserMemoryOptions,
): BrowserMemory {
  let summary = ""
  let notes: BrowserNote[] = []
  let summaryThroughSequence = 0
  let version = 0
  let capacityBlocked = false
  const ticketCoverage = new WeakMap<BrowserCompactionTicket, number>()

  const hasCompactionPrefix = () => notes.length > options.keepRecent

  const snapshot = (cutoff?: number): BrowserMemorySnapshot => {
    const includeSummary =
      cutoff === undefined || summaryThroughSequence <= cutoff
    const visibleNotes =
      cutoff === undefined
        ? notes
        : notes.filter((note) => note.sequence <= cutoff)

    return Object.freeze({
      summary: includeSummary ? summary : "",
      notes: snapshotNotes(visibleNotes),
    })
  }

  return {
    append(note) {
      if (notes.some((existing) => existing.id === note.id)) {
        return { status: "duplicate" }
      }

      const copied = copyNote(note)
      const nextNotes = [...notes, copied]
      if (serializedBytes(summary, nextNotes) > options.maxBytes) {
        capacityBlocked = true
        return { status: "capacity" }
      }

      notes = nextNotes
      return { status: "accepted" }
    },
    snapshot,
    needsCompaction() {
      const overPressureThreshold =
        serializedBytes(summary, notes) >=
        options.maxBytes * COMPACTION_PRESSURE_RATIO
      return capacityBlocked || (hasCompactionPrefix() && overPressureThreshold)
    },
    beginCompaction() {
      if (!hasCompactionPrefix()) return null

      const prefix = notes.slice(0, notes.length - options.keepRecent)
      const ticket: BrowserCompactionTicket = Object.freeze({
        version,
        prefixIds: Object.freeze(prefix.map(({ id }) => id)),
        summary,
        notes: snapshotNotes(prefix),
      })
      ticketCoverage.set(ticket, summaryThroughSequence)
      return ticket
    },
    commitCompaction(ticket, nextSummary) {
      const prefixLength = ticket.prefixIds.length
      const prefixMatches =
        ticketCoverage.has(ticket) &&
        ticket.version === version &&
        ticket.summary === summary &&
        prefixLength > 0 &&
        ticket.prefixIds.every((id, index) => notes[index]?.id === id)
      if (!prefixMatches) return false

      const remainingNotes = notes.slice(prefixLength)
      if (serializedBytes(nextSummary, remainingNotes) > options.maxBytes) {
        capacityBlocked = true
        return false
      }

      summary = nextSummary
      summaryThroughSequence = Math.max(
        ticketCoverage.get(ticket) ?? 0,
        lastSequence(ticket.notes),
      )
      notes = remainingNotes
      version += 1
      capacityBlocked = false
      return true
    },
    clear() {
      summary = ""
      notes = []
      summaryThroughSequence = 0
      capacityBlocked = false
      version += 1
    },
  }
}
