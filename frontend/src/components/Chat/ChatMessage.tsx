import { ChatMessageActions } from "@/components/Chat/ChatMessageActions"
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

function extractTextParts(parts: ChatUIMessage["parts"]): string {
  return parts
    .filter(
      (p): p is { type: "text"; text: string } =>
        p.type === "text" && Boolean(p.text),
    )
    .map((p) => p.text)
    .join("\n\n")
    .trim()
}

function isValidImageUrl(url: string): boolean {
  if (!url) return false
  const trimmed = url.trim().toLowerCase()
  return (
    trimmed.startsWith("data:image/") ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("http://") ||
    trimmed.startsWith("blob:") ||
    trimmed.startsWith("/")
  )
}

function extractImageUrls(parts: ChatUIMessage["parts"]): string[] {
  const urls: string[] = []
  for (const p of parts) {
    if (p.type === "image_url" || p.type === "image") {
      let rawUrl = ""
      if ("url" in p && typeof p.url === "string") {
        rawUrl = p.url
      } else if (
        "image_url" in p &&
        p.image_url &&
        typeof p.image_url === "object" &&
        "url" in p.image_url
      ) {
        rawUrl = String(p.image_url.url || "")
      }
      if (rawUrl && isValidImageUrl(rawUrl)) {
        urls.push(rawUrl)
      }
    }
  }
  return urls
}

function getMessageTimestamp(message: ChatUIMessage): string | undefined {
  return message.createdAt || (message as { created_at?: string }).created_at
}

function UserMessageBubble({ message }: { message: ChatUIMessage }) {
  const text = extractTextParts(message.parts)
  const imageUrls = extractImageUrls(message.parts)
  const createdAt = getMessageTimestamp(message)

  return (
    <div className="group relative flex flex-col items-end w-full">
      <Message align="end">
        <MessageContent>
          <div className="flex flex-col items-end gap-2 max-w-full">
            {imageUrls.length > 0 && (
              <div className="flex flex-wrap justify-end gap-2 max-w-sm">
                {imageUrls.map((url, idx) => (
                  <img
                    key={idx}
                    src={url}
                    alt={`Attachment ${idx + 1}`}
                    className="max-h-48 max-w-xs object-cover rounded-2xl border border-border/80 shadow-sm"
                    onError={(e) => {
                      ;(e.currentTarget as HTMLElement).style.display = "none"
                    }}
                  />
                ))}
              </div>
            )}
            {text && (
              <Bubble align="end" variant="outline">
                <BubbleContent className="rounded-3xl border border-border bg-background text-foreground font-normal px-5 py-3 leading-relaxed shadow-none">
                  {text}
                </BubbleContent>
              </Bubble>
            )}
          </div>
        </MessageContent>
      </Message>
      <ChatMessageActions
        textToCopy={text}
        createdAt={createdAt}
        align="end"
        className="pr-2 pt-0.5"
      />
    </div>
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

  const hasThoughtPart = message.parts.some((p) => p.type === "thought")
  const hasResponseStarted = message.parts.some(
    (p) => p.type === "text" && Boolean(p.text?.trim()),
  )
  const assistantText = extractTextParts(message.parts)
  const createdAt = getMessageTimestamp(message)

  return (
    <div className="group relative flex flex-col items-start w-full">
      <Message align="start">
        <MessageContent>
          {isStreaming && !hasThoughtPart && !hasResponseStarted && (
            <ThoughtPart
              part={{ type: "thought", content: "" }}
              isStreaming={true}
              hasResponseStarted={false}
            />
          )}

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
      {!isStreaming && assistantText && (
        <ChatMessageActions
          textToCopy={assistantText}
          createdAt={createdAt}
          align="start"
          className="pl-2 pt-0.5"
        />
      )}
    </div>
  )
}
