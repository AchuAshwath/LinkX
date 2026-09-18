import * as React from "react"
import type { AIModelOption } from "@/components/Chat/ModelSelectorPill"
import { useImageAttachments } from "./useImageAttachments"
import { usePromptVoiceInput } from "./usePromptVoiceInput"

export { useImageAttachments } from "./useImageAttachments"
export { usePromptVoiceInput } from "./usePromptVoiceInput"

function normalizeModels(models?: (AIModelOption | string)[]): AIModelOption[] {
  if (!models || models.length === 0) return []
  return models.map((m) => (typeof m === "string" ? { id: m, name: m } : m))
}

function isPlainEnterPress(
  event: React.KeyboardEvent<HTMLTextAreaElement>,
): boolean {
  if (event.key !== "Enter") return false
  if (event.shiftKey) return false
  return !event.nativeEvent.isComposing
}

function isPlainArrowUpPress(
  event: React.KeyboardEvent<HTMLTextAreaElement>,
  isComposerEmpty: boolean,
): boolean {
  if (event.key !== "ArrowUp") return false
  if (!isComposerEmpty) return false
  const hasModifiers =
    event.shiftKey || event.altKey || event.ctrlKey || event.metaKey
  if (hasModifiers) return false
  return !event.nativeEvent.isComposing
}

function isInputEmpty(text: string, imageCount: number): boolean {
  if (text.trim().length > 0) return false
  return imageCount === 0
}

function shouldBlockSubmit({
  text,
  imageCount,
}: {
  text: string
  imageCount: number
}): boolean {
  if (text.length > 0) return false
  return imageCount === 0
}

interface PromptSubmitPayload {
  input: string
  selectedImages: { file: File }[]
  onSubmit: (text: string, images?: File[]) => void
  updateInput: (val: string) => void
  clearImages: () => void
  stopAndReset: () => void
}

function executePromptSubmit({
  input,
  selectedImages,
  onSubmit,
  updateInput,
  clearImages,
  stopAndReset,
}: PromptSubmitPayload) {
  stopAndReset()
  const text = input.trim()
  if (shouldBlockSubmit({ text, imageCount: selectedImages.length })) {
    return
  }
  if (selectedImages.length > 0) {
    onSubmit(
      text,
      selectedImages.map((i) => i.file),
    )
  } else {
    onSubmit(text)
  }
  updateInput("")
  clearImages()
}

function usePromptModelSelection({
  selectedModelId,
  onSelectModel,
}: {
  selectedModelId?: string
  onSelectModel?: (modelId: string) => void
}) {
  const [localModelId, setLocalModelId] = React.useState(selectedModelId || "")

  React.useEffect(() => {
    if (selectedModelId) {
      setLocalModelId(selectedModelId)
    }
  }, [selectedModelId])

  const handleSelectModel = React.useCallback(
    (mId: string) => {
      setLocalModelId(mId)
      onSelectModel?.(mId)
    },
    [onSelectModel],
  )

  const activeModelId = selectedModelId || localModelId
  return { activeModelId, handleSelectModel }
}

function usePromptInputSync({
  initialValue,
  autoFocus,
  inputRef,
  onValueChange,
}: {
  initialValue: string
  autoFocus: boolean
  inputRef?: React.RefObject<HTMLTextAreaElement | null>
  onValueChange?: (value: string) => void
}) {
  const [input, setInput] = React.useState(initialValue)
  const internalInputRef = React.useRef<HTMLTextAreaElement>(null)
  const effectiveInputRef = inputRef || internalInputRef
  const onValueChangeRef = React.useRef(onValueChange)

  React.useEffect(() => {
    onValueChangeRef.current = onValueChange
  })

  React.useEffect(() => {
    setInput((prev) => (prev !== initialValue ? initialValue : prev))
  }, [initialValue])

  React.useEffect(() => {
    if (autoFocus) {
      effectiveInputRef.current?.focus()
    }
  }, [autoFocus, effectiveInputRef])

  const updateInput = React.useCallback((val: string) => {
    setInput(val)
    onValueChangeRef.current?.(val)
  }, [])

  return { input, updateInput, effectiveInputRef }
}

