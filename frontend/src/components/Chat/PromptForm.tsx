import { Plus } from "lucide-react"
import * as React from "react"

import {
  type AttachmentImage,
  AttachmentPreviewStrip,
} from "@/components/Chat/AttachmentPreviewStrip"
import {
  type AIModelOption,
  ModelSelectorPill,
} from "@/components/Chat/ModelSelectorPill"
import { PromptSubmitButton } from "@/components/Chat/PromptSubmitButton"
import { VoiceInputButton } from "@/components/Chat/VoiceInputButton"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupTextarea,
} from "@/components/ui/input-group"
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition"

export type { AIModelOption }

export interface PromptFormProps {
  onSubmit: (text: string, images?: File[]) => void
  onStop?: () => void
  isBusy?: boolean
  placeholder?: string
  selectedModelId?: string
  models?: (AIModelOption | string)[]
  onSelectModel?: (modelId: string) => void
  inputRef?: React.RefObject<HTMLTextAreaElement | null>
  autoFocus?: boolean
  actions?: React.ReactNode
  className?: string
  initialValue?: string
  onValueChange?: (value: string) => void
}

const FALLBACK_MODELS: AIModelOption[] = [
  { id: "gemini-3.6-flash-high", name: "Gemini 3.6 Flash", provider: "Google" },
  { id: "claude-sonnet-4-6", name: "Claude 3.7 Sonnet", provider: "Anthropic" },
  { id: "gpt-5.6-luna", name: "GPT-5.6 Luna", provider: "OpenAI" },
  { id: "gpt-5.4", name: "GPT-5.4", provider: "OpenAI" },
  { id: "gpt-oss-120b-medium", name: "DeepSeek R1", provider: "OpenSource" },
]

export function PromptForm({
  onSubmit,
  onStop,
  isBusy = false,
  placeholder = "Ask anything",
  selectedModelId,
  models,
  onSelectModel,
  inputRef,
  autoFocus = false,
  actions,
  className,
  initialValue = "",
  onValueChange,
}: PromptFormProps) {
  const [input, setInput] = React.useState(initialValue)
  const [localModelId, setLocalModelId] = React.useState(
    selectedModelId || "gemini-3.6-flash-high",
  )
  const [selectedImages, setSelectedImages] = React.useState<AttachmentImage[]>(
    [],
  )

  const internalInputRef = React.useRef<HTMLTextAreaElement>(null)
  const effectiveInputRef = inputRef || internalInputRef
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const baseInputRef = React.useRef(initialValue)
  const onValueChangeRef = React.useRef(onValueChange)

  React.useEffect(() => {
    onValueChangeRef.current = onValueChange
  })

  const updateInput = React.useCallback((val: string) => {
    setInput(val)
    baseInputRef.current = val
    onValueChangeRef.current?.(val)
  }, [])

  const activeModelId = selectedModelId || localModelId

  const normalizedModels: AIModelOption[] = React.useMemo(() => {
    if (!models || models.length === 0) return FALLBACK_MODELS
    return models.map((m) => (typeof m === "string" ? { id: m, name: m } : m))
  }, [models])

  const handleTranscriptChange = React.useCallback(
    ({ transcript: voiceText }: { transcript: string }) => {
      if (!voiceText) return
      const base = baseInputRef.current.trim()
      const separator = base && voiceText ? " " : ""
      const fullText = base + separator + voiceText
      setInput(fullText)
      onValueChangeRef.current?.(fullText)
    },
    [],
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
    if (isVoiceListening) {
      stopVoiceListening()
      baseInputRef.current = input
      resetTranscript()
    } else {
      baseInputRef.current = input
      resetTranscript()
      startListening()
    }
  }, [
    isVoiceListening,
    stopVoiceListening,
    startListening,
    resetTranscript,
    input,
  ])

  React.useEffect(() => {
    if (autoFocus) {
      effectiveInputRef.current?.focus()
    }
  }, [autoFocus, effectiveInputRef])

  function handleSelectModel(mId: string) {
    setLocalModelId(mId)
    onSelectModel?.(mId)
  }

  function handleImageSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (!files || files.length === 0) return

    const newImages = Array.from(files).map((file) => ({
      file,
      preview: URL.createObjectURL(file),
    }))

    setSelectedImages((prev) => [...prev, ...newImages])
    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }
  }

  function handleRemoveImage(index: number) {
    setSelectedImages((prev) => {
      const target = prev[index]
      if (target) {
        URL.revokeObjectURL(target.preview)
      }
      return prev.filter((_, i) => i !== index)
    })
  }

  function handleSubmit(event?: React.FormEvent) {
    event?.preventDefault()
    if (isVoiceListening) {
      stopVoiceListening()
    }
    resetTranscript()
    baseInputRef.current = ""
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
    setSelectedImages([])
  }

  const hasContent = input.trim().length > 0 || selectedImages.length > 0

  return (
    <form onSubmit={handleSubmit} className={className}>
      <InputGroup className="rounded-3xl border border-border/70 bg-[#121214]/95 backdrop-blur-md p-1.5 shadow-lg transition-all focus-within:border-border/70 focus-within:ring-0 focus-within:ring-offset-0 focus-within:outline-none focus:outline-none focus:ring-0 focus-within:!ring-0 focus-within:!border-border/70">
        <input
          type="file"
          ref={fileInputRef}
          accept="image/*"
          multiple
          className="hidden"
          onChange={handleImageSelect}
        />

        <AttachmentPreviewStrip
          images={selectedImages}
          onRemove={handleRemoveImage}
        />

        <InputGroupTextarea
          ref={effectiveInputRef}
          placeholder={placeholder}
          value={input}
          onChange={(event) => updateInput(event.target.value)}
          className="min-h-[56px] px-3.5 pt-3 text-sm text-foreground placeholder:text-muted-foreground/80 leading-relaxed"
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault()
              handleSubmit()
            }
          }}
        />

        <InputGroupAddon align="block-end" className="px-2 pb-1.5 pt-1">
          <div className="flex items-center gap-1.5">
            {actions ?? (
              <button
                type="button"
                aria-label="Attach image"
                onClick={() => fileInputRef.current?.click()}
                className="flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors cursor-pointer"
              >
                <Plus className="size-4" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5 ml-auto">
            <ModelSelectorPill
              selectedModelId={activeModelId}
              models={normalizedModels}
              onSelectModel={handleSelectModel}
            />

            <VoiceInputButton
              isListening={isVoiceListening}
              isSupported={isVoiceSupported}
              onToggle={handleToggleVoice}
              error={voiceError}
              disabled={isBusy}
            />

            <PromptSubmitButton
              isBusy={isBusy}
              hasContent={hasContent}
              onStop={onStop}
            />
          </div>
        </InputGroupAddon>
      </InputGroup>
    </form>
  )
}
