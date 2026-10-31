import { afterEach, describe, expect, it, vi } from "vitest"
import {
  type BrowserReadingDebugApi,
  installBrowserReadingDebug,
  publishBrowserBudget,
} from "../debug"
import { createBrowserMemory } from "../memory"
import type { BrowserReadingSnapshot } from "../session"

function initialSnapshot(): BrowserReadingSnapshot {
  return {
    state: "stopped",
    ownerChatId: null,
    threadId: null,
    draftNonce: null,
    model: null,
    pendingCount: 0,
    noteCount: 0,
    gapCount: 0,
    capacityReached: false,
    currentView: null,
  }
}

function makeHarness() {
  const memory = createBrowserMemory({ maxBytes: 32768, keepRecent: 1 })
  let current = initialSnapshot()
  const listeners = new Set<() => void>()
  const session = {
    getSnapshot: () => current,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  return {
    memory,
    session,
    update(snapshot: BrowserReadingSnapshot) {
      current = snapshot
      listeners.forEach((listener) => {
        listener()
      })
    },
  }
}

function note(id: string, sequence: number, text: string) {
  return { id, sequence, text, model: "model-a", uncertainty: "" }
}

function budget(overrides: Record<string, unknown> = {}) {
  return {
    model_id: "openai/model-a",
    model_input_capacity: 128000,
    input_limit: 64000,
    output_reserve: 4000,
    estimated_input_tokens: 12000,
    history_messages: 8,
    omitted_history_messages: 2,
    ...overrides,
  }
}

afterEach(() => {
  delete window.browserReadingDebug
  vi.restoreAllMocks()
})

describe("browser reading debug console", () => {
  it("shows appended memory and compaction in snapshots without retaining history", () => {
    const harness = makeHarness()
    const dispose = installBrowserReadingDebug({
      session: harness.session,
      memory: harness.memory,
    })
    const api = window.browserReadingDebug as BrowserReadingDebugApi
    harness.memory.append(note("one", 1, "First note"))
    harness.memory.append(note("two", 2, "Second note"))
    harness.update({ ...initialSnapshot(), state: "reading", noteCount: 2 })

    expect(api.snapshot()).toMatchObject({
      state: "reading",
      memory: {
        summary: "",
        notes: [
          { id: "one", text: "First note" },
          { id: "two", text: "Second note" },
        ],
      },
    })
    const ticket = harness.memory.beginCompaction()!
    expect(harness.memory.commitCompaction(ticket, "A compact summary."))
    harness.update({ ...initialSnapshot(), state: "ready", noteCount: 0 })
    expect(api.snapshot().memory).toMatchObject({
      summary: "A compact summary.",
      notes: [{ id: "two", text: "Second note" }],
    })
    dispose()
  })

  it("returns empty stopped state and stops logging when disabled", () => {
    const harness = makeHarness()
    const log = vi.spyOn(console, "log").mockImplementation(() => {})
    const dispose = installBrowserReadingDebug({
      session: harness.session,
      memory: harness.memory,
    })
    const api = window.browserReadingDebug as BrowserReadingDebugApi
    api.enable()
    harness.update({
      ...initialSnapshot(),
      state: "ready",
      ownerChatId: "chat",
    })
    const loggedBeforeDisable = log.mock.calls.length
    api.disable()
    harness.update(initialSnapshot())

    expect(api.snapshot()).toMatchObject({
      state: "stopped",
      ownerChatId: null,
      queue: { pending: 0 },
      gaps: 0,
      memory: { summary: "", notes: [] },
    })
    expect(log).toHaveBeenCalledTimes(loggedBeforeDisable)
    dispose()
  })

  it("logs metadata by default and includes note content only when enabled", () => {
    const harness = makeHarness()
    const log = vi.spyOn(console, "log").mockImplementation(() => {})
    const dispose = installBrowserReadingDebug({
      session: harness.session,
      memory: harness.memory,
    })
    const api = window.browserReadingDebug as BrowserReadingDebugApi
    harness.memory.append(note("secret-id", 1, "Private note body"))
    api.enable()
    harness.update({ ...initialSnapshot(), state: "reading", noteCount: 1 })
    expect(JSON.stringify(log.mock.calls)).not.toContain("Private note body")
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret-id")

    api.enable({ content: true })
    harness.update({ ...initialSnapshot(), state: "ready", noteCount: 1 })
    expect(JSON.stringify(log.mock.calls)).toContain("Private note body")
    expect(JSON.stringify(log.mock.calls)).toContain("secret-id")
    dispose()
  })

  it("removes the global and subscription when disposed", () => {
    const harness = makeHarness()
    const log = vi.spyOn(console, "log").mockImplementation(() => {})
    const dispose = installBrowserReadingDebug({
      session: harness.session,
      memory: harness.memory,
    })
    const api = window.browserReadingDebug as BrowserReadingDebugApi
    api.enable()
    const loggedAtEnable = log.mock.calls.length
    dispose()
    harness.update({ ...initialSnapshot(), state: "ready" })

    expect(window.browserReadingDebug).toBeUndefined()
    expect(log).toHaveBeenCalledTimes(loggedAtEnable)
  })

  it("accepts numeric budget events only for the active matching thread and model", () => {
    const harness = makeHarness()
    const dispose = installBrowserReadingDebug({
      session: harness.session,
      memory: harness.memory,
    })
    const api = window.browserReadingDebug as BrowserReadingDebugApi
    harness.update({
      ...initialSnapshot(),
      state: "reading",
      ownerChatId: "thread-a",
      model: "model-a",
    })

    publishBrowserBudget({ threadId: "thread-b", budget: budget() })
    expect(api.snapshot().budget).toBeNull()
    publishBrowserBudget({
      threadId: "thread-a",
      budget: budget({ model_id: "model-b" }),
    })
    expect(api.snapshot().budget).toBeNull()

    publishBrowserBudget({ threadId: "thread-a", budget: budget() })
    expect(api.snapshot().budget).toEqual(budget())
    dispose()
  })

  it("clears a published budget when its session stops or changes owner", () => {
    const harness = makeHarness()
    const dispose = installBrowserReadingDebug({
      session: harness.session,
      memory: harness.memory,
    })
    const api = window.browserReadingDebug as BrowserReadingDebugApi
    harness.update({
      ...initialSnapshot(),
      state: "ready",
      ownerChatId: "thread-a",
      model: "model-a",
    })
    publishBrowserBudget({ threadId: "thread-a", budget: budget() })
    expect(api.snapshot().budget).not.toBeNull()

    harness.update({
      ...initialSnapshot(),
      state: "ready",
      ownerChatId: "thread-b",
      model: "model-a",
    })
    expect(api.snapshot().budget).toBeNull()
    publishBrowserBudget({ threadId: "thread-b", budget: budget() })
    harness.update({
      ...initialSnapshot(),
      state: "ready",
      ownerChatId: "thread-b",
      model: "model-b",
    })
    expect(api.snapshot().budget).toBeNull()
    publishBrowserBudget({
      threadId: "thread-b",
      budget: budget({ model_id: "openai/model-b" }),
    })
    harness.update(initialSnapshot())
    expect(api.snapshot().budget).toBeNull()
    dispose()
  })

  it("rejects malformed token budgets and logs numeric budget metadata", () => {
    const harness = makeHarness()
    const log = vi.spyOn(console, "log").mockImplementation(() => {})
    const dispose = installBrowserReadingDebug({
      session: harness.session,
      memory: harness.memory,
    })
    const api = window.browserReadingDebug as BrowserReadingDebugApi
    harness.update({
      ...initialSnapshot(),
      state: "ready",
      ownerChatId: "thread-a",
      model: "model-a",
    })
    publishBrowserBudget({
      threadId: "thread-a",
      budget: budget({ estimated_input_tokens: "secret" }),
    })
    expect(api.snapshot().budget).toBeNull()

    api.enable()
    publishBrowserBudget({
      threadId: "thread-a",
      budget: budget({ history_text: "secret history" }),
    })
    const output = JSON.stringify(log.mock.calls)
    expect(output).toContain("model_input_capacity")
    expect(output).toContain("estimated_input_tokens")
    expect(output).not.toContain("secret history")
    dispose()
  })
})
