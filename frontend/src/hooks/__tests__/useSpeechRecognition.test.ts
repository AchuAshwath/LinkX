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

  it("processes interim and final results in sequence without duplication", () => {
    const onTranscriptChange = vi.fn()
    const { result } = renderHook(() =>
      useSpeechRecognition({ onTranscriptChange }),
    )

    act(() => {
      result.current.startListening()
    })

    // 1. Interim hypothesis
    act(() => {
      lastInstance?.onresult?.({
        resultIndex: 0,
        results: [
          {
            0: { transcript: "hello", confidence: 0.9 },
            isFinal: false,
            length: 1,
          },
        ],
      })
    })

    expect(result.current.transcript).toBe("hello")
    expect(result.current.interimTranscript).toBe("hello")
    expect(result.current.finalTranscript).toBe("")

    // 2. Updated interim hypothesis (same index 0)
    act(() => {
      lastInstance?.onresult?.({
        resultIndex: 0,
        results: [
          {
            0: { transcript: "hello world", confidence: 0.95 },
            isFinal: false,
            length: 1,
          },
        ],
      })
    })

    expect(result.current.transcript).toBe("hello world")
    expect(result.current.interimTranscript).toBe("hello world")
    expect(result.current.finalTranscript).toBe("")

    // 3. Finalized result
    act(() => {
      lastInstance?.onresult?.({
        resultIndex: 0,
        results: [
          {
            0: { transcript: "hello world", confidence: 0.98 },
            isFinal: true,
            length: 1,
          },
        ],
      })
    })

    expect(result.current.transcript).toBe("hello world")
    expect(result.current.interimTranscript).toBe("")
    expect(result.current.finalTranscript).toBe("hello world")

    // 4. Second phrase interim
    act(() => {
      lastInstance?.onresult?.({
        resultIndex: 1,
        results: [
          {
            0: { transcript: "hello world", confidence: 0.98 },
            isFinal: true,
            length: 1,
          },
          {
            0: { transcript: "how are you", confidence: 0.9 },
            isFinal: false,
            length: 1,
          },
        ],
      })
    })

    expect(result.current.transcript).toBe("hello world how are you")
    expect(result.current.interimTranscript).toBe("how are you")
    expect(result.current.finalTranscript).toBe("hello world")
  })

  it("handles non-fatal no-speech errors gracefully", () => {
    const onError = vi.fn()
    const { result } = renderHook(() => useSpeechRecognition({ onError }))

    act(() => {
      result.current.startListening()
    })

    act(() => {
      result.current.resetError()
    })
    expect(result.current.error).toBeNull()
  })
})
