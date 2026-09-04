import {
  CheckCircle2Icon,
  ChevronDownIcon,
  Loader2Icon,
  XCircleIcon,
} from "lucide-react"
import * as React from "react"
import { getToolIcon } from "@/components/Chat/parts/ThoughtPart"
import type { ToolCallItem } from "@/components/Chat/types"

export interface ToolCallAccordionProps {
  toolCalls: ToolCallItem[]
  className?: string
}

function ToolStatusIcon({ state }: { state: ToolCallItem["state"] }) {
  if (state === "running") {
    return (
      <Loader2Icon className="h-3.5 w-3.5 animate-spin text-primary shrink-0" />
    )
  }
  if (state === "completed") {
    return (
      <CheckCircle2Icon className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
    )
  }
  if (state === "failed") {
    return <XCircleIcon className="h-3.5 w-3.5 text-destructive shrink-0" />
  }
  return null
}

function ToolCallDetails({ tool }: { tool: ToolCallItem }) {
  return (
    <div className="border-t border-border/60 bg-zinc-950 dark:bg-black text-zinc-200 p-3 flex flex-col gap-2 font-mono text-[11px] overflow-x-auto">
      {tool.input && (
        <div>
          <div className="text-zinc-500 text-[10px] uppercase tracking-wider mb-1 flex items-center gap-1.5 font-mono">
            <span className="text-emerald-400">$</span> input:
          </div>
          <pre className="text-zinc-300 pl-2.5 border-l border-zinc-800 whitespace-pre-wrap break-words overflow-x-auto">
            {typeof tool.input === "string"
              ? tool.input
              : JSON.stringify(tool.input, null, 2)}
          </pre>
        </div>
      )}
      {tool.output && (
        <div>
          <div className="text-zinc-500 text-[10px] uppercase tracking-wider mb-1 flex items-center gap-1.5 font-mono">
            <span className="text-blue-400">➜</span> output:
          </div>
          <pre className="text-zinc-300 pl-2.5 border-l border-zinc-800 whitespace-pre-wrap break-words overflow-x-auto">
            {typeof tool.output === "string"
              ? tool.output
              : JSON.stringify(tool.output, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}

function ToolCallCard({
  tool,
  isExpanded,
  onToggle,
}: {
  tool: ToolCallItem
  isExpanded: boolean
  onToggle: () => void
}) {
  const IconComponent = getToolIcon(tool.name)

  return (
    <div className="rounded-xl border border-border/80 bg-zinc-950/5 dark:bg-zinc-950/40 overflow-hidden text-xs transition-all shadow-2xs font-mono">
      <button
        type="button"
        onClick={onToggle}
        aria-label="Toggle tool details"
        className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-muted/40 transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-2 min-w-0">
          <IconComponent className="size-3.5 text-muted-foreground/80 shrink-0" />
          <ToolStatusIcon state={tool.state} />
          <span className="font-semibold text-foreground truncate">
            {tool.state === "running" ? `Executing ${tool.name}…` : tool.name}
          </span>
          {tool.durationMs !== undefined && (
            <span className="text-[10px] text-muted-foreground font-mono">
              ({tool.durationMs}ms)
            </span>
          )}
        </div>
        <ChevronDownIcon
          className={`h-3.5 w-3.5 text-muted-foreground transition-transform duration-200 shrink-0 ${
            isExpanded ? "rotate-180" : ""
          }`}
        />
      </button>
      {isExpanded && <ToolCallDetails tool={tool} />}
    </div>
  )
}

export function ToolCallAccordion({
  toolCalls,
  className,
}: ToolCallAccordionProps) {
  const [expandedIds, setExpandedIds] = React.useState<Record<string, boolean>>(
    {},
  )

  if (!toolCalls || toolCalls.length === 0) {
    return null
  }

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  return (
    <div
      className={`flex flex-col gap-2 my-2 w-full max-w-xl ${className || ""}`}
    >
      {toolCalls.map((tool) => (
        <ToolCallCard
          key={tool.id}
          tool={tool}
          isExpanded={expandedIds[tool.id] ?? false}
          onToggle={() => toggleExpand(tool.id)}
        />
      ))}
    </div>
  )
}
