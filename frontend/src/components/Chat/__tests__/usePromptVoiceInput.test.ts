import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { usePromptVoiceInput } from "../usePromptVoiceInput"

interface SpeechResult {
  isFinal: boolean
  length: number
  0: { transcript: string; confidence: number }
}

interface SpeechEvent {
  resultIndex: number
  results: SpeechResult[]
}

let lastInstance: MockSpeechRecognition | null = null

class MockSpeechRecognition {
  continuous = true
  interimResults = true
  lang = "en-US"
  onstart: (() => void) | null = null
  onresult: ((event: SpeechEvent) => void) | null = null
  onerror: ((event: { error: string; message?: string }) => void) | null = null
  onend: (() => void) | null = null

  constructor() {
    lastInstance = this
  }

  start = vi.fn(() => this.onstart?.())
  stop = vi.fn(() => this.onend?.())
  abort = vi.fn(() => this.onend?.())
}

function emitResult(transcript: string) {
  act(() => {
    lastInstance?.onresult?.({
      resultIndex: 0,
      results: [
        {
          0: { transcript, confidence: 0.99 },
          isFinal: true,
          length: 1,
        },
      ],
    })
  })
}

describe("usePromptVoiceInput", () => {
  beforeEach(() => {
    lastInstance = null
    // @ts-expect-error Mocking the browser speech recognition global
    window.SpeechRecognition = MockSpeechRecognition
  })

  afterEach(() => {
    // @ts-expect-error Resetting the mocked browser global
    delete window.SpeechRecognition
    // @ts-expect-error Resetting the mocked browser global
    delete window.webkitSpeechRecognition
    vi.restoreAllMocks()
  })

  it("ignores a speech result arriving after submission stops and resets voice", () => {
    const updateInput = vi.fn()
    const { result } = renderHook(() =>
      usePromptVoiceInput({ input: "question", updateInput }),
    )

    act(() => result.current.handleToggleVoice())
    act(() => result.current.stopAndReset())
    emitResult("late final")

    expect(updateInput).not.toHaveBeenCalled()
  })

  it("accepts results from a new recording after submission reset", () => {
    const updateInput = vi.fn()
    const { result } = renderHook(() =>
      usePromptVoiceInput({ input: "question", updateInput }),
    )

    act(() => result.current.stopAndReset())
    act(() => result.current.handleToggleVoice())
    emitResult("new phrase")

    expect(updateInput).toHaveBeenCalledWith("question new phrase")
  })
})
