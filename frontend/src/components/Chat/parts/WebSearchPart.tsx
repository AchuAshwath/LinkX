import { ChevronDown, Globe, Loader2, SquareTerminal } from "lucide-react"
import * as React from "react"
import type { SourceUrlPart, WebSearchToolPart } from "@/components/Chat/types"
import { cn } from "@/lib/utils"

export function WebSearchPart({
  part,
  sources = [],
}: {
  part: WebSearchToolPart
  sources?: SourceUrlPart[]
}) {
  const [expanded, setExpanded] = React.useState(false)
  const isSearching =
    part.state === "input-streaming" || part.state === "input-available"
  const isFailed = part.state === "output-error"

  return (
    <div className="my-1.5 flex flex-col items-start w-full">
      {/* Abstract collapsible header line */}
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        aria-label="Toggle web search details"
        className="flex items-center gap-1.5 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer font-medium select-none"
      >
        {isSearching ? (
          <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
        ) : (
          <SquareTerminal className="size-3.5 text-muted-foreground" />
        )}
        <span>Ran commands, searched the web</span>
        <ChevronDown
          className={cn(
            "size-3.5 text-muted-foreground transition-transform duration-200",
            !expanded && "-rotate-90",
          )}
        />
      </button>

      {/* Itemized action lines with natural word wrap and consistent system fonts */}
      {expanded && (
        <div className="mt-1 ml-1.5 flex flex-col gap-1.5 border-l border-border/50 pl-3 py-1 text-xs w-full animate-in fade-in-0 duration-150">
          {part.input?.query && (
            <div className="flex items-start gap-2 text-xs text-muted-foreground leading-relaxed break-words">
              <SquareTerminal className="size-3.5 mt-0.5 shrink-0 text-muted-foreground/80" />
              <div className="flex-1 break-words">
                Ran search{" "}
                <span className="text-foreground font-medium">
                  "{part.input.query}"
                </span>
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

          {isFailed && (
            <p className="py-0.5 text-xs text-destructive break-words">
              Command failed: {part.errorText || "Web search error"}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
