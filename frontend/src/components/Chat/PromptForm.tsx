import { AppWindow, ImagePlus, PanelTopClose, Plus, Square } from "lucide-react"
import type * as React from "react"
import { useRef } from "react"

import { AttachmentPreviewStrip } from "@/components/Chat/AttachmentPreviewStrip"
import {
  type AIModelOption,
  ModelSelectorPill,
} from "@/components/Chat/ModelSelectorPill"
import { PromptSubmitButton } from "@/components/Chat/PromptSubmitButton"
import { usePromptFormState } from "@/components/Chat/usePromptFormState"
import { VoiceInputButton } from "@/components/Chat/VoiceInputButton"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group"
import { cn } from "@/lib/utils"
import {
  ObservationComposerSlot,
  type ObservationComposerSlotProps,
} from "@/observation/ObservationComposerSlot"

export type { AIModelOption }

export interface PromptFormProps {
  onSubmit: (
    text: string,
    images?: File[],
  ) => boolean | undefined | Promise<boolean | undefined>
  onStop?: () => void
  onEditLastUserMessage?: () => void
  onRecallLastPrompt?: () => string | null | undefined
  isBusy?: boolean
  placeholder?: string
  selectedModelId?: string
  models?: (AIModelOption | string)[]
  onSelectModel?: (modelId: string) => void
  inputRef?: React.RefObject<HTMLTextAreaElement | null>
  addContextButtonRef?: React.RefObject<HTMLButtonElement | null>
  autoFocus?: boolean
  actions?: React.ReactNode
  observationSlot?: ObservationComposerSlotProps | null
  className?: string
  initialValue?: string
  onValueChange?: (value: string) => void
}

interface PromptFormToolbarProps {
  actions?: React.ReactNode
  observationSlot?: ObservationComposerSlotProps | null
  addContextButtonRef: React.RefObject<HTMLButtonElement | null>
  fileInputRef: React.RefObject<HTMLInputElement | null>
  activeModelId: string
  normalizedModels: AIModelOption[]
  handleSelectModel: (modelId: string) => void
  isVoiceListening: boolean
  isVoiceSupported: boolean
  voiceError: string | null
  handleToggleVoice: () => void
  isBusy: boolean
  hasContent: boolean
  isSendBlocked: boolean
  onStop?: () => void
}

function BrowserTabMenuItem({
  observationSlot,
}: {
  observationSlot: ObservationComposerSlotProps
}) {
  const isConnected = observationSlot.view.isConnected
  return (
    <DropdownMenuItem
      onSelect={isConnected ? observationSlot.onStop : observationSlot.onStart}
      aria-label={isConnected ? "Stop sharing browser tab" : "Browser tab"}
      className="gap-2.5 whitespace-nowrap rounded-lg px-2.5 py-2"
    >
      {isConnected ? (
        <PanelTopClose className="size-4" />
      ) : (
        <AppWindow className="size-4" />
      )}
      {isConnected ? "Stop sharing" : "Browser tab"}
    </DropdownMenuItem>
  )
}

function PromptFormToolbar(props: PromptFormToolbarProps) {
  return (
    <InputGroupAddon align="block-end" className="px-2 pb-1.5 pt-1">
      <div className="flex min-w-0 items-center gap-1.5">
        {props.actions ??
          (props.observationSlot ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Add attachment or browser tab"
                  title="Add context"
                  ref={props.addContextButtonRef}
                  className="flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Plus className="size-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                side="top"
                className="w-52 rounded-xl p-1.5"
              >
                <DropdownMenuItem
                  onSelect={() => props.fileInputRef.current?.click()}
                  className="gap-2.5 rounded-lg px-2.5 py-2"
                >
                  <ImagePlus className="size-4" />
                  Images
                </DropdownMenuItem>
                <BrowserTabMenuItem observationSlot={props.observationSlot} />
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <button
              type="button"
              aria-label="Attach image"
              onClick={() => props.fileInputRef.current?.click()}
              className="flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors cursor-pointer"
            >
              <Plus className="size-4" />
            </button>
          ))}
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        <ModelSelectorPill
          selectedModelId={props.activeModelId}
          models={props.normalizedModels}
          onSelectModel={props.handleSelectModel}
        />

        <VoiceInputButton
          isListening={props.isVoiceListening}
          isSupported={props.isVoiceSupported}
          onToggle={props.handleToggleVoice}
          error={props.voiceError}
          disabled={props.isBusy}
        />

        {Boolean(props.isBusy && props.hasContent && props.onStop) && (
          <InputGroupButton
            type="button"
            size="icon-sm"
            variant="outline"
            aria-label="Stop generating"
            className="size-8 rounded-full bg-muted border-border text-foreground hover:bg-muted/80 cursor-pointer"
            onClick={props.onStop}
          >
            <Square className="size-3.5 fill-current" />
          </InputGroupButton>
        )}

        <PromptSubmitButton
          isBusy={props.isBusy}
          hasContent={props.hasContent}
          isBlocked={props.isSendBlocked}
          onStop={props.onStop}
        />
      </div>
    </InputGroupAddon>
  )
}

