import {
  CheckCircle2Icon,
  ChevronDownIcon,
  Loader2Icon,
  XCircleIcon,
} from "lucide-react"
import * as React from "react"
import type { ToolCallItem } from "@/components/Chat/types"

export interface ToolCallAccordionProps {
  toolCalls: ToolCallItem[]
  className?: string
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
      {toolCalls.map((tool) => {
        const isExpanded = expandedIds[tool.id] ?? false

        return (
          <div
            key={tool.id}
            className="rounded-xl border border-border/80 bg-card/60 overflow-hidden text-xs transition-all shadow-2xs"
          >
            {/* Header / Summary row */}
            <button
              type="button"
              onClick={() => toggleExpand(tool.id)}
              aria-label="Toggle tool details"
              className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-muted/40 transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-2 min-w-0">
                {tool.state === "running" && (
                  <Loader2Icon className="h-3.5 w-3.5 animate-spin text-primary shrink-0" />
                )}
                {tool.state === "completed" && (
                  <CheckCircle2Icon className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                )}
                {tool.state === "failed" && (
                  <XCircleIcon className="h-3.5 w-3.5 text-destructive shrink-0" />
                )}

                <span className="font-semibold text-foreground truncate">
                  {tool.state === "running"
                    ? `Executing ${tool.name}…`
                    : tool.name}
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

            {/* Expandable Execution Details */}
            {isExpanded && (
              <div className="border-t border-border/60 bg-muted/20 p-3 flex flex-col gap-2 font-mono text-[11px] overflow-x-auto">
                {tool.input && (
                  <div>
                    <span className="font-semibold text-muted-foreground block mb-0.5">
                      Input:
                    </span>
                    <pre className="text-foreground bg-background/80 rounded-lg p-2 border border-border/50 overflow-x-auto">
                      {JSON.stringify(tool.input, null, 2)}
                    </pre>
                  </div>
                )}
                {tool.output && (
                  <div>
                    <span className="font-semibold text-muted-foreground block mb-0.5">
                      Output:
                    </span>
                    <pre className="text-foreground bg-background/80 rounded-lg p-2 border border-border/50 overflow-x-auto">
                      {JSON.stringify(tool.output, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
