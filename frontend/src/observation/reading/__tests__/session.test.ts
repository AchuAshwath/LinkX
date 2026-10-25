import { describe, expect, it, vi } from "vitest"
import { BrowserOperationError } from "../operationError"
import { createBrowserReadingSession } from "../session"

const FIXED_NOW = Date.parse("2026-10-22T00:00:00.000Z")

function frame(id: string, sequence: number) {
  return {
    id,
    sequence,
    captured_at: "2026-10-22T00:00:00.000Z",
    width: 1,
    height: 1,
    image_data_url: "data:image/jpeg;base64,AA==",
  }
}

function createHarness() {
  let offer: ((candidate: ReturnType<typeof frame>) => boolean) | undefined
  let stopCount = 0
  const notes: Array<{
    id: string
    sequence: number
    text: string
    model: string
    uncertainty: string
  }> = []
  const capture = {
    start(onCandidate: (candidate: ReturnType<typeof frame>) => boolean) {
      offer = onCandidate
    },
    stop() {
      stopCount += 1
    },
    captureCurrentView: async () => null,
  }
  const reads: Array<{
    operation_id: string
    frame: ReturnType<typeof frame>
    model: string
  }> = []
  const transport = {
    read: async (input: {
      operation_id: string
      frame: ReturnType<typeof frame>
      model: string
    }) => {
      reads.push(input)
      return {
        note: {
          id: input.frame.id,
          sequence: input.frame.sequence,
          text: `Read ${input.frame.id}`,
          model: input.model,
          uncertainty: "",
        },
        operation_id: input.operation_id,
      }
    },
    compact: async () => ({ summary: "", operation_id: "compact" }),
  }
  const memory = {
    append(note: (typeof notes)[number]) {
      notes.push(note)
      return { status: "accepted" as const }
    },
    snapshot: () => ({ summary: "", notes: [...notes] }),
    needsCompaction: () => false,
    beginCompaction: () => null,
    commitCompaction: () => false,
    clear() {
      notes.length = 0
    },
  }
  const session = createBrowserReadingSession({
    capture,
    transport,
    memory,
    clock: { now: () => FIXED_NOW },
  })
  return {
    session,
    reads,
    capture,
    transport,
    memory,
    get stopCount() {
      return stopCount
    },
    offer(candidate: ReturnType<typeof frame>): boolean | undefined {
      return offer?.(candidate)
    },
  }
}

