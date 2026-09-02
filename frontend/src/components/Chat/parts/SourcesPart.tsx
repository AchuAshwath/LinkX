import { ExternalLinkIcon, GlobeIcon } from "lucide-react"

import type { ChatMessagePart, SourceUrlPart } from "@/components/Chat/types"

function getUniqueSources(parts: ChatMessagePart[]): SourceUrlPart[] {
  return parts
    .filter((part): part is SourceUrlPart => part.type === "source-url")
    .filter((source) => source.url?.startsWith("http"))
    .filter(
      (source, index, all) =>
        all.findIndex((other) => other.url === source.url) === index,
    )
}

function getHostname(url: string) {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

export function SourcesPart({ parts }: { parts: ChatMessagePart[] }) {
  const sources = getUniqueSources(parts)

  if (sources.length === 0) {
    return null
  }

  const count = sources.length
  const label = `Searched ${count} ${count === 1 ? "website" : "websites"}`

  return (
    <div className="mt-2 flex flex-col gap-1.5 px-1">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
        <GlobeIcon className="h-3.5 w-3.5 text-primary" />
        <span>{label}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {sources.map((source) => {
          const hostname = getHostname(source.url)
          const title = source.title || hostname
          return (
            <a
              key={source.sourceId || source.url}
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-lg border border-border/70 bg-muted/30 px-2 py-1 text-[11px] font-medium text-foreground hover:bg-muted/70 hover:text-primary transition-colors"
            >
              <span className="truncate max-w-[150px]">{title}</span>
              <ExternalLinkIcon className="h-2.5 w-2.5 opacity-60" />
            </a>
          )
        })}
      </div>
    </div>
  )
}
