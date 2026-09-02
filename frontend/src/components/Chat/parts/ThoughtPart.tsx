import { ChevronDown, Loader2 } from "lucide-react"
import * as React from "react"

import type { ThoughtPart as ThoughtPartType } from "@/components/Chat/types"
import { cn } from "@/lib/utils"

export interface ThoughtPartProps {
  part: ThoughtPartType
  isStreaming?: boolean
  hasResponseStarted?: boolean
  className?: string
}

export function ThoughtPart({
  part,
  isStreaming = false,
  hasResponseStarted = false,
  className,
}: ThoughtPartProps) {
  const [manualExpanded, setManualExpanded] = React.useState<boolean | null>(
    null,
  )

  // Auto-expand while thinking is actively streaming before response starts; auto-collapse once response starts
  const isExpanded =
    manualExpanded !== null
      ? manualExpanded
      : isStreaming && !hasResponseStarted

  const hasContent = Boolean(part.content?.trim())

  if (!hasContent && (!isStreaming || hasResponseStarted)) {
    return null
  }

  return (
    <div className={cn("my-1 flex flex-col items-start w-full", className)}>
      <button
        type="button"
        onClick={() => setManualExpanded(!isExpanded)}
        aria-label="Toggle thinking details"
        className="flex items-center gap-1.5 py-0.5 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer font-medium select-none"
      >
        {isStreaming && (
          <Loader2 className="size-3.5 animate-spin text-muted-foreground shrink-0" />
        )}
        <span>Thinking…</span>
        <ChevronDown
          className={cn(
            "size-3.5 text-muted-foreground transition-transform duration-200 shrink-0",
            !isExpanded && "-rotate-90",
          )}
        />
      </button>

      {isExpanded && (
        <div className="mt-1 ml-1.5 flex flex-col gap-1.5 border-l border-border/50 pl-3 py-1 text-xs w-full animate-in fade-in-0 duration-150">
          {part.content ? (
            <div className="text-xs text-muted-foreground/80 font-normal leading-relaxed whitespace-pre-wrap">
              {part.content}
            </div>
          ) : (
            <span className="italic text-muted-foreground/60 text-xs">
              Analyzing prompt and formulating steps…
            </span>
          )}
        </div>
      )}
    </div>
  )
}
