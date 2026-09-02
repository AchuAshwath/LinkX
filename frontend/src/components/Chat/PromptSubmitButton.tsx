import { ArrowUp, Square } from "lucide-react"

import { InputGroupButton } from "@/components/ui/input-group"
import { cn } from "@/lib/utils"

export function PromptSubmitButton({
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
