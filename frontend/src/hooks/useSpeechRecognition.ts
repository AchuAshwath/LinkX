import * as React from "react"

export interface SpeechRecognitionHookOptions {
  lang?: string
  continuous?: boolean
  interimResults?: boolean
  onTranscriptChange?: (state: {
    transcript: string
    finalTranscript: string
    interimTranscript: string
  }) => void
  onError?: (error: string) => void
}

export interface UseSpeechRecognitionReturn {
  isListening: boolean
  isSupported: boolean
  transcript: string
  finalTranscript: string
  interimTranscript: string
  error: string | null
  startListening: () => void
  stopListening: () => void
  toggleListening: () => void
  resetTranscript: () => void
  resetError: () => void
}

interface SpeechRecognitionResultItem {
  transcript: string
  confidence: number
}

interface SpeechRecognitionResultLike {
  isFinal: boolean
  length: number
  [index: number]: SpeechRecognitionResultItem
}

interface SpeechRecognitionEventLike {
  resultIndex: number
  results: {
    length: number
    [index: number]: SpeechRecognitionResultLike
  }
}

interface SpeechRecognitionErrorEventLike {
  error: string
  message?: string
}

interface BrowserSpeechRecognition {
  continuous: boolean
  interimResults: boolean
  lang: string
  onstart: (() => void) | null
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}

type SpeechRecognitionConstructor = new () => BrowserSpeechRecognition

function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null
  const win = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor
    webkitSpeechRecognition?: SpeechRecognitionConstructor
  }
  return win.SpeechRecognition || win.webkitSpeechRecognition || null
}

function getReadableErrorMessage(errorCode: string): string {
  switch (errorCode) {
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone access denied. Please allow microphone permissions."
    case "no-speech":
      return "No speech detected."
    case "network":
      return "Speech service network error."
    case "audio-capture":
      return "No microphone found or audio capture error."
    default:
      return `Speech recognition error: ${errorCode}`
  }
}

function extractSessionTranscripts(
  results: SpeechRecognitionEventLike["results"],
): { sessionFinal: string; sessionInterim: string } {
  let sessionFinal = ""
  let sessionInterim = ""

  for (let i = 0; i < results.length; ++i) {
    const res = results[i]
    if (res?.[0]) {
      const text = res[0].transcript
      if (res.isFinal) {
        sessionFinal += (sessionFinal ? " " : "") + text.trim()
      } else {
        sessionInterim += (sessionInterim ? " " : "") + text.trim()
      }
    }
  }

  return { sessionFinal, sessionInterim }
}

