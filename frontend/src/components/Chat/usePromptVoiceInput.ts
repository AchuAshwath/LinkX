import * as React from "react"
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition"

export function usePromptVoiceInput({
  input,
  updateInput,
}: {
  input: string
  updateInput: (val: string) => void
}) {
  const baseInputRef = React.useRef(input)
  const ignoreTranscriptRef = React.useRef(false)

  const handleTranscriptChange = React.useCallback(
    ({ transcript: voiceText }: { transcript: string }) => {
      if (ignoreTranscriptRef.current) return
      if (!voiceText) return
      const base = baseInputRef.current.trim()
      const separator = base && voiceText ? " " : ""
      const fullText = base + separator + voiceText
      updateInput(fullText)
    },
    [updateInput],
  )

  const {
    isListening: isVoiceListening,
    isSupported: isVoiceSupported,
    startListening,
    stopListening: stopVoiceListening,
    resetTranscript,
    error: voiceError,
  } = useSpeechRecognition({
    onTranscriptChange: handleTranscriptChange,
  })

  const handleToggleVoice = React.useCallback(() => {
    baseInputRef.current = input
    resetTranscript()
    if (isVoiceListening) {
      stopVoiceListening()
    } else {
      ignoreTranscriptRef.current = false
      startListening()
    }
  }, [
    isVoiceListening,
    stopVoiceListening,
    startListening,
    resetTranscript,
    input,
  ])

  function stopAndReset() {
    ignoreTranscriptRef.current = true
    if (isVoiceListening) {
      stopVoiceListening()
    }
    resetTranscript()
    baseInputRef.current = ""
  }

  return {
    isVoiceListening,
    isVoiceSupported,
    voiceError,
    handleToggleVoice,
    stopAndReset,
  }
}
