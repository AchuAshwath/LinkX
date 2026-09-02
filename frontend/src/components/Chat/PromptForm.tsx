import { ArrowUp, Check, ChevronDown, Mic, Plus, Square, X } from "lucide-react"
import * as React from "react"

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group"
import { cn } from "@/lib/utils"

export interface AIModelOption {
  id: string
  name: string
  provider?: string | null
  is_default?: boolean
}

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
}

function AttachmentPreviewStrip({
  images,
  onRemove,
}: {
  images: { file: File; preview: string }[]
  onRemove: (index: number) => void
}) {
  if (images.length === 0) return null

  return (
    <div className="flex items-center gap-2 px-3 pt-2.5 overflow-x-auto scrollbar-none">
      {images.map((img, idx) => (
        <div
          key={idx}
          className="group relative size-14 shrink-0 rounded-xl overflow-hidden border border-border bg-muted/40"
        >
          <img
            src={img.preview}
            alt="Attachment preview"
            className="size-full object-cover"
          />
          <button
            type="button"
            onClick={() => onRemove(idx)}
            aria-label="Remove image"
            className="absolute right-1 top-1 flex size-4 items-center justify-center rounded-full bg-background/80 text-foreground hover:bg-destructive hover:text-destructive-foreground transition-colors cursor-pointer"
          >
            <X className="size-2.5" />
          </button>
        </div>
      ))}
    </div>
  )
}

function ModelSelectorPill({
  selectedModelId,
  models,
  onSelectModel,
}: {
  selectedModelId: string
  models: AIModelOption[]
  onSelectModel: (m: string) => void
}) {
  const [open, setOpen] = React.useState(false)

  const activeModel = models.find((m) => m.id === selectedModelId)
  const displayLabel = activeModel ? activeModel.name : selectedModelId

  React.useEffect(() => {
    const handleOutside = () => setOpen(false)
    if (open) {
      document.addEventListener("click", handleOutside)
    }
    return () => document.removeEventListener("click", handleOutside)
  }, [open])

  return (
    <div className="relative">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setOpen((prev) => !prev)
        }}
        className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors cursor-pointer select-none"
      >
        <span className="truncate max-w-[140px]">{displayLabel}</span>
        <ChevronDown className="size-3 text-muted-foreground shrink-0" />
      </button>

      {open && (
        <div
          role="menu"
          tabIndex={-1}
          className="absolute bottom-9 right-0 z-50 min-w-44 max-h-60 overflow-y-auto rounded-2xl border border-border bg-popover p-1 shadow-lg animate-in fade-in-0 zoom-in-95"
        >
          <div className="px-2.5 py-1 text-[10px] font-semibold uppercase text-muted-foreground tracking-wider select-none">
            Available Models
          </div>
          {models.map((m) => (
            <button
              type="button"
              key={m.id}
              role="menuitem"
              onClick={(e) => {
                e.stopPropagation()
                onSelectModel(m.id)
                setOpen(false)
              }}
              className="flex w-full items-center justify-between gap-2 rounded-xl px-2.5 py-1.5 text-xs text-popover-foreground hover:bg-accent hover:text-accent-foreground cursor-pointer font-medium text-left"
            >
              <div className="flex flex-col min-w-0">
                <span className="truncate">{m.name}</span>
                {m.provider && (
                  <span className="text-[10px] text-muted-foreground">
                    {m.provider}
                  </span>
                )}
              </div>
              {selectedModelId === m.id && (
                <Check className="size-3.5 text-primary shrink-0 stroke-[2.5]" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function PromptSubmitButton({
  isBusy,
  hasContent,
  onStop,
}: {
  isBusy: boolean
  hasContent: boolean
  onStop?: () => void
}) {
  if (isBusy) {
    return (
      <InputGroupButton
        type="button"
        size="icon-sm"
        variant="outline"
        aria-label="Stop generating"
        className="size-8 rounded-full bg-muted border-border text-foreground hover:bg-muted/80 cursor-pointer"
        onClick={onStop}
      >
        <Square className="size-3.5 fill-current" />
      </InputGroupButton>
    )
  }

  return (
    <InputGroupButton
      type="submit"
      size="icon-sm"
      variant="default"
      aria-label="Send message"
      className={cn(
        "size-8 rounded-full transition-all cursor-pointer",
        hasContent
          ? "bg-primary text-primary-foreground hover:bg-primary/90 shadow-2xs"
          : "bg-muted/40 text-muted-foreground/50 opacity-40 cursor-not-allowed",
      )}
      disabled={!hasContent}
    >
      <ArrowUp className="size-4 stroke-[2.5]" />
    </InputGroupButton>
  )
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
}: PromptFormProps) {
  const [input, setInput] = React.useState("")
  const [localModelId, setLocalModelId] = React.useState(
    selectedModelId || "gemini-3.6-flash-high",
  )
  const [selectedImages, setSelectedImages] = React.useState<
    { file: File; preview: string }[]
  >([])

  const internalInputRef = React.useRef<HTMLTextAreaElement>(null)
  const effectiveInputRef = inputRef || internalInputRef
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  const activeModelId = selectedModelId || localModelId

  const normalizedModels: AIModelOption[] = React.useMemo(() => {
    if (!models || models.length === 0) return FALLBACK_MODELS
    return models.map((m) => (typeof m === "string" ? { id: m, name: m } : m))
  }, [models])

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
    setInput("")
    setSelectedImages([])
  }

  const hasContent = input.trim().length > 0 || selectedImages.length > 0

  return (
    <form onSubmit={handleSubmit} className={className}>
      <InputGroup className="rounded-3xl border border-border/80 bg-[#121214]/95 backdrop-blur-md p-1.5 shadow-lg transition-all focus-within:border-border">
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
          onChange={(event) => setInput(event.target.value)}
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

            <button
              type="button"
              aria-label="Voice input"
              className="flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors cursor-pointer"
            >
              <Mic className="size-3.5" />
            </button>

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
