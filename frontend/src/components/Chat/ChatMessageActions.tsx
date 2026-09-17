import { Check, Copy, Pencil, RotateCw } from "lucide-react"
import * as React from "react"
import { cn } from "@/lib/utils"

export interface ChatMessageActionsProps {
  textToCopy: string
  createdAt?: string
  align?: "start" | "end"
  className?: string
  onEdit?: () => void
  onRegenerate?: () => void
  isLatestAssistant?: boolean
  isStreaming?: boolean
}

function formatMessageTime(createdAt?: string): string {
  if (!createdAt) return ""
  try {
    const date = new Date(createdAt)
    if (Number.isNaN(date.getTime())) return ""
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
    }).format(date)
  } catch {
    return ""
  }
}

function CopyButton({ textToCopy }: { textToCopy: string }) {
  const [copied, setCopied] = React.useState(false)

  const handleCopy = React.useCallback(async () => {
    if (!textToCopy) return
    try {
      await navigator.clipboard.writeText(textToCopy)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // ignore clipboard error
    }
  }, [textToCopy])

  if (!textToCopy) return null

  return (
    <button
      type="button"
      aria-label={copied ? "Copied to clipboard" : "Copy message"}
      onClick={handleCopy}
      className="flex size-6 items-center justify-center rounded-md text-muted-foreground/70 hover:bg-muted/60 hover:text-foreground transition-colors cursor-pointer"
    >
      {copied ? (
        <Check className="size-3 text-emerald-500" />
      ) : (
        <Copy className="size-3" />
      )}
    </button>
  )
}

function EditButton({ onEdit }: { onEdit?: () => void }) {
  if (!onEdit) return null
  return (
    <button
      type="button"
      aria-label="Edit message"
      onClick={onEdit}
      className="flex size-6 items-center justify-center rounded-md text-muted-foreground/70 hover:bg-muted/60 hover:text-foreground transition-colors cursor-pointer"
    >
      <Pencil className="size-3" />
    </button>
  )
}

function RegenerateButton({
  onRegenerate,
  isLatestAssistant,
  isStreaming,
}: {
  onRegenerate?: () => void
  isLatestAssistant: boolean
  isStreaming: boolean
}) {
  const canRegenerate = Boolean(
    onRegenerate && isLatestAssistant && !isStreaming,
  )
  if (!canRegenerate) return null

  return (
    <button
      type="button"
      aria-label="Regenerate response"
      onClick={onRegenerate}
      className="flex size-6 items-center justify-center rounded-md text-muted-foreground/70 hover:bg-muted/60 hover:text-foreground transition-colors cursor-pointer"
    >
      <RotateCw className="size-3" />
    </button>
  )
}

function TimeBadge({ createdAt }: { createdAt?: string }) {
  const timeString = React.useMemo(
    () => formatMessageTime(createdAt),
    [createdAt],
  )
  if (!timeString) return null
  return (
    <span className="text-[11px] text-muted-foreground/70 font-normal px-1">
      {timeString}
    </span>
  )
}

export function ChatMessageActions({
  textToCopy,
  createdAt,
  align = "start",
  className,
  onEdit,
  onRegenerate,
  isLatestAssistant = false,
  isStreaming = false,
}: ChatMessageActionsProps) {
  const isEndAligned = align === "end"

  return (
    <div
      data-slot="message-actions"
      className={cn(
        "flex items-center gap-1.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity duration-150 select-none py-1 text-xs text-muted-foreground",
        isEndAligned ? "justify-end" : "justify-start",
        className,
      )}
    >
      {isEndAligned ? (
        <>
          <TimeBadge createdAt={createdAt} />
          <EditButton onEdit={onEdit} />
          <CopyButton textToCopy={textToCopy} />
        </>
      ) : (
        <>
          <CopyButton textToCopy={textToCopy} />
          <RegenerateButton
            onRegenerate={onRegenerate}
            isLatestAssistant={isLatestAssistant}
            isStreaming={isStreaming}
          />
          <TimeBadge createdAt={createdAt} />
        </>
      )}
    </div>
  )
}
