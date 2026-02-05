import * as React from "react"

import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

interface PromptInputRootProps {
  children: React.ReactNode
  className?: string
}

interface PromptInputProps {
  value: string
  onChange: (value: string) => void
  onSubmit?: () => void
  placeholder?: string
  disabled?: boolean
  className?: string
}

interface PromptInputFooterProps {
  children: React.ReactNode
  className?: string
}

/**
 * PromptKit-inspired prompt input components.
 *
 * These components intentionally mirror the ergonomics of PromptKit's
 * PromptInput primitives while being implemented locally using LinkX
 * design tokens and shadcn/ui. They can later be replaced with the
 * official PromptKit components if desired.
 */
export function PromptInputRoot({
  children,
  className,
}: PromptInputRootProps) {
  return (
    <div
      className={cn(
        "rounded-xl border bg-card shadow-sm px-4 py-3 space-y-3",
        className,
      )}
    >
      {children}
    </div>
  )
}

export function PromptInput({
  value,
  onChange,
  onSubmit,
  placeholder,
  disabled,
  className,
}: PromptInputProps) {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      if (!onSubmit) return
      e.preventDefault()
      onSubmit()
    }
  }

  return (
    <Textarea
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={handleKeyDown}
      placeholder={placeholder}
      disabled={disabled}
      className={cn(
        "min-h-[80px] resize-none border-0 px-0 py-0 text-base leading-relaxed bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0",
        className,
      )}
    />
  )
}

export function PromptInputFooter({
  children,
  className,
}: PromptInputFooterProps) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 pt-1 text-xs text-muted-foreground",
        className,
      )}
    >
      {children}
    </div>
  )
}

export function PromptSubmitButton({
  children,
  disabled,
}: {
  children: React.ReactNode
  disabled?: boolean
}) {
  return (
    <Button
      size="sm"
      disabled={disabled}
      className="rounded-full px-4 h-8 text-xs font-medium"
    >
      {children}
    </Button>
  )
}

