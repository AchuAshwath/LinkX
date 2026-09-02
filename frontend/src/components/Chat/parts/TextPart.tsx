import * as React from "react"
import ReactMarkdown from "react-markdown"
import remarkBreaks from "remark-breaks"
import remarkGfm from "remark-gfm"

import type { TextMessagePart } from "@/components/Chat/types"
import { completeStreamingMarkdown } from "@/lib/markdown-stream"

export function TextPart({ part }: { part: TextMessagePart }) {
  const formattedText = React.useMemo(
    () => completeStreamingMarkdown(part.text),
    [part.text],
  )

  if (!part.text.trim()) {
    return null
  }

  return (
    <div className="typeset px-1 leading-relaxed text-sm text-foreground w-full min-w-0 max-w-full break-words [overflow-wrap:anywhere]">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>
        {formattedText}
      </ReactMarkdown>
    </div>
  )
}
