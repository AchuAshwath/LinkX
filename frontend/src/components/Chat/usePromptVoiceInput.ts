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

  const handleTranscriptChange = React.useCallback(
    ({ transcript: voiceText }: { transcript: string }) => {
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
