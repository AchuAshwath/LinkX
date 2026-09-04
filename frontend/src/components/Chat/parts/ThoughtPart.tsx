import {
  Calendar,
  CheckCheck,
  ChevronDown,
  Database,
  Globe,
  Loader2,
  Search,
  ShieldCheck,
  SquarePen,
  SquareTerminal,
} from "lucide-react"
import * as React from "react"
import ReactMarkdown from "react-markdown"
import remarkBreaks from "remark-breaks"
import remarkGfm from "remark-gfm"

import type {
  SourceUrlPart,
  ThoughtPart as ThoughtPartType,
  ToolCallItem,
  WebSearchToolPart,
} from "@/components/Chat/types"
import { completeStreamingMarkdown } from "@/lib/markdown-stream"
import { cn } from "@/lib/utils"

export interface ThoughtPartProps {
  part?: ThoughtPartType
  content?: string
  toolCalls?: ToolCallItem[]
  webSearchPart?: WebSearchToolPart
  sources?: SourceUrlPart[]
  isStreaming?: boolean
  hasResponseStarted?: boolean
  durationSeconds?: number
  className?: string
}

interface ResolveExpandedOptions {
  manualExpanded: boolean | null
  isStreaming: boolean
  hasResponseStarted: boolean
}

function resolveExpandedState({
  manualExpanded,
  isStreaming,
  hasResponseStarted,
}: ResolveExpandedOptions): boolean {
  if (manualExpanded !== null) {
    return manualExpanded
  }
  return isStreaming && !hasResponseStarted
}

function ThoughtContent({ content }: { content?: string }) {
  if (!content) {
    return (
      <span className="italic text-muted-foreground/60 text-xs">
        Analyzing prompt and formulating steps…
      </span>
    )
  }
  const formattedContent = completeStreamingMarkdown(content)
  return (
    <div className="text-xs text-muted-foreground/80 font-normal leading-relaxed [&_p]:my-1 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4 [&_li]:my-0.5 [&_code]:bg-muted/60 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_strong]:font-medium [&_strong]:text-foreground/90">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>
        {formattedContent}
      </ReactMarkdown>
    </div>
  )
}

const CATEGORY_MATCHERS: Array<{
  keywords: string[]
  icon: React.ComponentType<{ className?: string }>
}> = [
  { keywords: ["validate", "constraint", "rule", "check"], icon: CheckCheck },
  {
    keywords: ["save", "store", "db", "trend", "topic", "history", "query"],
    icon: Database,
  },
  { keywords: ["scrape", "web", "search", "explore"], icon: Globe },
  { keywords: ["schedule", "calendar"], icon: Calendar },
  { keywords: ["account", "auth", "login"], icon: ShieldCheck },
  { keywords: ["draft", "compose", "post"], icon: SquarePen },
]

/**
 * Explicit dictionary mapping tool names and categories to their dedicated icons.
 */
export const TOOL_ICON_DICTIONARY: Record<
  string,
  React.ComponentType<{ className?: string }>
> = {
  // Database / Data Store tools
  get_latest_scraped_trends: Database,
  get_topic_tweets_and_summary: Database,
  get_recent_post_history: Database,
  save_draft_post: Database,
  update_draft_post: Database,
  database: Database,
  db: Database,

  // Validation / Constraints / Rules tools
  validate_post_constraints: CheckCheck,
  validate: CheckCheck,
  validation: CheckCheck,
  constraints: CheckCheck,

  // Web / Scraper tools
  scrape_live_explore_trends: Globe,
  scrape_topic_timeline: Globe,
  web_search: Search,
  web: Globe,
  scrape: Globe,
  browser: Globe,

  // Draft / Post authoring tools
  draft_social_post: SquarePen,
  draft: SquarePen,
  composer: SquarePen,

  // Scheduling tools
  schedule_post_in_db: Calendar,
  schedule: Calendar,

  // Account / Authentication tools
  get_social_account_status: ShieldCheck,
  account: ShieldCheck,

  // Terminal / Execution / CLI tools
  terminal: SquareTerminal,
  bash: SquareTerminal,
  exec: SquareTerminal,
}

