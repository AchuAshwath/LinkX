import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

import type { TextMessagePart } from "@/components/Chat/types"

export function TextPart({ part }: { part: TextMessagePart }) {
  if (!part.text.trim()) {
    return null
  }

  return (
    <div className="typeset px-1 leading-relaxed text-sm text-foreground">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{part.text}</ReactMarkdown>
    </div>
  )
}