interface PromptFormActionsOptions {
  input: string
  selectedImages: { file: File }[]
  onSubmit: (text: string, images?: File[]) => void
  updateInput: (val: string) => void
  clearImages: () => void
  stopAndReset: () => void
  onEditLastUserMessage?: () => void
}

function usePromptFormActions({
  input,
  selectedImages,
  onSubmit,
  updateInput,
  clearImages,
  stopAndReset,
  onEditLastUserMessage,
}: PromptFormActionsOptions) {
  function handleSubmit(event?: React.FormEvent) {
    event?.preventDefault()
    executePromptSubmit({
      input,
      selectedImages,
      onSubmit,
      updateInput,
      clearImages,
      stopAndReset,
    })
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (isPlainEnterPress(event)) {
      event.preventDefault()
      handleSubmit()
      return
    }
    const empty = isInputEmpty(input, selectedImages.length)
    if (isPlainArrowUpPress(event, empty)) {
      event.preventDefault()
      onEditLastUserMessage?.()
    }
  }

  const hasContent = !isInputEmpty(input, selectedImages.length)

  return { handleSubmit, handleKeyDown, hasContent }
}

export interface UsePromptFormStateProps {
  initialValue?: string
  selectedModelId?: string
  models?: (AIModelOption | string)[]
  onSelectModel?: (modelId: string) => void
  onValueChange?: (value: string) => void
  onSubmit: (text: string, images?: File[]) => void
  onEditLastUserMessage?: () => void
  autoFocus?: boolean
  inputRef?: React.RefObject<HTMLTextAreaElement | null>
}

function assemblePromptState({
  modelSelection,
  inputSync,
  attachments,
  voiceInput,
  actions,
  normalizedModels,
}: {
  modelSelection: ReturnType<typeof usePromptModelSelection>
  inputSync: ReturnType<typeof usePromptInputSync>
  attachments: ReturnType<typeof useImageAttachments>
  voiceInput: ReturnType<typeof usePromptVoiceInput>
  actions: ReturnType<typeof usePromptFormActions>
  normalizedModels: AIModelOption[]
}) {
  return {
    input: inputSync.input,
    updateInput: inputSync.updateInput,
    effectiveInputRef: inputSync.effectiveInputRef,
    fileInputRef: attachments.fileInputRef,
    selectedImages: attachments.selectedImages,
    handleImageSelect: attachments.handleImageSelect,
    handleRemoveImage: attachments.handleRemoveImage,
    activeModelId: modelSelection.activeModelId,
    normalizedModels,
    handleSelectModel: modelSelection.handleSelectModel,
    isVoiceListening: voiceInput.isVoiceListening,
    isVoiceSupported: voiceInput.isVoiceSupported,
    voiceError: voiceInput.voiceError,
    handleToggleVoice: voiceInput.handleToggleVoice,
    handleSubmit: actions.handleSubmit,
    handleKeyDown: actions.handleKeyDown,
    hasContent: actions.hasContent,
  }
}

export function usePromptFormState({
  initialValue = "",
  selectedModelId,
  models,
  onSelectModel,
  onValueChange,
  onSubmit,
  onEditLastUserMessage,
  autoFocus = false,
  inputRef,
}: UsePromptFormStateProps) {
  const modelSelection = usePromptModelSelection({
    selectedModelId,
    onSelectModel,
  })
  const inputSync = usePromptInputSync({
    initialValue,
    autoFocus,
    inputRef,
    onValueChange,
  })
  const attachments = useImageAttachments()
  const voiceInput = usePromptVoiceInput({
    input: inputSync.input,
    updateInput: inputSync.updateInput,
  })
  const actions = usePromptFormActions({
    input: inputSync.input,
    selectedImages: attachments.selectedImages,
    onSubmit,
    updateInput: inputSync.updateInput,
    clearImages: attachments.clearImages,
    stopAndReset: voiceInput.stopAndReset,
    onEditLastUserMessage,
  })
  const normalizedModels = React.useMemo(
    () => normalizeModels(models),
    [models],
  )

  return assemblePromptState({
    modelSelection,
    inputSync,
    attachments,
    voiceInput,
    actions,
    normalizedModels,
  })
}