export function getToolIcon(
  name: string,
): React.ComponentType<{ className?: string }> {
  const normalized = name.trim().toLowerCase()
  if (TOOL_ICON_DICTIONARY[normalized]) {
    return TOOL_ICON_DICTIONARY[normalized]
  }
  const matched = CATEGORY_MATCHERS.find((cat) =>
    cat.keywords.some((kw) => normalized.includes(kw)),
  )
  return matched ? matched.icon : SquareTerminal
}

function ToolPayloadSection({
  label,
  value,
}: {
  label: string
  value: unknown
}) {
  if (!value) return null
  const content =
    typeof value === "string" ? value : JSON.stringify(value, null, 2)
  return (
    <div>
      <div className="text-[10px] text-muted-foreground/70 uppercase tracking-wider mb-0.5 font-mono">
        {label}
      </div>
      <pre className="text-foreground/80 pl-2 border-l border-border/60 whitespace-pre-wrap break-words">
        {content}
      </pre>
    </div>
  )
}

function ToolPayloadViewer({
  input,
  output,
}: {
  input?: unknown
  output?: unknown
}) {
  return (
    <div className="mt-1 ml-4 rounded-md bg-muted/30 border border-border/40 p-2 font-mono text-[11px] text-muted-foreground space-y-1.5 animate-in fade-in-0 duration-150 overflow-x-auto">
      <ToolPayloadSection label="Input" value={input} />
      <ToolPayloadSection label="Output" value={output} />
    </div>
  )
}

function TerminalToolHeader({
  name,
  hasPayload,
  detailsExpanded,
  state,
  durationMs,
  onToggle,
}: {
  name: string
  hasPayload: boolean
  detailsExpanded: boolean
  state?: string
  durationMs?: number
  onToggle: () => void
}) {
  const IconComponent = getToolIcon(name)
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={!hasPayload}
      aria-label="Toggle tool payload details"
      className={cn(
        "group flex w-full items-center justify-between gap-3 px-2 py-1.5 rounded-md text-muted-foreground transition-colors text-left",
        hasPayload
          ? "hover:bg-muted/40 hover:text-foreground cursor-pointer select-none"
          : "cursor-default",
      )}
    >
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <IconComponent className="size-3.5 shrink-0 text-muted-foreground/80 group-hover:text-foreground transition-colors" />
        <span className="text-foreground/90 font-normal truncate">{name}</span>
        {state === "running" && (
          <Loader2 className="size-3 animate-spin text-muted-foreground shrink-0" />
        )}
        {durationMs !== undefined && (
          <span className="text-[11px] text-muted-foreground/60 font-mono shrink-0">
            ({durationMs}ms)
          </span>
        )}
      </div>

      {hasPayload && (
        <div className="flex items-center justify-center shrink-0 pr-0.5">
          <ChevronDown
            className={cn(
              "size-4 text-muted-foreground/80 group-hover:text-foreground transition-transform duration-200 shrink-0",
              detailsExpanded && "rotate-180",
            )}
          />
        </div>
      )}
    </button>
  )
}

function TerminalToolCallRow({ tool }: { tool: ToolCallItem }) {
  const [detailsExpanded, setDetailsExpanded] = React.useState(false)
  const hasPayload = Boolean(tool.input || tool.output)

  const handleToggle = React.useCallback(() => {
    if (hasPayload) {
      setDetailsExpanded((prev) => !prev)
    }
  }, [hasPayload])

  return (
    <div className="flex flex-col w-full text-xs">
      <TerminalToolHeader
        name={tool.name}
        hasPayload={hasPayload}
        detailsExpanded={detailsExpanded}
        state={tool.state}
        durationMs={tool.durationMs}
        onToggle={handleToggle}
      />
      {hasPayload && detailsExpanded && (
        <ToolPayloadViewer input={tool.input} output={tool.output} />
      )}
    </div>
  )
}

