import { DraftArtifactCard } from "@/components/Chat/DraftArtifactCard"
import { TextPart } from "@/components/Chat/parts/TextPart"
import { WebSearchPart } from "@/components/Chat/parts/WebSearchPart"
import { ToolCallAccordion } from "@/components/Chat/ToolCallAccordion"
import type { ChatUIMessage, SourceUrlPart } from "@/components/Chat/types"
import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { Message, MessageContent } from "@/components/ui/message"

export interface ChatMessageProps {
  message: ChatUIMessage
  isStreaming?: boolean
}

export function ChatMessage({ message }: ChatMessageProps) {
  if (message.role === "user") {
    return (
      <Message align="end">
        <MessageContent>
          <Bubble align="end" variant="outline">
            <BubbleContent className="rounded-3xl border border-border bg-background text-foreground font-normal px-5 py-3 leading-relaxed shadow-none">
              {message.parts
                .filter((part) => part.type === "text")
                .map((part) => part.text)
                .join("")}
            </BubbleContent>
          </Bubble>
        </MessageContent>
      </Message>
    )
  }

  // Collect any source-url parts to pass into collapsible Web Search
  const sources = message.parts.filter(
    (part): part is SourceUrlPart => part.type === "source-url",
  )

  return (
    <Message align="start">
      <MessageContent>
        {message.parts.map((part, index) => {
          switch (part.type) {
            case "text":
              return <TextPart key={`text-${index}`} part={part} />
            case "tool-web_search":
              return (
                <WebSearchPart
                  key={part.toolCallId || `search-${index}`}
                  part={part}
                  sources={sources}
                />
              )
            case "tool-call":
              return (
                <ToolCallAccordion
                  key={part.toolCallId || `tool-${index}`}
                  toolCalls={[part.tool]}
                />
              )
            case "draft_artifact":
              return (
                <DraftArtifactCard
                  key={part.artifact.id || `draft-${index}`}
                  artifact={part.artifact}
                />
              )
            default:
              return null
          }
        })}
      </MessageContent>
    </Message>
  )
}
