import { ChevronDown, Image, Loader2 } from "lucide-react"
import * as React from "react"

import type { BrowserActivity } from "@/components/Chat/types"
import { cn } from "@/lib/utils"

type BrowserTool = NonNullable<BrowserActivity["tools"]>[number]
type ReadStatus = "running" | "failed" | "complete" | "stopped"
const READING_PHRASES = [
  "Transcribing…",
  "Deciphering…",
  "Understanding…",
  "Connecting details…",
]
const GENERIC_READ_WARNING = "A shared view could not be read."

export interface BrowserActivityPartProps {
  activity: BrowserActivity
  isStreaming: boolean
}

function metadataNumber(
  data: Record<string, unknown> | undefined,
  key: string,
): number | undefined {
  const value = data?.[key]
  return typeof value === "number" ? value : undefined
}

function viewPosition(index: number, tool: BrowserTool) {
  const viewIndex = metadataNumber(tool.input, "view_index") ?? index + 1
  const viewCount = metadataNumber(tool.input, "view_count")
  return {
    compact: viewCount ? `${viewIndex}/${viewCount}` : `${viewIndex}`,
    spoken: viewCount ? `${viewIndex} of ${viewCount}` : `${viewIndex}`,
  }
}

function getReadStatus(tool: BrowserTool, isStreaming: boolean): ReadStatus {
  if (tool.state === "running" && !isStreaming) return "stopped"
  if (tool.state === "running") return "running"
  if (tool.state === "failed") return "failed"
  return "complete"
}

function activityWarning(activity: BrowserActivity) {
  const warning = activity.warning
  const representedByFailedRead =
    warning === GENERIC_READ_WARNING &&
    activity.tools?.some(
      (tool) => tool.name === "read_shared_view" && tool.state === "failed",
    )
  return representedByFailedRead ? null : warning
}

function statusLabel(status: ReadStatus) {
  const labels: Record<ReadStatus, string> = {
    running: "Reading",
    failed: "Could not read",
    complete: "Read",
    stopped: "Stopped reading",
  }
  return labels[status]
}

function readDescription(status: ReadStatus) {
  const descriptions: Record<ReadStatus, string> = {
    running: "Reading visible text and layout…",
    failed: "This image could not be read.",
    complete: "No extracted description is available.",
    stopped: "Reading stopped before the image finished.",
  }
  return descriptions[status]
}

function notePreview(tool: BrowserTool) {
  const preview = tool.output?.note_preview
  return typeof preview === "string" && preview.trim() ? preview : undefined
}

function failureMessage(tool: BrowserTool) {
  const message = tool.output?.failure_message
  return typeof message === "string" && message.length <= 200
    ? message
    : undefined
}

function shortPreview(preview: string) {
  const points = Array.from(preview)
  return points.length > 160 ? `${points.slice(0, 159).join("")}…` : preview
}

function ReadStatusIcon({ status }: { status: ReadStatus }) {
  const tone =
    status === "failed" || status === "stopped"
      ? "text-destructive"
      : "text-muted-foreground"
  return (
    <Image
      aria-hidden="true"
      className={cn(
        "size-3.5 shrink-0",
        tone,
        status === "running" && "animate-pulse motion-reduce:animate-none",
      )}
    />
  )
}

function ReadResultDetails({
  status,
  preview,
  truncated,
  failure,
}: {
  status: ReadStatus
  preview: string | undefined
  truncated: boolean
  failure: string | undefined
}) {
  return (
    <div className="ml-7 max-w-prose px-2 pb-1 text-muted-foreground">
      <p className="whitespace-pre-wrap break-words">
        {preview ?? failure ?? readDescription(status)}
      </p>
      {preview && truncated && <p className="mt-1">Preview shortened</p>}
    </div>
  )
}

function BrowserToolRow({
  tool,
  index,
  isStreaming,
}: {
  tool: BrowserTool
  index: number
  isStreaming: boolean
}) {
  const [expanded, setExpanded] = React.useState(false)
  const status = getReadStatus(tool, isStreaming)
  const preview = status === "complete" ? notePreview(tool) : undefined
  const failure = status === "failed" ? failureMessage(tool) : undefined
  const truncated = tool.output?.preview_truncated === true
  const position = viewPosition(index, tool)
  const label = `${statusLabel(status)} image ${position.spoken}`

  return (
    <li>
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        aria-busy={status === "running"}
        aria-label={label}
        className="flex max-w-full items-center gap-1.5 rounded-lg px-2 py-1 text-left text-muted-foreground hover:bg-muted/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ReadStatusIcon status={status} />
        {status !== "complete" && (
          <span className="shrink-0 text-muted-foreground/80">
            {position.compact}
          </span>
        )}
        {preview && !expanded && (
          <span className="min-w-0 truncate text-foreground/75">
            {shortPreview(preview)}
          </span>
        )}
        <ChevronDown
          aria-hidden="true"
          className={cn(
            "size-3.5 shrink-0 transition-transform",
            !expanded && "-rotate-90",
            "motion-reduce:transition-none",
          )}
        />
      </button>
      {expanded && (
        <ReadResultDetails
          status={status}
          preview={preview}
          truncated={truncated}
          failure={failure}
        />
      )}
    </li>
  )
}

