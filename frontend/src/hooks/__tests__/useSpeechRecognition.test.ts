import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition"

let lastInstance: MockSpeechRecognition | null = null

class MockSpeechRecognition {
  continuous = true
  interimResults = true
  lang = "en-US"
  onstart: (() => void) | null = null
  onresult: ((event: unknown) => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  onend: (() => void) | null = null

  constructor() {
    lastInstance = this
  }

  start = vi.fn(() => {
    this.onstart?.()
  })

  stop = vi.fn(() => {
    this.onend?.()
  })

  abort = vi.fn(() => {
    this.onend?.()
  })
}

function emitSpeechResult(
  results: Array<{ transcript: string; isFinal: boolean; confidence?: number }>,
) {
  const formattedResults = results.map((r) => ({
    0: { transcript: r.transcript, confidence: r.confidence ?? 0.95 },
    isFinal: r.isFinal,
    length: 1,
  }))

  act(() => {
    lastInstance?.onresult?.({
      resultIndex: Math.max(0, results.length - 1),
      results: formattedResults,
    })
  })
}

describe("useSpeechRecognition", () => {
  beforeEach(() => {
    lastInstance = null
    // @ts-expect-error Mocking window global
    window.SpeechRecognition = MockSpeechRecognition
  })

  afterEach(() => {
    // @ts-expect-error Resetting window global
    delete window.SpeechRecognition
    // @ts-expect-error Resetting webkit window global
    delete window.webkitSpeechRecognition
    vi.restoreAllMocks()
  })

  it("initializes with isSupported true when SpeechRecognition exists", () => {
    const { result } = renderHook(() => useSpeechRecognition())
    expect(result.current.isSupported).toBe(true)
    expect(result.current.isListening).toBe(false)
  })

  it("starts and stops listening cleanly", () => {
    const onTranscriptChange = vi.fn()
    const { result } = renderHook(() =>
      useSpeechRecognition({ onTranscriptChange }),
    )

    act(() => {
      result.current.startListening()
    })
    expect(result.current.isListening).toBe(true)

    act(() => {
      result.current.stopListening()
    })
    expect(result.current.isListening).toBe(false)
  })

  it("handles interim hypothesis updates without finalizing", () => {
    const { result } = renderHook(() => useSpeechRecognition())
    act(() => {
      result.current.startListening()
    })

    emitSpeechResult([{ transcript: "hello", isFinal: false }])
    expect(result.current.transcript).toBe("hello")
    expect(result.current.interimTranscript).toBe("hello")
    expect(result.current.finalTranscript).toBe("")
  })

  it("commits finalized transcript results cleanly", () => {
    const { result } = renderHook(() => useSpeechRecognition())
    act(() => {
      result.current.startListening()
    })

    emitSpeechResult([{ transcript: "hello world", isFinal: true }])
    expect(result.current.transcript).toBe("hello world")
    expect(result.current.interimTranscript).toBe("")
    expect(result.current.finalTranscript).toBe("hello world")
  })

  it("aggregates sequential phrases without word duplication", () => {
    const { result } = renderHook(() => useSpeechRecognition())
    act(() => {
      result.current.startListening()
    })

    emitSpeechResult([
      { transcript: "hello world", isFinal: true },
      { transcript: "how are you", isFinal: false },
    ])

    expect(result.current.transcript).toBe("hello world how are you")
    expect(result.current.interimTranscript).toBe("how are you")
    expect(result.current.finalTranscript).toBe("hello world")
  })

  it("handles non-fatal no-speech errors gracefully", () => {
    const { result } = renderHook(() => useSpeechRecognition())
    act(() => {
      result.current.startListening()
    })
    act(() => {
      result.current.resetError()
    })
    expect(result.current.error).toBeNull()
  })
})
