import * as React from "react"
import type { AIModelOption } from "@/components/Chat/ModelSelectorPill"
import { useImageAttachments } from "./useImageAttachments"
import { usePromptDropPaste } from "./usePromptDropPaste"
import { usePromptVoiceInput } from "./usePromptVoiceInput"

export { useImageAttachments } from "./useImageAttachments"
export { usePromptDropPaste } from "./usePromptDropPaste"
export { usePromptVoiceInput } from "./usePromptVoiceInput"

function normalizeModels(models?: (AIModelOption | string)[]): AIModelOption[] {
  if (!models || models.length === 0) return []
  return models.map((m) => (typeof m === "string" ? { id: m, name: m } : m))
}

function hasModifierKey(event: React.KeyboardEvent): boolean {
  if (event.shiftKey || event.altKey) return true
  return Boolean(event.ctrlKey || event.metaKey)
}

function hasCommandModifier(event: React.KeyboardEvent): boolean {
  return Boolean(event.ctrlKey || event.metaKey)
}

function isPlainEnterPress(
  event: React.KeyboardEvent<HTMLTextAreaElement>,
): boolean {
  if (event.key !== "Enter") return false
  if (hasModifierKey(event)) return false
  return !event.nativeEvent.isComposing
}

function isCommandEnterPress(
  event: React.KeyboardEvent<HTMLTextAreaElement>,
): boolean {
  if (event.key !== "Enter") return false
  if (!hasCommandModifier(event)) return false
  return !event.nativeEvent.isComposing
}

function isPlainArrowUpPress(
  event: React.KeyboardEvent<HTMLTextAreaElement>,
  isComposerEmpty: boolean,
): boolean {
  if (event.key !== "ArrowUp") return false
  if (!isComposerEmpty) return false
  if (hasModifierKey(event)) return false
  return !event.nativeEvent.isComposing
}

function isInputEmpty(text: string, imageCount: number): boolean {
  if (text.trim().length > 0) return false
  return imageCount === 0
}

interface PromptSubmitPayload {
  getCurrentInput: () => string
  input: string
  selectedImages: { file: File }[]
  onSubmit: (
    text: string,
    images?: File[],
  ) => boolean | undefined | Promise<boolean | undefined>
  updateInput: (val: string) => void
  clearImages: () => void
  stopAndReset: () => void
}

function executePromptSubmit({
  getCurrentInput,
  input,
  selectedImages,
  onSubmit,
  updateInput,
  clearImages,
  stopAndReset,
}: PromptSubmitPayload) {
  stopAndReset()
  if (isInputEmpty(input, selectedImages.length)) {
    return
  }
  const text = input.trim()
  let submission: boolean | undefined | Promise<boolean | undefined>
  if (selectedImages.length > 0) {
    submission = onSubmit(
      text,
      selectedImages.map((i) => i.file),
    )
  } else {
    submission = onSubmit(text)
  }
  const clearAcceptedSubmission = (accepted: boolean | undefined) => {
    if (accepted === false) return
    if (getCurrentInput() !== input) return
    updateInput("")
    clearImages()
  }
  if (submission && typeof submission === "object") {
    void Promise.resolve(submission).then(
      clearAcceptedSubmission,
      () => undefined,
    )
    return
  }
  clearAcceptedSubmission(submission)
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
  onSubmit: (
    text: string,
    images?: File[],
  ) => boolean | undefined | Promise<boolean | undefined>
  updateInput: (val: string) => void
  clearImages: () => void
  stopAndReset: () => void
  onEditLastUserMessage?: () => void
  onRecallLastPrompt?: () => string | null | undefined
}

function usePromptFormActions({
  input,
  selectedImages,
  onSubmit,
  updateInput,
  clearImages,
  stopAndReset,
  onEditLastUserMessage,
  onRecallLastPrompt,
}: PromptFormActionsOptions) {
  const latestInput = React.useRef(input)
  latestInput.current = input
  const handleSubmit = React.useCallback(
    (event?: React.FormEvent) => {
      event?.preventDefault()
      executePromptSubmit({
        getCurrentInput: () => latestInput.current,
        input,
        selectedImages,
        onSubmit,
        updateInput,
        clearImages,
        stopAndReset,
      })
    },
    [input, selectedImages, onSubmit, updateInput, clearImages, stopAndReset],
  )

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (isPlainEnterPress(event) || isCommandEnterPress(event)) {
        event.preventDefault()
        handleSubmit()
        return
      }
      const empty = isInputEmpty(input, selectedImages.length)
      if (isPlainArrowUpPress(event, empty)) {
        event.preventDefault()
        if (onRecallLastPrompt) {
          const recalled = onRecallLastPrompt()
          if (recalled) {
            updateInput(recalled)
          }
          return
        }
        onEditLastUserMessage?.()
      }
    },
    [
      input,
      selectedImages.length,
      handleSubmit,
      onRecallLastPrompt,
      updateInput,
      onEditLastUserMessage,
    ],
  )

  const hasContent = !isInputEmpty(input, selectedImages.length)

  return { handleSubmit, handleKeyDown, hasContent }
}

export interface UsePromptFormStateProps {
  initialValue?: string
  selectedModelId?: string
  models?: (AIModelOption | string)[]
  onSelectModel?: (modelId: string) => void
  onValueChange?: (value: string) => void
  onSubmit: (
    text: string,
    images?: File[],
  ) => boolean | undefined | Promise<boolean | undefined>
  onEditLastUserMessage?: () => void
  onRecallLastPrompt?: () => string | null | undefined
  autoFocus?: boolean
  inputRef?: React.RefObject<HTMLTextAreaElement | null>
}

function assemblePromptState({
  modelSelection,
  inputSync,
  attachments,
  voiceInput,
  actions,
  dropPaste,
  normalizedModels,
}: {
  modelSelection: ReturnType<typeof usePromptModelSelection>
  inputSync: ReturnType<typeof usePromptInputSync>
  attachments: ReturnType<typeof useImageAttachments>
  voiceInput: ReturnType<typeof usePromptVoiceInput>
  actions: ReturnType<typeof usePromptFormActions>
  dropPaste: ReturnType<typeof usePromptDropPaste>
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
    isDragging: dropPaste.isDragging,
    handlePaste: dropPaste.handlePaste,
    handleDragOver: dropPaste.handleDragOver,
    handleDragLeave: dropPaste.handleDragLeave,
    handleDrop: dropPaste.handleDrop,
    addFiles: attachments.addFiles,
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
  onRecallLastPrompt,
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
  const dropPaste = usePromptDropPaste({
    addFiles: attachments.addFiles,
  })
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
    onRecallLastPrompt,
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
    dropPaste,
    normalizedModels,
  })
}