function WebSearchItem({ src, index }: { src: SourceUrlPart; index: number }) {
  let hostname = ""
  try {
    hostname = new URL(src.url).hostname
  } catch {
    hostname = src.url
  }
  return (
    <a
      key={src.sourceId || index}
      href={src.url}
      target="_blank"
      rel="noreferrer"
      className="group flex items-start gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors leading-relaxed break-words"
    >
      <Globe className="size-3.5 mt-0.5 shrink-0 text-muted-foreground/80 group-hover:text-primary transition-colors" />
      <div className="flex-1 break-words">
        Ran fetch{" "}
        <span className="text-foreground font-medium group-hover:text-primary group-hover:underline underline-offset-2 transition-colors">
          {hostname}
        </span>
        {src.title ? ` · ${src.title}` : ""}
      </div>
    </a>
  )
}

function WebSearchSection({
  query,
  sources,
  errorText,
}: {
  query?: string
  sources: SourceUrlPart[]
  errorText?: string
}) {
  return (
    <div className="flex flex-col gap-1.5 text-xs w-full">
      {query && (
        <div className="flex items-start gap-2 text-xs text-muted-foreground leading-relaxed break-words">
          <Globe className="size-3.5 mt-0.5 shrink-0 text-muted-foreground/80" />
          <div className="flex-1 break-words">
            Ran search{" "}
            <span className="text-foreground font-medium">"{query}"</span>
          </div>
        </div>
      )}
      {sources.map((src, i) => (
        <WebSearchItem key={src.sourceId || i} src={src} index={i} />
      ))}
      {errorText && (
        <p className="py-0.5 text-xs text-destructive break-words">
          Command failed: {errorText}
        </p>
      )}
    </div>
  )
}

function computeFinalDuration({
  durationSeconds,
  elapsedSeconds,
  totalToolMs,
}: {
  durationSeconds?: number
  elapsedSeconds: number
  totalToolMs: number
}): number {
  if (durationSeconds !== undefined && durationSeconds > 0) {
    return durationSeconds
  }
  if (elapsedSeconds > 0) {
    return elapsedSeconds
  }
  if (totalToolMs > 0) {
    return Math.max(1, Math.round(totalToolMs / 1000))
  }
  return 2
}

interface DurationLabelOptions {
  isThinking: boolean
  hasTools: boolean
  finalDuration: number
}

function getDurationLabel({
  isThinking,
  hasTools,
  finalDuration,
}: DurationLabelOptions): string {
  if (isThinking) return "Thinking…"
  const unit = finalDuration === 1 ? "second" : "seconds"
  return hasTools
    ? `Worked for ${finalDuration} ${unit}`
    : `Thought for ${finalDuration} ${unit}`
}

interface CanRenderOptions {
  hasContent: boolean
  hasTools: boolean
  hasWebSearch: boolean
  isThinking: boolean
}

function canRenderThought({
  hasContent,
  hasTools,
  hasWebSearch,
  isThinking,
}: CanRenderOptions): boolean {
  if (isThinking) return true
  if (hasContent) return true
  if (hasTools) return true
  return hasWebSearch
}

function ThoughtReasoningSection({
  hasContent,
  hasPriorSection,
  rawContent,
}: {
  hasContent: boolean
  hasPriorSection: boolean
  rawContent: string
}) {
  if (!hasContent) return null
  return (
    <div
      className={cn(
        "text-xs w-full",
        hasPriorSection && "pt-1.5 border-t border-border/30",
      )}
    >
      {hasPriorSection && (
        <div className="text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wider mb-1 font-mono">
          Reasoning
        </div>
      )}
      <ThoughtContent content={rawContent} />
    </div>
  )
}

function ThoughtToolList({ toolCalls }: { toolCalls: ToolCallItem[] }) {
  if (toolCalls.length === 0) return null
  return (
    <div className="flex flex-col gap-2 w-full">
      {toolCalls.map((tool, idx) => (
        <TerminalToolCallRow
          key={tool.id || `${tool.name}-${idx}`}
          tool={tool}
        />
      ))}
    </div>
  )
}

