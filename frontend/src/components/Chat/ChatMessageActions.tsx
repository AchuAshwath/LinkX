import { Check, Copy } from "lucide-react"
import * as React from "react"
import { cn } from "@/lib/utils"

export interface ChatMessageActionsProps {
  textToCopy: string
  createdAt?: string
  align?: "start" | "end"
  className?: string
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

export function ChatMessageActions({
  textToCopy,
  createdAt,
  align = "start",
  className,
}: ChatMessageActionsProps) {
  const [copied, setCopied] = React.useState(false)
  const timeString = React.useMemo(
    () => formatMessageTime(createdAt),
    [createdAt],
  )

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

  const copyButton = textToCopy ? (
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
  ) : null

  const timeBadge = timeString ? (
    <span className="text-[11px] text-muted-foreground/70 font-normal px-1">
      {timeString}
    </span>
  ) : null

  return (
    <div
      data-slot="message-actions"
      className={cn(
        "flex items-center gap-1.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity duration-150 select-none py-1 text-xs text-muted-foreground",
        align === "end" ? "justify-end" : "justify-start",
        className,
      )}
    >
      {align === "start" ? (
        <>
          {copyButton}
          {timeBadge}
        </>
      ) : (
        <>
          {timeBadge}
          {copyButton}
        </>
      )}
    </div>
  )
}
