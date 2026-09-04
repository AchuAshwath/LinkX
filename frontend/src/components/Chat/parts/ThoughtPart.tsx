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

function resolveExpandedState(
  manualExpanded: boolean | null,
  isStreaming: boolean,
  hasResponseStarted: boolean,
): boolean {
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

  // 1. Direct dictionary match
  if (TOOL_ICON_DICTIONARY[normalized]) {
    return TOOL_ICON_DICTIONARY[normalized]
  }

  // 2. Exact match on prefixes/categories in precedence order:
  // Validation must be checked before "post" so "validate_post_constraints" gets CheckCheck
  if (
    normalized.includes("validate") ||
    normalized.includes("constraint") ||
    normalized.includes("rule") ||
    normalized.includes("check")
  ) {
    return CheckCheck
  }

  // Database / Data Store tools (saving, storing, or querying DB)
  if (
    normalized.includes("save") ||
    normalized.includes("store") ||
    normalized.includes("db") ||
    normalized.includes("trend") ||
    normalized.includes("topic") ||
    normalized.includes("history") ||
    normalized.includes("query")
  ) {
    return Database
  }

  // Web & scraping tools
  if (
    normalized.includes("scrape") ||
    normalized.includes("web") ||
    normalized.includes("search") ||
    normalized.includes("explore")
  ) {
    return Globe
  }

  // Schedule tools
  if (normalized.includes("schedule") || normalized.includes("calendar")) {
    return Calendar
  }

  // Account tools
  if (
    normalized.includes("account") ||
    normalized.includes("auth") ||
    normalized.includes("login")
  ) {
    return ShieldCheck
  }

  // Draft tools
  if (
    normalized.includes("draft") ||
    normalized.includes("compose") ||
    normalized.includes("post")
  ) {
    return SquarePen
  }

  return SquareTerminal
}

function TerminalToolCallRow({ tool }: { tool: ToolCallItem }) {
  const [detailsExpanded, setDetailsExpanded] = React.useState(false)
  const hasPayload = Boolean(tool.input || tool.output)
  const IconComponent = getToolIcon(tool.name)

  return (
    <div className="flex flex-col w-full text-xs">
      <button
        type="button"
        onClick={() => hasPayload && setDetailsExpanded((prev) => !prev)}
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
          <span className="text-foreground/90 font-normal truncate">
            {tool.name}
          </span>
          {tool.state === "running" && (
            <Loader2 className="size-3 animate-spin text-muted-foreground shrink-0" />
          )}
          {tool.durationMs !== undefined && (
            <span className="text-[11px] text-muted-foreground/60 font-mono shrink-0">
              ({tool.durationMs}ms)
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

      {hasPayload && detailsExpanded && (
        <div className="mt-1 ml-4 rounded-md bg-muted/30 border border-border/40 p-2 font-mono text-[11px] text-muted-foreground space-y-1.5 animate-in fade-in-0 duration-150 overflow-x-auto">
          {tool.input && (
            <div>
              <div className="text-[10px] text-muted-foreground/70 uppercase tracking-wider mb-0.5 font-mono">
                Input
              </div>
              <pre className="text-foreground/80 pl-2 border-l border-border/60 whitespace-pre-wrap break-words">
                {typeof tool.input === "string"
                  ? tool.input
                  : JSON.stringify(tool.input, null, 2)}
              </pre>
            </div>
          )}
          {tool.output && (
            <div>
              <div className="text-[10px] text-muted-foreground/70 uppercase tracking-wider mb-0.5 font-mono">
                Output
              </div>
              <pre className="text-foreground/80 pl-2 border-l border-border/60 whitespace-pre-wrap break-words">
                {typeof tool.output === "string"
                  ? tool.output
                  : JSON.stringify(tool.output, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
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
      {sources.map((src, i) => {
        let hostname = ""
        try {
          hostname = new URL(src.url).hostname
        } catch {
          hostname = src.url
        }
        return (
          <a
            key={src.sourceId || i}
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
      })}
      {errorText && (
        <p className="py-0.5 text-xs text-destructive break-words">
          Command failed: {errorText}
        </p>
      )}
    </div>
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

  // Live elapsed timer for thinking/working phase
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

  const totalToolMs = React.useMemo(
    () => toolCalls.reduce((acc, t) => acc + (t.durationMs || 0), 0),
    [toolCalls],
  )

  const finalDuration = React.useMemo(() => {
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
  }, [durationSeconds, elapsedSeconds, totalToolMs])

  const isExpanded = resolveExpandedState(
    manualExpanded,
    isStreaming,
    hasResponseStarted,
  )

  const shouldRender = hasContent || hasTools || hasWebSearch || isThinking

  if (!shouldRender) {
    return null
  }

  const unit = finalDuration === 1 ? "second" : "seconds"
  const labelText = isThinking
    ? "Thinking…"
    : hasTools
      ? `Worked for ${finalDuration} ${unit}`
      : `Thought for ${finalDuration} ${unit}`

  return (
    <div className={cn("my-1.5 flex flex-col items-start w-full", className)}>
      <button
        type="button"
        onClick={() => setManualExpanded(!isExpanded)}
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

      {isExpanded && (
        <div className="mt-1.5 ml-1.5 flex flex-col gap-2.5 border-l border-border/50 pl-3 py-1 text-xs w-full animate-in fade-in-0 duration-150">
          {/* Tool call command executions */}
          {hasTools && (
            <div className="flex flex-col gap-2 w-full">
              {toolCalls.map((tool, idx) => (
                <TerminalToolCallRow
                  key={tool.id || `${tool.name}-${idx}`}
                  tool={tool}
                />
              ))}
            </div>
          )}

          {/* Web search section */}
          {hasWebSearch && (
            <WebSearchSection
              query={webSearchPart?.input?.query}
              sources={sources}
              errorText={
                webSearchPart?.state === "output-error"
                  ? webSearchPart.errorText || "Web search failed"
                  : undefined
              }
            />
          )}

          {/* Markdown Thought Reasoning */}
          {hasContent && (
            <div
              className={cn(
                "text-xs w-full",
                (hasTools || hasWebSearch) &&
                  "pt-1.5 border-t border-border/30",
              )}
            >
              {(hasTools || hasWebSearch) && (
                <div className="text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wider mb-1 font-mono">
                  Reasoning
                </div>
              )}
              <ThoughtContent content={rawContent} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
