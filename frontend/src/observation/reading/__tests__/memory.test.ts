import { describe, expect, it } from "vitest"
import { createBrowserMemory } from "../memory"

describe("BrowserMemory", () => {
  const note = {
    id: "frame-1",
    sequence: 1,
    text: "The page asks for a shipping address.",
    model: "vision-model",
    uncertainty: "",
  }

  it("starts with an immutable empty snapshot", () => {
    const memory = createBrowserMemory({ maxBytes: 32_768, keepRecent: 3 })

    const snapshot = memory.snapshot()

    expect(snapshot).toEqual({ summary: "", notes: [] })
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(snapshot.notes)).toBe(true)
  })

  it("copies an accepted note and returns immutable snapshots", () => {
    const memory = createBrowserMemory({ maxBytes: 32_768, keepRecent: 3 })
    const source = { ...note }

    expect(memory.append(source)).toEqual({ status: "accepted" })
    source.text = "changed by the caller"
    const snapshot = memory.snapshot()

    expect(snapshot.notes[0]?.text).toBe(
      "The page asks for a shipping address.",
    )
    expect(Object.isFrozen(snapshot.notes[0])).toBe(true)
    expect(Object.isFrozen(snapshot.notes)).toBe(true)
  })

  it("rejects duplicate ids and keeps a cutoff snapshot free of later notes", () => {
    const memory = createBrowserMemory({ maxBytes: 32_768, keepRecent: 3 })
    const laterNote = { ...note, id: "frame-2", sequence: 2 }

    expect(memory.append(note)).toEqual({ status: "accepted" })
    expect(
      memory.append({ ...note, text: "replacement would lose facts" }),
    ).toEqual({
      status: "duplicate",
    })
    expect(memory.append(laterNote)).toEqual({ status: "accepted" })

    expect(memory.snapshot(1).notes.map(({ id }) => id)).toEqual(["frame-1"])
    expect(memory.snapshot(0)).toEqual({ summary: "", notes: [] })
  })

  it("compacts an exact prefix while preserving notes appended during compaction", () => {
    const memory = createBrowserMemory({ maxBytes: 32_768, keepRecent: 3 })
    const notes = [1, 2, 3, 4].map((sequence) => ({
      ...note,
      id: `frame-${sequence}`,
      sequence,
    }))
    notes.forEach((item) => {
      memory.append(item)
    })

    const ticket = memory.beginCompaction()
    expect(ticket?.prefixIds).toEqual(["frame-1"])
    expect(ticket?.notes[0]?.text).toBe(note.text)
    expect(memory.snapshot(0).summary).toBe("")

    memory.append({ ...note, id: "frame-5", sequence: 5 })
    expect(
      memory.commitCompaction(
        ticket!,
        "The first frame showed a shipping form.",
      ),
    ).toBe(true)

    expect(memory.snapshot()).toEqual({
      summary: "The first frame showed a shipping form.",
      notes: notes.slice(1).concat({ ...note, id: "frame-5", sequence: 5 }),
    })
    expect(memory.snapshot(0)).toEqual({ summary: "", notes: [] })
    expect(memory.snapshot(1)).toEqual({
      summary: "The first frame showed a shipping form.",
      notes: [],
    })
  })

  it("rejects compaction tickets made stale by clearing memory", () => {
    const memory = createBrowserMemory({ maxBytes: 32_768, keepRecent: 3 })
    const notes = [1, 2, 3, 4].map((sequence) => ({
      ...note,
      id: `frame-${sequence}`,
      sequence,
    }))
    notes.forEach((item) => {
      memory.append(item)
    })
    const ticket = memory.beginCompaction()

    memory.clear()
    notes.forEach((item) => {
      memory.append(item)
    })

    expect(memory.commitCompaction(ticket!, "stale summary")).toBe(false)
    expect(memory.snapshot()).toEqual({ summary: "", notes })
  })

  it("reports capacity pressure without discarding facts", () => {
    const memory = createBrowserMemory({ maxBytes: 250, keepRecent: 3 })
    const longNote = { ...note, text: "A".repeat(100) }

    expect(memory.append(longNote)).toEqual({ status: "accepted" })
    expect(memory.append({ ...note, id: "frame-2", sequence: 2 })).toEqual({
      status: "capacity",
    })
    expect(memory.needsCompaction()).toBe(true)
    expect(memory.snapshot().notes).toEqual([longNote])
    expect(memory.beginCompaction()).toBeNull()
  })

  it("counts UTF-8 bytes when a note contains multibyte text", () => {
    const tooSmall = createBrowserMemory({ maxBytes: 303, keepRecent: 3 })
    const exactLimit = createBrowserMemory({ maxBytes: 304, keepRecent: 3 })
    const multibyteNote = { ...note, text: "é".repeat(100) }

    expect(tooSmall.append(multibyteNote)).toEqual({
      status: "capacity",
    })
    expect(tooSmall.snapshot()).toEqual({ summary: "", notes: [] })
    expect(tooSmall.needsCompaction()).toBe(true)
    expect(exactLimit.append(multibyteNote)).toEqual({ status: "accepted" })
  })

  it("keeps notes when a multibyte summary would exceed the combined byte limit", () => {
    const memory = createBrowserMemory({ maxBytes: 250, keepRecent: 1 })
    const notes = [1, 2].map((sequence) => ({
      ...note,
      id: `frame-${sequence}`,
      sequence,
      text: "short",
    }))
    notes.forEach((item) => {
      memory.append(item)
    })
    const ticket = memory.beginCompaction()

    expect(memory.commitCompaction(ticket!, "é".repeat(100))).toBe(false)
    expect(memory.snapshot()).toEqual({ summary: "", notes })
    expect(memory.needsCompaction()).toBe(true)
  })

  it("rejects a second compaction ticket after the same prefix was committed", () => {
    const memory = createBrowserMemory({ maxBytes: 32_768, keepRecent: 3 })
    const notes = [1, 2, 3, 4].map((sequence) => ({
      ...note,
      id: `frame-${sequence}`,
      sequence,
    }))
    notes.forEach((item) => {
      memory.append(item)
    })
    const firstTicket = memory.beginCompaction()
    const competingTicket = memory.beginCompaction()

    expect(memory.commitCompaction(firstTicket!, "first summary")).toBe(true)
    expect(memory.commitCompaction(competingTicket!, "stale summary")).toBe(
      false,
    )
    expect(memory.snapshot()).toEqual({
      summary: "first summary",
      notes: notes.slice(1),
    })
  })

  it("rejects tickets created by another memory instance", () => {
    const firstMemory = createBrowserMemory({ maxBytes: 32_768, keepRecent: 3 })
    const secondMemory = createBrowserMemory({
      maxBytes: 32_768,
      keepRecent: 3,
    })
    const notes = [1, 2, 3, 4].map((sequence) => ({
      ...note,
      id: `frame-${sequence}`,
      sequence,
    }))
    notes.forEach((item) => {
      firstMemory.append(item)
      secondMemory.append(item)
    })
    const ticket = firstMemory.beginCompaction()

    expect(secondMemory.commitCompaction(ticket!, "foreign summary")).toBe(
      false,
    )
    expect(secondMemory.snapshot()).toEqual({ summary: "", notes })
  })

  it("accepts a capacity-blocked note after compaction frees room", () => {
    const memory = createBrowserMemory({ maxBytes: 250, keepRecent: 0 })
    const largeNote = { ...note, text: "A".repeat(100) }

    expect(memory.append(largeNote)).toEqual({ status: "accepted" })
    expect(memory.append({ ...note, id: "frame-2", sequence: 2 })).toEqual({
      status: "capacity",
    })
    const ticket = memory.beginCompaction()
    expect(ticket).not.toBeNull()
    expect(memory.commitCompaction(ticket!, "A short summary.")).toBe(true)
    expect(memory.append({ ...note, id: "frame-2", sequence: 2 })).toEqual({
      status: "accepted",
    })
  })
})
