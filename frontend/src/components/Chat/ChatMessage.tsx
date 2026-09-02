import { DraftArtifactCard } from "@/components/Chat/DraftArtifactCard"
import { TextPart } from "@/components/Chat/parts/TextPart"
import { ThoughtPart } from "@/components/Chat/parts/ThoughtPart"
import { WebSearchPart } from "@/components/Chat/parts/WebSearchPart"
import { ToolCallAccordion } from "@/components/Chat/ToolCallAccordion"
import type { ChatUIMessage, SourceUrlPart } from "@/components/Chat/types"
import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { Message, MessageContent } from "@/components/ui/message"

export interface ChatMessageProps {
  message: ChatUIMessage
  isStreaming?: boolean
}

function UserMessageBubble({ message }: { message: ChatUIMessage }) {
  const text = message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("")

  return (
    <Message align="end">
      <MessageContent>
        <Bubble align="end" variant="outline">
          <BubbleContent className="rounded-3xl border border-border bg-background text-foreground font-normal px-5 py-3 leading-relaxed shadow-none">
            {text}
          </BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  )
}

function renderToolOrDraftPart(
  part: ChatUIMessage["parts"][number],
  index: number,
  sources: SourceUrlPart[],
) {
  if (part.type === "tool-web_search") {
    return (
      <WebSearchPart
        key={part.toolCallId || `search-${index}`}
        part={part}
        sources={sources}
      />
    )
  }
  if (part.type === "tool-call") {
    return (
      <ToolCallAccordion
        key={part.toolCallId || `tool-${index}`}
        toolCalls={[part.tool]}
      />
    )
  }
  if (part.type === "draft_artifact") {
    return (
      <DraftArtifactCard
        key={part.artifact.id || `draft-${index}`}
        artifact={part.artifact}
      />
    )
  }
  return null
}

function AssistantPartRenderer({
  part,
  index,
  isStreaming,
  hasResponseStarted,
  sources,
}: {
  part: ChatUIMessage["parts"][number]
  index: number
  isStreaming: boolean
  hasResponseStarted: boolean
  sources: SourceUrlPart[]
}) {
  if (part.type === "thought") {
    return (
      <ThoughtPart
        key={`thought-${index}`}
        part={part}
        isStreaming={isStreaming && !hasResponseStarted}
        hasResponseStarted={hasResponseStarted}
      />
    )
  }
  if (part.type === "text") {
    return <TextPart key={`text-${index}`} part={part} />
  }
  return renderToolOrDraftPart(part, index, sources)
}

export function ChatMessage({
  message,
  isStreaming = false,
}: ChatMessageProps) {
  if (message.role === "user") {
    return <UserMessageBubble message={message} />
  }

  const sources = message.parts.filter(
    (part): part is SourceUrlPart => part.type === "source-url",
  )

  const hasResponseStarted = message.parts.some(
    (p) => p.type === "text" && Boolean(p.text?.trim()),
  )

  return (
    <Message align="start">
      <MessageContent>
        {message.parts.map((part, index) => (
          <AssistantPartRenderer
            key={index}
            part={part}
            index={index}
            isStreaming={isStreaming}
            hasResponseStarted={hasResponseStarted}
            sources={sources}
          />
        ))}
      </MessageContent>
    </Message>
  )
}