export function useSpeechRecognition({
  lang = "en-US",
  continuous = true,
  interimResults = true,
  onTranscriptChange,
  onError,
}: SpeechRecognitionHookOptions = {}): UseSpeechRecognitionReturn {
  const [isListening, setIsListening] = React.useState(false)
  const [finalTranscript, setFinalTranscript] = React.useState("")
  const [interimTranscript, setInterimTranscript] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)

  const SpeechRecognitionClass = React.useMemo(
    () => getSpeechRecognitionConstructor(),
    [],
  )
  const isSupported = Boolean(SpeechRecognitionClass)

  const recognitionRef = React.useRef<BrowserSpeechRecognition | null>(null)
  const isExplicitlyStoppedRef = React.useRef(true)
  const isRecognizingRef = React.useRef(false)
  const isStartingRef = React.useRef(false)

  // Accumulated finals across silence auto-restarts
  const baseFinalRef = React.useRef("")
  const currentSessionFinalRef = React.useRef("")

  const onTranscriptChangeRef = React.useRef(onTranscriptChange)
  const onErrorRef = React.useRef(onError)

  React.useEffect(() => {
    onTranscriptChangeRef.current = onTranscriptChange
    onErrorRef.current = onError
  })

  const resetError = React.useCallback(() => setError(null), [])

  const resetTranscript = React.useCallback(() => {
    baseFinalRef.current = ""
    currentSessionFinalRef.current = ""
    setFinalTranscript("")
    setInterimTranscript("")
  }, [])

  const safeStart = React.useCallback(() => {
    const recognition = recognitionRef.current
    if (!recognition || isRecognizingRef.current || isStartingRef.current) {
      return
    }
    try {
      isStartingRef.current = true
      recognition.start()
    } catch {
      isStartingRef.current = false
    }
  }, [])

  const handleResult = React.useCallback(
    (event: SpeechRecognitionEventLike) => {
      const { sessionFinal, sessionInterim } = extractSessionTranscripts(
        event.results,
      )
      currentSessionFinalRef.current = sessionFinal

      const combinedFinal = [baseFinalRef.current, sessionFinal]
        .filter(Boolean)
        .join(" ")
        .trim()

      const fullTranscript = [combinedFinal, sessionInterim]
        .filter(Boolean)
        .join(" ")
        .trim()

      setFinalTranscript(combinedFinal)
      setInterimTranscript(sessionInterim)

      onTranscriptChangeRef.current?.({
        transcript: fullTranscript,
        finalTranscript: combinedFinal,
        interimTranscript: sessionInterim,
      })
    },
    [],
  )

  const handleError = React.useCallback(
    (event: SpeechRecognitionErrorEventLike) => {
      const errCode = event.error
      if (errCode === "no-speech" || errCode === "aborted") {
        return
      }

      if (errCode === "not-allowed" || errCode === "service-not-allowed") {
        isExplicitlyStoppedRef.current = true
        setIsListening(false)
      }

      const message = getReadableErrorMessage(errCode)
      setError(message)
      onErrorRef.current?.(message)
    },
    [],
  )

  const handleEnd = React.useCallback(() => {
    isRecognizingRef.current = false
    isStartingRef.current = false

    // Merge session final into base final for upcoming restart
    if (currentSessionFinalRef.current) {
      baseFinalRef.current = [
        baseFinalRef.current,
        currentSessionFinalRef.current,
      ]
        .filter(Boolean)
        .join(" ")
        .trim()
      currentSessionFinalRef.current = ""
    }
    setInterimTranscript("")

    if (!isExplicitlyStoppedRef.current) {
      // Auto-restart after silence timeout
      setTimeout(() => {
        if (!isExplicitlyStoppedRef.current) {
          safeStart()
        }
      }, 50)
    } else {
      setIsListening(false)
    }
  }, [safeStart])

  React.useEffect(() => {
    if (!SpeechRecognitionClass) return

    const instance = new SpeechRecognitionClass()
    instance.continuous = continuous
    instance.interimResults = interimResults
    instance.lang = lang

    instance.onstart = () => {
      isStartingRef.current = false
      isRecognizingRef.current = true
      setIsListening(true)
      setError(null)
    }

    instance.onresult = handleResult
    instance.onerror = handleError
    instance.onend = handleEnd

    recognitionRef.current = instance

    return () => {
      isExplicitlyStoppedRef.current = true
      try {
        instance.abort()
      } catch {
        // ignore
      }
      recognitionRef.current = null
    }
  }, [
    SpeechRecognitionClass,
    continuous,
    interimResults,
    lang,
    handleResult,
    handleError,
    handleEnd,
  ])

  const startListening = React.useCallback(() => {
    if (!isSupported) {
      const err = "Speech recognition is not supported in this browser."
      setError(err)
      onErrorRef.current?.(err)
      return
    }
    setError(null)
    isExplicitlyStoppedRef.current = false
    safeStart()
  }, [isSupported, safeStart])

  const stopListening = React.useCallback(() => {
    isExplicitlyStoppedRef.current = true
    setIsListening(false)
    isStartingRef.current = false
    const recognition = recognitionRef.current
    if (recognition && isRecognizingRef.current) {
      try {
        recognition.stop()
      } catch {
        // ignore
      }
    }
  }, [])

  const toggleListening = React.useCallback(() => {
    if (isListening) {
      stopListening()
    } else {
      startListening()
    }
  }, [isListening, startListening, stopListening])

  const transcript = React.useMemo(
    () => [finalTranscript, interimTranscript].filter(Boolean).join(" ").trim(),
    [finalTranscript, interimTranscript],
  )

  return {
    isListening,
    isSupported,
    transcript,
    finalTranscript,
    interimTranscript,
    error,
    startListening,
    stopListening,
    toggleListening,
    resetTranscript,
    resetError,
  }
}