interface PromptComposerInputProps {
  inputRef?: React.RefObject<HTMLTextAreaElement | null>
  placeholder: string
  value: string
  onChange: (val: string) => void
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
}

function PromptComposerInput({
  inputRef,
  placeholder,
  value,
  onChange,
  onKeyDown,
}: PromptComposerInputProps) {
  return (
    <InputGroupTextarea
      ref={inputRef}
      placeholder={placeholder}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="min-h-[56px] px-3.5 pt-3 text-sm text-foreground placeholder:text-muted-foreground/80 leading-relaxed"
      onKeyDown={onKeyDown}
    />
  )
}

export function PromptForm({
  onSubmit,
  onStop,
  onEditLastUserMessage,
  onRecallLastPrompt,
  isBusy = false,
  placeholder = "Ask anything",
  selectedModelId,
  models,
  onSelectModel,
  inputRef,
  addContextButtonRef: sharedAddContextButtonRef,
  autoFocus = false,
  actions,
  observationSlot,
  className,
  initialValue = "",
  onValueChange,
}: PromptFormProps) {
  const localAddContextButtonRef = useRef<HTMLButtonElement>(null)
  const addContextButtonRef =
    sharedAddContextButtonRef ?? localAddContextButtonRef
  const formState = usePromptFormState({
    initialValue,
    selectedModelId,
    models,
    onSelectModel,
    onValueChange,
    onSubmit,
    onEditLastUserMessage,
    onRecallLastPrompt,
    autoFocus,
    inputRef,
  })
  const isSendBlocked = Boolean(
    observationSlot?.view.isConnected && !observationSlot.view.hasCurrentFrame,
  )

  return (
    <form
      onSubmit={formState.handleSubmit}
      onPaste={formState.handlePaste}
      onDragOver={formState.handleDragOver}
      onDragLeave={formState.handleDragLeave}
      onDrop={formState.handleDrop}
      className={className}
    >
      <InputGroup
        className={cn(
          "rounded-3xl border border-border/70 bg-[#121214]/95 backdrop-blur-md p-1.5 shadow-lg transition-all focus-within:border-border/70 focus-within:ring-0 focus-within:ring-offset-0 focus-within:outline-none focus:outline-none focus:ring-0 focus-within:!ring-0 focus-within:!border-border/70",
          formState.isDragging &&
            "border-primary/80 ring-2 ring-primary/40 bg-[#18181c]",
        )}
      >
        <input
          type="file"
          ref={formState.fileInputRef}
          accept="image/*"
          multiple
          className="hidden"
          onChange={formState.handleImageSelect}
        />

        <AttachmentPreviewStrip
          images={formState.selectedImages}
          onRemove={formState.handleRemoveImage}
        />

        {observationSlot && (
          <ObservationComposerSlot
            {...observationSlot}
            addContextButtonRef={addContextButtonRef}
          />
        )}
        <PromptComposerInput
          inputRef={formState.effectiveInputRef}
          placeholder={placeholder}
          value={formState.input}
          onChange={formState.updateInput}
          onKeyDown={formState.handleKeyDown}
        />

        <PromptFormToolbar
          actions={actions}
          observationSlot={observationSlot}
          addContextButtonRef={addContextButtonRef}
          fileInputRef={formState.fileInputRef}
          activeModelId={formState.activeModelId}
          normalizedModels={formState.normalizedModels}
          handleSelectModel={formState.handleSelectModel}
          isVoiceListening={formState.isVoiceListening}
          isVoiceSupported={formState.isVoiceSupported}
          voiceError={formState.voiceError}
          handleToggleVoice={formState.handleToggleVoice}
          isBusy={isBusy}
          hasContent={formState.hasContent}
          isSendBlocked={isSendBlocked}
          onStop={onStop}
        />
      </InputGroup>
    </form>
  )
}