describe("BrowserReadingSession", () => {
  it("cancels a question promptly when sharing stops during capture encoding", async () => {
    const harness = createHarness()
    const session = createBrowserReadingSession({
      capture: {
        ...harness.capture,
        checkpoint: () => ({
          sequence: 1,
          settled: new Promise<void>(() => {}),
        }),
      },
      transport: harness.transport,
      memory: harness.memory,
      clock: { now: () => FIXED_NOW },
    })
    session.start("chat-a", "draft-1", "model-a")
    const queued = session.queueQuestion("chat-a")!
    const ready = queued.ready!(new AbortController().signal)
    session.stop()
    await expect(ready).rejects.toThrow("could not settle")
    expect(harness.reads).toHaveLength(0)
  })

  it("fails preparation rather than submitting empty context when encoding stalls", async () => {
    vi.useFakeTimers()
    try {
      const harness = createHarness()
      const session = createBrowserReadingSession({
        capture: {
          ...harness.capture,
          checkpoint: () => ({
            sequence: 1,
            settled: new Promise<void>(() => {}),
          }),
        },
        transport: harness.transport,
        memory: harness.memory,
        clock: { now: () => FIXED_NOW },
      })
      session.start("chat-a", "draft-1", "model-a")
      const queued = session.queueQuestion("chat-a")!
      const outcome = expect(
        queued.ready!(new AbortController().signal),
      ).rejects.toThrow("could not settle")
      await vi.advanceTimersByTimeAsync(5_001)
      await outcome
      expect(harness.reads).toHaveLength(0)
      session.cancelPreparedQuestion(queued.operation_id)
      session.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it("includes a frame selected before Send even when encoding finishes afterward", async () => {
    const harness = createHarness()
    let finishEncoding: (() => void) | undefined
    const encoding = new Promise<void>((resolve) => {
      finishEncoding = resolve
    })
    const session = createBrowserReadingSession({
      capture: {
        ...harness.capture,
        checkpoint: () => ({ sequence: 1, settled: encoding }),
      },
      transport: harness.transport,
      memory: harness.memory,
      clock: { now: () => FIXED_NOW },
    })
    session.start("chat-a", "draft-1", "model-a")
    const queued = session.queueQuestion("chat-a")!
    const ready = queued.ready!(new AbortController().signal)
    harness.offer(frame("current-check-in", 1))
    harness.offer(frame("after-send", 2))
    finishEncoding?.()
    const context = await ready
    expect(context.cutoff).toBe(1)
    expect(context.pending_frames.map((item) => item.id)).toEqual([
      "current-check-in",
    ])
    expect(context.current_view).toBeNull()
    expect(harness.reads).toHaveLength(0)
    session.cancelPreparedQuestion(queued.operation_id)
    session.stop()
  })

  it("stopping sharing promptly rejects a question waiting on a lost read response", async () => {
    const harness = createHarness()
    const session = createBrowserReadingSession({
      capture: harness.capture,
      transport: {
        ...harness.transport,
        read: () => new Promise(() => {}),
        settle: async (operation_id) => ({
          operation_id,
          state: "settled",
          cancelled: true,
        }),
      },
      memory: harness.memory,
      clock: { now: () => FIXED_NOW },
    })
    session.start("chat-a", "draft-1", "model-a")
    harness.offer(frame("frame-1", 1))
    const question = session.queueQuestion("chat-a")!
    let outcome = "waiting"
    void question.ready!(new AbortController().signal).then(
      () => {
        outcome = "ready"
      },
      () => {
        outcome = "rejected"
      },
    )
    session.stop()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(outcome).toBe("rejected")
  })
  it("continues reading and accepts questions after a definite HTTP rejection", async () => {
    const harness = createHarness()
    let attempts = 0
    const session = createBrowserReadingSession({
      capture: harness.capture,
      transport: {
        ...harness.transport,
        read: async (input) => {
          attempts += 1
          if (attempts === 1) throw new BrowserOperationError(409)
          return harness.transport.read(input)
        },
        settle: async (operation_id) => ({
          operation_id,
          state: "unknown",
          cancelled: false,
        }),
      },
      memory: harness.memory,
      clock: { now: () => FIXED_NOW },
    })
    session.start("chat-a", "draft-1", "model-a")
    harness.offer(frame("frame-1", 1))
    harness.offer(frame("frame-2", 2))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(harness.reads.map((item) => item.frame.id)).toEqual(["frame-2"])
    expect(session.getSnapshot().gapCount).toBe(1)
    expect(await session.prepareQuestion("chat-a")).toBeTruthy()
  })

  it("reserves a question immediately and refreshes its memory after the in-flight read", async () => {
    const harness = createHarness()
    let finishRead: (() => void) | undefined
    const session = createBrowserReadingSession({
      capture: harness.capture,
      transport: {
        ...harness.transport,
        read: (input) =>
          new Promise((resolve) => {
            finishRead = () =>
              resolve({
                operation_id: input.operation_id,
                note: {
                  id: input.frame.id,
                  sequence: input.frame.sequence,
                  text: "Aster opens at noon.",
                  model: input.model,
                  uncertainty: "",
                },
              })
          }),
      },
      memory: harness.memory,
      clock: { now: () => FIXED_NOW },
    })
    session.start("chat-a", "draft-1", "model-a")
    harness.offer(frame("frame-1", 1))
    harness.offer(frame("frame-2", 2))

    const queued = session.queueQuestion("chat-a")
    expect(queued?.operation_id).toBeTruthy()
    expect(session.getSnapshot().state).toBe("question")
    expect(queued?.context.notes).toHaveLength(0)
    const ready = queued?.ready?.(new AbortController().signal)
    finishRead?.()

    expect((await ready)?.notes[0].text).toBe("Aster opens at noon.")
    expect((await ready)?.pending_frames.map((item) => item.id)).toEqual([
      "frame-2",
    ])
  })

  it("keeps a question pending while a slow healthy background read finishes", async () => {
    vi.useFakeTimers()
    try {
      const harness = createHarness()
      let finishRead: (() => void) | undefined
      const settle = vi.fn(async (operation_id: string) => ({
        operation_id,
        state: "active" as const,
        cancelled: true,
      }))
      const session = createBrowserReadingSession({
        capture: harness.capture,
        transport: {
          ...harness.transport,
          read: (input) =>
            new Promise((resolve) => {
              finishRead = () =>
                resolve({
                  operation_id: input.operation_id,
                  note: {
                    id: input.frame.id,
                    sequence: input.frame.sequence,
                    text: "The page says moon-basil blooms at sunset.",
                    model: input.model,
                    uncertainty: "",
                  },
                })
            }),
          settle,
        },
        memory: harness.memory,
        clock: { now: () => FIXED_NOW },
      })
      session.start("chat-a", "draft-1", "model-a")
      harness.offer(frame("frame-1", 1))
      harness.offer(frame("frame-2", 2))
      const prepared = session.prepareQuestion("chat-a")

      await vi.advanceTimersByTimeAsync(20_000)
      expect(settle).not.toHaveBeenCalled()
      finishRead?.()
      expect((await prepared)?.context.notes[0].text).toContain("moon-basil")
      expect((await prepared)?.context.pending_frames[0].id).toBe("frame-2")
    } finally {
      vi.useRealTimers()
    }
  })

  it("cancels a waiting question without losing or duplicating the active image read", async () => {
    const harness = createHarness()
    let finishRead: (() => void) | undefined
    let reads = 0
    const session = createBrowserReadingSession({
      capture: harness.capture,
      transport: {
        ...harness.transport,
        read: async (input) => {
          reads += 1
          if (reads === 1)
            await new Promise<void>((resolve) => {
              finishRead = resolve
            })
          return {
            operation_id: input.operation_id,
            note: {
              id: input.frame.id,
              sequence: input.frame.sequence,
              text: "A page note",
              model: input.model,
              uncertainty: "",
            },
          }
        },
      },
      memory: harness.memory,
      clock: { now: () => FIXED_NOW },
    })
    session.start("chat-a", "draft-1", "model-a")
    harness.offer(frame("frame-1", 1))
    harness.offer(frame("frame-2", 2))
    const question = session.queueQuestion("chat-a")!
    const controller = new AbortController()
    const ready = question.ready!(controller.signal)
    controller.abort()
    await expect(ready).rejects.toHaveProperty("name", "AbortError")
    await session.interruptQuestion()
    expect(reads).toBe(1)
    finishRead?.()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(session.getSnapshot().noteCount).toBe(2)
    expect(reads).toBe(2)
    expect(session.getSnapshot().state).toBe("ready")
  })

  it("freezes the pending batch for a question while later captures remain future work", async () => {
    const harness = createHarness()
    harness.session.start("chat-a", "draft-1", "model-a")
    harness.offer(frame("frame-1", 1))
    harness.offer(frame("frame-2", 2))

    const preparedPromise = harness.session.prepareQuestion("chat-a")
    harness.offer(frame("frame-3", 3))
    const prepared = await preparedPromise

    expect(prepared).toBeTruthy()
    if (!prepared) throw new Error("Question preparation did not complete.")
    expect(harness.session.getSnapshot().ownerChatId).toBe("chat-a")
    expect(prepared.context.pending_frames.map((item) => item.id)).toEqual([
      "frame-2",
    ])
    expect(harness.reads.map((item) => item.frame.id)).toEqual(["frame-1"])
    expect(harness.session.getSnapshot().pendingCount).toBe(2)
  })

  it("returns a cached snapshot identity for external-store subscriptions", () => {
    const harness = createHarness()

    expect(harness.session.getSnapshot()).toBe(harness.session.getSnapshot())
  })

  it("pins the owner model when question preparation begins", async () => {
    const harness = createHarness()
    harness.session.start("chat-a", "draft-1", "model-a")
    harness.offer(frame("frame-1", 1))

    const preparedPromise = harness.session.prepareQuestion("chat-a")
    harness.session.setOwnerModel("model-b")
    const prepared = await preparedPromise

    expect(prepared?.model).toBe("model-a")
    expect(harness.session.getSnapshot().model).toBe("model-b")
  })

  it("records an invalid receipt as a gap without automatically replaying frames", async () => {
    const harness = createHarness()
    harness.session.start("chat-a", "draft-1", "model-a")
    harness.offer(frame("frame-1", 1))
    harness.offer(frame("frame-2", 2))
    const prepared = await harness.session.prepareQuestion("chat-a")

    expect(prepared?.context.pending_frames.map((item) => item.id)).toEqual([
      "frame-2",
    ])
    const finished = harness.session.finishQuestion({
      operation_id: prepared?.operation_id ?? "unknown",
      completed_ids: ["foreign-frame"],
      failed_ids: [],
      unused_ids: [],
    })

    expect(finished).toBe(false)
    expect(harness.reads.map((item) => item.frame.id)).toEqual(["frame-1"])
    expect(harness.session.getSnapshot().gapCount).toBe(1)
  })

  it("returns unused frames to background reading only after the receipt settles", async () => {
    const harness = createHarness()
    harness.session.start("chat-a", "draft-1", "model-a")
    harness.offer(frame("frame-1", 1))
    harness.offer(frame("frame-2", 2))
    const prepared = await harness.session.prepareQuestion("chat-a")
    harness.offer(frame("frame-3", 3))

    expect(harness.reads.map((item) => item.frame.id)).toEqual(["frame-1"])
    const finished = harness.session.finishQuestion({
      operation_id: prepared?.operation_id ?? "unknown",
      completed_ids: [],
      failed_ids: [],
      unused_ids: ["frame-2"],
    })

    expect(finished).toBe(true)
    expect(harness.reads.map((item) => item.frame.id)).toEqual([
      "frame-1",
      "frame-2",
    ])
  })

  it("waits for operation settlement before resuming background reads after interruption", async () => {
    const harness = createHarness()
    let releaseSettlement: (() => void) | undefined
    let settleCount = 0
    const transport = {
      ...harness.transport,
      settle: async () => {
        settleCount += 1
        await new Promise<void>((resolve) => {
          releaseSettlement = resolve
        })
        return {
          operation_id: "question-operation",
          state: "settled" as const,
          cancelled: true,
        }
      },
    }
    const session = createBrowserReadingSession({
      capture: harness.capture,
      transport,
      memory: harness.memory,
      clock: { now: () => FIXED_NOW },
    })
    session.start("chat-a", "draft-1", "model-a")
    harness.offer(frame("frame-1", 1))
    harness.offer(frame("frame-2", 2))
    const prepared = await session.prepareQuestion("chat-a")
    expect(prepared).toBeTruthy()
    harness.offer(frame("frame-3", 3))
    session.markQuestionDispatched(prepared?.operation_id ?? "")

    const interrupted = session.interruptQuestion()
    expect(settleCount).toBe(1)
    expect(harness.reads.map((item) => item.frame.id)).toEqual(["frame-1"])
    releaseSettlement?.()
    await interrupted

    expect(harness.reads.map((item) => item.frame.id)).toEqual([
      "frame-1",
      "frame-3",
    ])
    expect(session.getSnapshot().gapCount).toBe(1)
  })

  it("does not treat an active cancelled status as settled", async () => {
    const harness = createHarness()
    const session = createBrowserReadingSession({
      capture: harness.capture,
      transport: {
        ...harness.transport,
        settle: async (operation_id) => ({
          operation_id,
          state: "active",
          cancelled: true,
        }),
      },
      memory: harness.memory,
      clock: { now: () => FIXED_NOW },
    })
    session.start("chat-a", "draft-1", "model-a")
    harness.offer(frame("frame-1", 1))
    harness.offer(frame("frame-2", 2))
    const prepared = await session.prepareQuestion("chat-a")
    session.markQuestionDispatched(prepared?.operation_id ?? "")
    harness.offer(frame("frame-3", 3))

    await session.interruptQuestion()

    expect(harness.reads.map((item) => item.frame.id)).toEqual(["frame-1"])
    expect(session.getSnapshot().gapCount).toBe(1)
  })

  it("settles physical compaction before preparing or restarting", async () => {
    const harness = createHarness()
    let resolveCompaction:
      | ((result: { summary: string; operation_id: string }) => void)
      | undefined
    const memoryNotes: Array<(typeof harness.reads)[number]> = []
    let compactOperationId = ""
    const memory = {
      append: () => ({ status: "accepted" as const }),
      snapshot: () => ({ summary: "", notes: [] }),
      needsCompaction: () => true,
      beginCompaction: () => ({
        version: 0,
        prefixIds: ["frame-1"],
        summary: "",
        notes: [],
      }),
      commitCompaction: () => {
        memoryNotes.push({
          operation_id: "compacted",
          frame: frame("x", 1),
          model: "m",
        })
        return true
      },
      clear: () => {
        memoryNotes.length = 0
      },
    }
    const settleCalls: string[] = []
    const session = createBrowserReadingSession({
      capture: harness.capture,
      transport: {
        ...harness.transport,
        compact: (input) => {
          compactOperationId = input.operation_id
          return new Promise((resolve) => {
            resolveCompaction = resolve
          })
        },
        settle: async (operation_id) => {
          settleCalls.push(operation_id)
          return { operation_id, state: "active", cancelled: true }
        },
      },
      memory,
      clock: { now: () => FIXED_NOW },
    })
    session.start("chat-a", "draft-1", "model-a")
    harness.offer(frame("frame-1", 1))
    await new Promise((resolve) => setTimeout(resolve, 0))

    session.stop()
    session.start("chat-b", "draft-2", "model-b")
    expect(session.getSnapshot().state).toBe("stopped")
    expect(settleCalls).toContain(compactOperationId)

    resolveCompaction?.({ operation_id: compactOperationId, summary: "stale" })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(memoryNotes).toEqual([])
    expect(session.getSnapshot().state).toBe("stopped")
  })

  it("caps admitted frame jobs and keeps text questions available at capacity", async () => {
    const harness = createHarness()
    harness.session.start("chat-a", "draft-1", "model-a")
    for (let index = 1; index <= 201; index += 1) {
      harness.offer(frame(`frame-${index}`, index))
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    expect(harness.reads).toHaveLength(200)
    expect(harness.session.getSnapshot().capacityReached).toBe(true)
    expect(await harness.session.prepareQuestion("chat-a")).toBeTruthy()
  })

  it("explicitly cancels an undispatched question and makes its frames eligible again", async () => {
    const harness = createHarness()
    harness.session.start("chat-a", "draft-1", "model-a")
    harness.offer(frame("frame-1", 1))
    harness.offer(frame("frame-2", 2))
    const prepared = await harness.session.prepareQuestion("chat-a")
    expect(prepared?.context.pending_frames.map((item) => item.id)).toEqual([
      "frame-2",
    ])

    expect(
      harness.session.cancelPreparedQuestion(prepared?.operation_id ?? ""),
    ).toBe(true)

    expect(harness.reads.map((item) => item.frame.id)).toEqual([
      "frame-1",
      "frame-2",
    ])
    expect(harness.session.getSnapshot().pendingCount).toBe(0)
  })

  it("does not resume the queue when interrupted operation status is unknown", async () => {
    const harness = createHarness()
    const session = createBrowserReadingSession({
      capture: harness.capture,
      transport: {
        ...harness.transport,
        settle: async (operation_id) => ({
          operation_id,
          state: "unknown",
          cancelled: false,
        }),
      },
      memory: harness.memory,
      clock: { now: () => FIXED_NOW },
    })
    session.start("chat-a", "draft-1", "model-a")
    harness.offer(frame("frame-1", 1))
    harness.offer(frame("frame-2", 2))
    const prepared = await session.prepareQuestion("chat-a")
    harness.offer(frame("frame-3", 3))
    session.markQuestionDispatched(prepared?.operation_id ?? "")

    await session.interruptQuestion()

    expect(session.isPreparedQuestionActive(prepared?.operation_id ?? "")).toBe(
      false,
    )
    expect(harness.reads.map((item) => item.frame.id)).toEqual(["frame-1"])
    expect(session.getSnapshot().pendingCount).toBe(1)
    expect(session.getSnapshot().gapCount).toBe(1)
  })

  it("binds only the originating draft and clears its retained notes on stop", async () => {
    const harness = createHarness()
    harness.session.start(null, "draft-1", "model-a")

    expect(
      harness.session.bindToThread({
        draftNonce: "wrong-draft",
        threadId: "thread-a",
      }),
    ).toBe(false)
    expect(
      harness.session.bindToThread({
        draftNonce: "draft-1",
        threadId: "thread-a",
      }),
    ).toBe(true)
    expect(
      harness.session.bindToThread({
        draftNonce: "draft-1",
        threadId: "thread-b",
      }),
    ).toBe(false)
    expect(await harness.session.prepareQuestion("draft-1")).toBeNull()
    expect(await harness.session.prepareQuestion("other-chat")).toBeNull()
    harness.offer(frame("frame-1", 1))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(harness.session.getSnapshot().noteCount).toBe(1)

    harness.session.stop()

    expect(harness.session.getSnapshot().state).toBe("stopped")
    expect(harness.session.getSnapshot().noteCount).toBe(0)
    expect(harness.session.getSnapshot().pendingCount).toBe(0)
    expect(harness.stopCount).toBe(1)
  })

  it("ignores a read that completes after its session generation stops", async () => {
    let resolveRead: (() => void) | undefined
    let offer: ((candidate: ReturnType<typeof frame>) => void) | undefined
    const capture = {
      start(onCandidate: (candidate: ReturnType<typeof frame>) => void) {
        offer = onCandidate
      },
      stop() {},
    }
    const memoryNotes: Array<{
      id: string
      sequence: number
      text: string
      model: string
      uncertainty: string
    }> = []
    const session = createBrowserReadingSession({
      capture,
      transport: {
        read: (input) =>
          new Promise((resolve) => {
            resolveRead = () =>
              resolve({
                operation_id: input.operation_id,
                note: {
                  id: "frame-1",
                  sequence: 1,
                  text: "stale completion",
                  model: input.model,
                  uncertainty: "",
                },
              })
          }),
        compact: async () => ({ operation_id: "compact", summary: "" }),
      },
      memory: {
        append(note) {
          memoryNotes.push(note)
          return { status: "accepted" }
        },
        snapshot: () => ({ summary: "", notes: [...memoryNotes] }),
        needsCompaction: () => false,
        beginCompaction: () => null,
        commitCompaction: () => false,
        clear: () => {
          memoryNotes.length = 0
        },
      },
      clock: { now: () => FIXED_NOW },
    })
    session.start("chat-a", "draft-1", "model-a")
    offer?.(frame("frame-1", 1))
    session.stop()
    resolveRead?.()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(memoryNotes).toEqual([])
    expect(session.getSnapshot().state).toBe("stopped")
    expect(session.getSnapshot().noteCount).toBe(0)
  })
})
