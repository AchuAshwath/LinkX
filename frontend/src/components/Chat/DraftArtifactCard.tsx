import {
  CalendarIcon,
  CheckIcon,
  CopyIcon,
  PenToolIcon,
  SendIcon,
} from "lucide-react"
import * as React from "react"
import type { DraftArtifact } from "@/components/Chat/types"
import { Button } from "@/components/ui/button"

export interface DraftArtifactCardProps {
  artifact: DraftArtifact
  onSchedule?: (artifact: DraftArtifact) => void
  onSendToComposer?: (artifact: DraftArtifact) => void
  onPublish?: (artifact: DraftArtifact) => void
  className?: string
}

export function DraftArtifactCard({
  artifact,
  onSchedule,
  onSendToComposer,
  onPublish,
  className,
}: DraftArtifactCardProps) {
  const [copied, setCopied] = React.useState(false)
  const [selectedPlatform, setSelectedPlatform] = React.useState<
    "x" | "linkedin" | "linkx" | "all"
  >(artifact.platform || "linkx")

  const charCount = artifact.content ? artifact.content.length : 0
  const maxLimit = selectedPlatform === "x" ? 280 : 3000

  const handleCopy = async () => {
    if (!artifact.content) return
    await navigator.clipboard.writeText(artifact.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div
      className={`w-full max-w-xl mx-auto my-3 rounded-2xl border border-primary/30 bg-card p-4 shadow-sm text-xs flex flex-col gap-3 transition-all ${
        className || ""
      }`}
    >
      {/* Header with Title & Platform Tabs */}
      <div className="flex items-center justify-between border-b border-border/60 pb-2.5">
        <div className="flex items-center gap-1.5 font-semibold text-foreground">
          <PenToolIcon className="h-3.5 w-3.5 text-primary" />
          <span>Drafted Post</span>
        </div>

        <div className="flex items-center rounded-lg bg-muted/40 p-0.5 border border-border/50">
          {(["linkx", "x", "linkedin"] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setSelectedPlatform(p)}
              className={`px-2 py-0.5 rounded-md text-[11px] font-medium transition-colors cursor-pointer uppercase ${
                selectedPlatform === p
                  ? "bg-background text-foreground shadow-2xs font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {p === "linkx" ? "Both" : p}
            </button>
          ))}
        </div>
      </div>

      {/* Post Content Body */}
      <div className="rounded-xl bg-muted/20 border border-border/40 p-3 text-foreground text-xs leading-relaxed whitespace-pre-wrap font-sans">
        {artifact.content}
      </div>

      {/* Footer: Character Count Gauge + Actions */}
      <div className="flex items-center justify-between pt-1 text-muted-foreground">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px]">
            {charCount} / {maxLimit} chars
          </span>
          {charCount > maxLimit && (
            <span className="text-destructive font-semibold">
              Exceeds limit
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleCopy}
            className="h-7 px-2 text-[11px] rounded-lg cursor-pointer"
            aria-label="Copy text"
          >
            {copied ? (
              <CheckIcon className="h-3 w-3 text-emerald-500 mr-1" />
            ) : (
              <CopyIcon className="h-3 w-3 mr-1" />
            )}
            {copied ? "Copied" : "Copy"}
          </Button>

          {onSendToComposer && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onSendToComposer(artifact)}
              className="h-7 px-2 text-[11px] rounded-lg cursor-pointer"
              aria-label="Send to Composer"
            >
              Send to Composer
            </Button>
          )}

          {onSchedule && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onSchedule(artifact)}
              className="h-7 px-2 text-[11px] rounded-lg cursor-pointer"
              aria-label="Schedule"
            >
              <CalendarIcon className="h-3 w-3 mr-1 text-primary" />
              Schedule
            </Button>
          )}

          {onPublish && (
            <Button
              type="button"
              size="sm"
              onClick={() => onPublish(artifact)}
              className="h-7 px-2.5 text-[11px] rounded-lg bg-primary text-primary-foreground font-semibold cursor-pointer hover:bg-primary/90"
              aria-label="Publish"
            >
              <SendIcon className="h-3 w-3 mr-1" />
              Publish
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
