import { Clock } from "lucide-react"
import { ChatMessageActions } from "@/components/Chat/ChatMessageActions"
import { DraftArtifactCard } from "@/components/Chat/DraftArtifactCard"
import { TextPart } from "@/components/Chat/parts/TextPart"
import { ThoughtPart } from "@/components/Chat/parts/ThoughtPart"
import { WebSearchPart } from "@/components/Chat/parts/WebSearchPart"
import { ToolCallAccordion } from "@/components/Chat/ToolCallAccordion"
import { TrendingArtifactCard } from "@/components/Chat/TrendingArtifactCard"
import type {
  ChatUIMessage,
  SourceUrlPart,
  ThoughtPart as ThoughtPartType,
  ToolCallItem,
  ToolCallPart,
  WebSearchToolPart,
} from "@/components/Chat/types"
import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { Message, MessageContent } from "@/components/ui/message"

export interface ChatMessageProps {
  message: ChatUIMessage
  isStreaming?: boolean
  onDraftTopic?: (topicTitle: string) => void
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
  onDraftTopic?: (topicTitle: string) => void,
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
  if (part.type === "tool-call" || part.type === "tool_call") {
    const toolPart = part as ToolCallPart
    const toolItem: ToolCallItem = toolPart.tool ?? {
      id: toolPart.toolCallId || `tool-${index}`,
      name: toolPart.name || "tool",
      state: toolPart.state || "completed",
      input: toolPart.input,
      output: toolPart.output,
    }
    return (
      <ToolCallAccordion
        key={toolItem.id || `tool-${index}`}
        toolCalls={[toolItem]}
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
  if (part.type === "trending_artifact") {
    return (
      <TrendingArtifactCard
        key={`trending-${index}`}
        artifact={part.artifact}
        onDraftTopic={onDraftTopic}
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
  onDraftTopic,
}: {
  part: ChatUIMessage["parts"][number]
  index: number
  isStreaming: boolean
  hasResponseStarted: boolean
  sources: SourceUrlPart[]
  onDraftTopic?: (topicTitle: string) => void
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
  return renderToolOrDraftPart(part, index, sources, onDraftTopic)
}

function extractThoughtFromTextParts(parts: ChatUIMessage["parts"]): {
  cleanedParts: ChatUIMessage["parts"]
  extractedThought: string | null
} {
  let extractedThought: string | null = null
  const cleanedParts = parts.map((part) => {
    if (part.type === "text" && part.text) {
      const match = /<thought>([\s\S]*?)<\/thought>/i.exec(part.text)
      if (match) {
        extractedThought = match[1].trim()
        const cleanedText = part.text
          .replace(/<thought>[\s\S]*?<\/thought>/gi, "")
          .trim()
        return { ...part, text: cleanedText }
      }
    }
    return part
  })
  return { cleanedParts, extractedThought }
}

function deduplicateDraftContentFromTextParts(
  parts: ChatUIMessage["parts"],
): ChatUIMessage["parts"] {
  const draftContents: string[] = []
  for (const part of parts) {
    if (part.type === "draft_artifact") {
      const c = (part as any).artifact?.content || (part as any).content
      if (typeof c === "string" && c.trim()) {
        draftContents.push(c.trim())
      }
    }
  }

  if (draftContents.length === 0) return parts

  return parts
    .map((part) => {
      if (part.type === "text" && part.text) {
        let cleaned = part.text
        for (const draftContent of draftContents) {
          if (!draftContent) continue
          if (cleaned.includes(draftContent)) {
            cleaned = cleaned.split(draftContent).join("").trim()
          } else {
            const unquoted = draftContent.replace(/^["']|["']$/g, "").trim()
            if (unquoted && cleaned.includes(unquoted)) {
              cleaned = cleaned.split(unquoted).join("").trim()
            }
          }
        }
        cleaned = cleaned
          .replace(
            /^(?:Here(?:'s| is) (?:a|the) (?:polished )?(?:X|LinkedIn|draft|post)[\w\s]*:?)/i,
            "",
          )
          .replace(/^(?:Saved as (?:a )?draft\.?)/i, "")
          .replace(/(?:Saved as (?:a )?draft\.?)$/i, "")
          .replace(/^["'\s]+|["'\s]+$/g, "")
          .trim()
        return { ...part, text: cleaned }
      }
      return part
    })
    .filter((part) => {
      if (part.type === "text") {
        return Boolean(part.text?.trim())
      }
      return true
    })
}

const EXCLUDED_PART_TYPES = new Set([
  "thought",
  "tool-call",
  "tool_call",
  "source-url",
])

function isOtherPart(
  p: ChatUIMessage["parts"][number],
  hasThoughtOrTools: boolean,
): boolean {
  if (EXCLUDED_PART_TYPES.has(p.type)) return false
  if (p.type === "tool-web_search" && hasThoughtOrTools) return false
  return true
}

function collectTools(parts: ChatUIMessage["parts"]): ToolCallItem[] {
  const toolCallParts = parts.filter(
    (p) => p.type === "tool-call" || p.type === "tool_call",
  ) as ToolCallPart[]

  return toolCallParts.map((tp, idx) => {
    return (
      tp.tool ?? {
        id: tp.toolCallId || `tool-${idx}`,
        name: tp.name || "tool",
        state: tp.state || "completed",
        input: tp.input,
        output: tp.output,
      }
    )
  })
}

function AssistantQueuedNotice({ status }: { status?: string }) {
  if (status !== "queued") return null
  return (
    <div className="flex items-center gap-2 px-3.5 py-2 rounded-2xl bg-muted/40 border border-border/50 text-xs text-muted-foreground animate-pulse select-none">
      <Clock className="size-3.5 text-muted-foreground/80 shrink-0" />
      <span>Queued &bull; Waiting for active generation to finish...</span>
    </div>
  )
}

function AssistantMessageActions({
  isStreaming,
  assistantText,
  createdAt,
}: {
  isStreaming: boolean
  assistantText: string
  createdAt?: string
}) {
  if (isStreaming || !assistantText) return null
  return (
    <ChatMessageActions
      textToCopy={assistantText}
      createdAt={createdAt}
      align="start"
      className="pl-2 pt-0.5"
    />
  )
}

function AssistantMessageBubble({
  message,
  isStreaming,
  onDraftTopic,
}: {
  message: ChatUIMessage
  isStreaming: boolean
  onDraftTopic?: (topicTitle: string) => void
}) {
  const { cleanedParts, extractedThought } = extractThoughtFromTextParts(
    message.parts,
  )
  const dedupedParts = deduplicateDraftContentFromTextParts(cleanedParts)

  const sources = dedupedParts.filter(
    (part): part is SourceUrlPart => part.type === "source-url",
  )

  const thoughtParts = dedupedParts.filter(
    (p): p is ThoughtPartType => p.type === "thought",
  )
  const combinedThought =
    thoughtParts
      .map((p) => p.content)
      .filter(Boolean)
      .join("\n\n") ||
    extractedThought ||
    ""

  const collectedTools = collectTools(cleanedParts)
  const webSearchPart = dedupedParts.find(
    (p): p is WebSearchToolPart => p.type === "tool-web_search",
  )

  const hasResponseStarted = dedupedParts.some(
    (p) => p.type === "text" && Boolean(p.text?.trim()),
  )

  const hasThoughtOrTools =
    Boolean(combinedThought) ||
    collectedTools.length > 0 ||
    (isStreaming && !hasResponseStarted)

  const assistantText = extractTextParts(dedupedParts)
  const createdAt = getMessageTimestamp(message)
  const otherParts = dedupedParts.filter((p) =>
    isOtherPart(p, hasThoughtOrTools),
  )

  return (
    <div className="group relative flex flex-col items-start w-full">
      <Message align="start">
        <MessageContent>
          <AssistantQueuedNotice status={message.status} />

          {hasThoughtOrTools && (
            <ThoughtPart
              content={combinedThought}
              toolCalls={collectedTools}
              webSearchPart={webSearchPart}
              sources={sources}
              isStreaming={isStreaming}
              hasResponseStarted={hasResponseStarted}
            />
          )}

          {otherParts.map((part, index) => (
            <AssistantPartRenderer
              key={index}
              part={part}
              index={index}
              isStreaming={isStreaming}
              hasResponseStarted={hasResponseStarted}
              sources={sources}
              onDraftTopic={onDraftTopic}
            />
          ))}
        </MessageContent>
      </Message>
      <AssistantMessageActions
        isStreaming={isStreaming}
        assistantText={assistantText}
        createdAt={createdAt}
      />
    </div>
  )
}

export function ChatMessage({
  message,
  isStreaming = false,
  onDraftTopic,
}: ChatMessageProps) {
  if (message.role === "user") {
    return <UserMessageBubble message={message} />
  }

  return (
    <AssistantMessageBubble
      message={message}
      isStreaming={isStreaming}
      onDraftTopic={onDraftTopic}
    />
  )
}