function ActiveReadStatus({
  tool,
  index,
  count,
}: {
  tool: BrowserTool
  index: number
  count: number
}) {
  const [phraseIndex, setPhraseIndex] = React.useState(0)
  const position = metadataNumber(tool.input, "view_index") ?? index + 1

  React.useEffect(() => {
    const timer = window.setInterval(() => {
      setPhraseIndex((current) => (current + 1) % READING_PHRASES.length)
    }, 2200)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <output
      aria-label="Image transcription"
      aria-busy="true"
      className="flex items-center gap-1.5 px-2 py-1 text-muted-foreground"
    >
      <Loader2
        aria-hidden="true"
        className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none"
      />
      <span aria-hidden="true">{READING_PHRASES[phraseIndex]}</span>
      <span className="text-muted-foreground/75">
        {position} of {count} images
      </span>
      <span className="sr-only">
        Transcribing image {position} of {count}
      </span>
    </output>
  )
}

function BrowserContextTools({
  activity,
  isStreaming,
}: BrowserActivityPartProps) {
  const warning = activityWarning(activity)
  const tools = activity.tools ?? []
  const activeReadIndex = tools.findIndex(
    (tool) => getReadStatus(tool, isStreaming) === "running",
  )
  const finishedTools = tools
    .map((tool, index) => ({ tool, index }))
    .filter(({ tool }) => getReadStatus(tool, isStreaming) !== "running")
  const activeTool = activeReadIndex >= 0 ? tools[activeReadIndex] : undefined
  const activeCount = activeTool
    ? (metadataNumber(activeTool.input, "view_count") ?? tools.length)
    : 0
  return (
    <section
      aria-label="Browser context tools"
      className="ml-2 border-l border-border/60 pl-2"
    >
      {finishedTools.length > 0 && (
        <ol className="space-y-0.5">
          {finishedTools.map(({ tool, index }) => (
            <BrowserToolRow
              key={tool.id}
              tool={tool}
              index={index}
              isStreaming={isStreaming}
            />
          ))}
        </ol>
      )}
      {activeTool && (
        <ActiveReadStatus
          key={activeTool.id}
          tool={activeTool}
          index={activeReadIndex}
          count={activeCount}
        />
      )}
      {warning && (
        <p className="ml-7 px-2 py-1 text-muted-foreground">{warning}</p>
      )}
    </section>
  )
}

function PreparationStatus({ message }: { message?: string }) {
  return (
    <div className="flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground">
      <Loader2 aria-hidden="true" className="size-3.5 shrink-0 animate-spin" />
      <span>{message ?? "Preparing an answer."}</span>
    </div>
  )
}

interface ActivityPresentation {
  hasActivity: boolean
  preparationOnly: boolean
  showPreparation: boolean
  latestMessage?: string
}

function getActivityPresentation(
  activity: BrowserActivity,
  isStreaming: boolean,
): ActivityPresentation {
  const tools = activity.tools ?? []
  const latestStep = activity.steps[activity.steps.length - 1]
  const hasRunningRead = tools.some(
    (tool) => getReadStatus(tool, isStreaming) === "running",
  )
  const showPreparation = isStreaming && !hasRunningRead
  const hasTools = tools.length > 0
  const hasWarning = Boolean(activityWarning(activity))
  const preparationOnly = showPreparation && !hasTools && !hasWarning
  return {
    hasActivity: isStreaming || hasTools || hasWarning,
    preparationOnly,
    showPreparation,
    latestMessage: latestStep?.message,
  }
}

export function BrowserActivityPart({
  activity,
  isStreaming,
}: BrowserActivityPartProps) {
  const presentation = getActivityPresentation(activity, isStreaming)

  if (!presentation.hasActivity) return null
  if (presentation.preparationOnly)
    return <PreparationStatus message={presentation.latestMessage} />

  return (
    <div className="flex flex-col items-start text-xs">
      <BrowserContextTools activity={activity} isStreaming={isStreaming} />
      {presentation.showPreparation && (
        <PreparationStatus message={presentation.latestMessage} />
      )}
    </div>
  )
}
