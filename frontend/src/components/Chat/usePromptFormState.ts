import * as React from "react"
import type { AIModelOption } from "@/components/Chat/ModelSelectorPill"
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition"
import { useImageAttachments } from "./useImageAttachments"

const FALLBACK_MODELS: AIModelOption[] = [
  { id: "gemini-3.6-flash-high", name: "Gemini 3.6 Flash", provider: "Google" },
  { id: "claude-sonnet-4-6", name: "Claude 3.7 Sonnet", provider: "Anthropic" },
  { id: "gpt-5.6-luna", name: "GPT-5.6 Luna", provider: "OpenAI" },
  { id: "gpt-5.4", name: "GPT-5.4", provider: "OpenAI" },
  { id: "gpt-oss-120b-medium", name: "DeepSeek R1", provider: "OpenSource" },
]

function normalizeModels(models?: (AIModelOption | string)[]): AIModelOption[] {
  if (!models || models.length === 0) return FALLBACK_MODELS
  return models.map((m) => (typeof m === "string" ? { id: m, name: m } : m))
}

function isPlainEnterPress(
  event: React.KeyboardEvent<HTMLTextAreaElement>,
): boolean {
  if (event.key !== "Enter") return false
  if (event.shiftKey) return false
  if (event.nativeEvent.isComposing) return false
  return true
}

export { useImageAttachments } from "./useImageAttachments"

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

export interface UsePromptFormStateProps {
  initialValue?: string
  selectedModelId?: string
  models?: (AIModelOption | string)[]
  onSelectModel?: (modelId: string) => void
  onValueChange?: (value: string) => void
  onSubmit: (text: string, images?: File[]) => void
  isBusy?: boolean
  autoFocus?: boolean
  inputRef?: React.RefObject<HTMLTextAreaElement | null>
}

export function usePromptFormState({
  initialValue = "",
  selectedModelId,
  models,
  onSelectModel,
  onValueChange,
  onSubmit,
  isBusy = false,
  autoFocus = false,
  inputRef,
}: UsePromptFormStateProps) {
  const [input, setInput] = React.useState(initialValue)
  const [localModelId, setLocalModelId] = React.useState(
    selectedModelId || "gemini-3.6-flash-high",
  )

  const internalInputRef = React.useRef<HTMLTextAreaElement>(null)
  const effectiveInputRef = inputRef || internalInputRef
  const onValueChangeRef = React.useRef(onValueChange)

  const {
    selectedImages,
    fileInputRef,
    handleImageSelect,
    handleRemoveImage,
    clearImages,
  } = useImageAttachments()

  React.useEffect(() => {
    onValueChangeRef.current = onValueChange
  })

  const updateInput = React.useCallback((val: string) => {
    setInput(val)
    onValueChangeRef.current?.(val)
  }, [])

  const {
    isVoiceListening,
    isVoiceSupported,
    voiceError,
    handleToggleVoice,
    stopAndReset,
  } = usePromptVoiceInput({ input, updateInput })

  const activeModelId = selectedModelId || localModelId
  const normalizedModels = React.useMemo(
    () => normalizeModels(models),
    [models],
  )

  React.useEffect(() => {
    if (autoFocus) {
      effectiveInputRef.current?.focus()
    }
  }, [autoFocus, effectiveInputRef])

  function handleSelectModel(mId: string) {
    setLocalModelId(mId)
    onSelectModel?.(mId)
  }

  function handleSubmit(event?: React.FormEvent) {
    event?.preventDefault()
    stopAndReset()
    const text = input.trim()
    if ((!text && selectedImages.length === 0) || isBusy) return

    if (selectedImages.length > 0) {
      onSubmit(
        text,
        selectedImages.map((img) => img.file),
      )
    } else {
      onSubmit(text)
    }
    updateInput("")
    clearImages()
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (isPlainEnterPress(event)) {
      event.preventDefault()
      handleSubmit()
    }
  }

  const hasContent = input.trim().length > 0 || selectedImages.length > 0

  return {
    input,
    updateInput,
    effectiveInputRef,
    fileInputRef,
    selectedImages,
    handleImageSelect,
    handleRemoveImage,
    activeModelId,
    normalizedModels,
    handleSelectModel,
    isVoiceListening,
    isVoiceSupported,
    voiceError,
    handleToggleVoice,
    handleSubmit,
    handleKeyDown,
    hasContent,
  }
}
