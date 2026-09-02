import { Plus } from "lucide-react"
import type * as React from "react"

import { AttachmentPreviewStrip } from "@/components/Chat/AttachmentPreviewStrip"
import {
  type AIModelOption,
  ModelSelectorPill,
} from "@/components/Chat/ModelSelectorPill"
import { PromptSubmitButton } from "@/components/Chat/PromptSubmitButton"
import { usePromptFormState } from "@/components/Chat/usePromptFormState"
import { VoiceInputButton } from "@/components/Chat/VoiceInputButton"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupTextarea,
} from "@/components/ui/input-group"

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
  const {
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
  } = usePromptFormState({
    initialValue,
    selectedModelId,
    models,
    onSelectModel,
    onValueChange,
    onSubmit,
    isBusy,
    autoFocus,
    inputRef,
  })

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
          onKeyDown={handleKeyDown}
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