function ThoughtExpandedBody({
  toolCalls,
  webSearchPart,
  sources,
  hasContent,
  rawContent,
}: {
  toolCalls: ToolCallItem[]
  webSearchPart?: WebSearchToolPart
  sources: SourceUrlPart[]
  hasContent: boolean
  rawContent: string
}) {
  const hasWebSearch = Boolean(webSearchPart)
  const hasTools = toolCalls.length > 0
  const hasPriorSection = hasTools || hasWebSearch
  const searchError =
    webSearchPart?.state === "output-error"
      ? webSearchPart.errorText || "Web search failed"
      : undefined

  return (
    <div className="mt-1.5 ml-1.5 flex flex-col gap-2.5 border-l border-border/50 pl-3 py-1 text-xs w-full animate-in fade-in-0 duration-150">
      <ThoughtToolList toolCalls={toolCalls} />
      {hasWebSearch && (
        <WebSearchSection
          query={webSearchPart?.input?.query}
          sources={sources}
          errorText={searchError}
        />
      )}
      <ThoughtReasoningSection
        hasContent={hasContent}
        hasPriorSection={hasPriorSection}
        rawContent={rawContent}
      />
    </div>
  )
}

function useThinkingTimer({
  isThinking,
  durationSeconds,
}: {
  isThinking: boolean
  durationSeconds?: number
}): number {
  const [startTime] = React.useState<number>(() => Date.now())
  const [elapsedSeconds, setElapsedSeconds] = React.useState<number>(
    () => durationSeconds ?? 0,
  )

  React.useEffect(() => {
    if (!isThinking) return
    const interval = setInterval(() => {
      setElapsedSeconds(
        Math.max(1, Math.round((Date.now() - startTime) / 1000)),
      )
    }, 1000)
    return () => clearInterval(interval)
  }, [isThinking, startTime])

  return elapsedSeconds
}

function useTotalToolDuration(toolCalls: ToolCallItem[]): number {
  return React.useMemo(() => {
    let sum = 0
    for (const t of toolCalls) {
      sum += t.durationMs || 0
    }
    return sum
  }, [toolCalls])
}

function ThoughtHeaderButton({
  isThinking,
  labelText,
  isExpanded,
  onToggle,
}: {
  isThinking: boolean
  labelText: string
  isExpanded: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label="Toggle thinking details"
      className="flex items-center gap-1.5 py-0.5 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer font-medium select-none"
    >
      {isThinking && (
        <Loader2 className="size-3.5 animate-spin text-muted-foreground shrink-0" />
      )}
      <span>{labelText}</span>
      <ChevronDown
        className={cn(
          "size-3.5 text-muted-foreground transition-transform duration-200 shrink-0",
          !isExpanded && "-rotate-90",
        )}
      />
    </button>
  )
}

export function ThoughtPart({
  part,
  content: directContent,
  toolCalls = [],
  webSearchPart,
  sources = [],
  isStreaming = false,
  hasResponseStarted = false,
  durationSeconds,
  className,
}: ThoughtPartProps) {
  const [manualExpanded, setManualExpanded] = React.useState<boolean | null>(
    null,
  )

  const isThinking = isStreaming && !hasResponseStarted
  const rawContent = directContent ?? part?.content ?? ""
  const hasContent = Boolean(rawContent.trim())
  const hasTools = toolCalls.length > 0
  const hasWebSearch = Boolean(webSearchPart)

  const elapsedSeconds = useThinkingTimer({ isThinking, durationSeconds })
  const totalToolMs = useTotalToolDuration(toolCalls)

  const finalDuration = React.useMemo(
    () =>
      computeFinalDuration({
        durationSeconds,
        elapsedSeconds,
        totalToolMs,
      }),
    [durationSeconds, elapsedSeconds, totalToolMs],
  )

  const isExpanded = resolveExpandedState({
    manualExpanded,
    isStreaming,
    hasResponseStarted,
  })

  if (!canRenderThought({ hasContent, hasTools, hasWebSearch, isThinking })) {
    return null
  }

  const labelText = getDurationLabel({
    isThinking,
    hasTools,
    finalDuration,
  })

  return (
    <div className={cn("my-1.5 flex flex-col items-start w-full", className)}>
      <ThoughtHeaderButton
        isThinking={isThinking}
        labelText={labelText}
        isExpanded={isExpanded}
        onToggle={() => setManualExpanded(!isExpanded)}
      />

      {isExpanded && (
        <ThoughtExpandedBody
          toolCalls={toolCalls}
          webSearchPart={webSearchPart}
          sources={sources}
          hasContent={hasContent}
          rawContent={rawContent}
        />
      )}
    </div>
  )
}
