import { ArrowUp, ChevronDown, Mic, Plus, Square, X } from "lucide-react"
import * as React from "react"

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group"
import { cn } from "@/lib/utils"

export interface PromptFormProps {
  onSubmit: (text: string, images?: File[]) => void
  onStop?: () => void
  isBusy?: boolean
  placeholder?: string
  modelName?: string
  actions?: React.ReactNode
  className?: string
}

export function PromptForm({
  onSubmit,
  onStop,
  isBusy = false,
  placeholder = "Ask anything",
  modelName = "5.6 Luna High",
  actions,
  className,
}: PromptFormProps) {
  const [input, setInput] = React.useState("")
  const [selectedModel, setSelectedModel] = React.useState(modelName)
  const [modelMenuOpen, setModelMenuOpen] = React.useState(false)
  const [selectedImages, setSelectedImages] = React.useState<
    { file: File; preview: string }[]
  >([])

  const fileInputRef = React.useRef<HTMLInputElement>(null)

  const models = ["5.6 Luna High", "Claude 3.7 Sonnet", "GPT-4o", "DeepSeek R1"]

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
        {/* Hidden File Input for Image Support */}
        <input
          type="file"
          ref={fileInputRef}
          accept="image/*"
          multiple
          className="hidden"
          onChange={handleImageSelect}
        />

        {/* Selected Images Preview Strip */}
        {selectedImages.length > 0 && (
          <div className="flex items-center gap-2 px-3 pt-2.5 overflow-x-auto scrollbar-none">
            {selectedImages.map((img, idx) => (
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
                  onClick={() => handleRemoveImage(idx)}
                  aria-label="Remove image"
                  className="absolute right-1 top-1 flex size-4 items-center justify-center rounded-full bg-background/80 text-foreground hover:bg-destructive hover:text-destructive-foreground transition-colors cursor-pointer"
                >
                  <X className="size-2.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        <InputGroupTextarea
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
          {/* Left Actions: + (Image Attach) or custom actions */}
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

          {/* Right Actions: Model Select, Mic, Send Button */}
          <div className="flex items-center gap-1.5 ml-auto">
            {/* Model Selector Pill */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setModelMenuOpen((prev) => !prev)}
                className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors cursor-pointer select-none"
              >
                <span>{selectedModel}</span>
                <ChevronDown className="size-3 text-muted-foreground" />
              </button>

              {modelMenuOpen && (
                <div
                  role="menu"
                  tabIndex={-1}
                  className="absolute bottom-9 right-0 z-50 min-w-36 rounded-2xl border border-border bg-popover p-1 shadow-lg animate-in fade-in-0 zoom-in-95"
                >
                  {models.map((m) => (
                    <button
                      type="button"
                      key={m}
                      role="menuitem"
                      onClick={() => {
                        setSelectedModel(m)
                        setModelMenuOpen(false)
                      }}
                      className="flex w-full items-center justify-between rounded-xl px-2.5 py-1.5 text-xs text-popover-foreground hover:bg-accent hover:text-accent-foreground cursor-pointer font-medium"
                    >
                      <span>{m}</span>
                      {selectedModel === m && (
                        <span className="size-1.5 rounded-full bg-primary" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Mic Voice Input Icon (Ready for Speech Recognition API) */}
            <button
              type="button"
              aria-label="Voice input"
              className="flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors cursor-pointer"
            >
              <Mic className="size-3.5" />
            </button>

            {/* Submit / Stop Circular Button (Blue when active) */}
            {isBusy ? (
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
            ) : (
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
            )}
          </div>
        </InputGroupAddon>
      </InputGroup>
    </form>
  )
}
