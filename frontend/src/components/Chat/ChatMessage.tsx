import { Clock, RotateCw } from "lucide-react"
import { BranchSwitcher } from "@/components/Chat/BranchSwitcher"
import { ChatMessageActions } from "@/components/Chat/ChatMessageActions"
import {
  extractImageUrls,
  extractTextParts,
  getMessageTimestamp,
  isValidImageUrl,
  prepareAssistantRenderState,
} from "@/components/Chat/chatMessageUtils"
import { DraftArtifactCard } from "@/components/Chat/DraftArtifactCard"
import { BrowserActivityPart } from "@/components/Chat/parts/BrowserActivityPart"
import { TextPart } from "@/components/Chat/parts/TextPart"
import { ThoughtPart } from "@/components/Chat/parts/ThoughtPart"
import { WebSearchPart } from "@/components/Chat/parts/WebSearchPart"
import { ToolCallAccordion } from "@/components/Chat/ToolCallAccordion"
import { TrendingArtifactCard } from "@/components/Chat/TrendingArtifactCard"
import type {
  BranchVersionInfo,
  ChatUIMessage,
  SourceUrlPart,
  ToolCallItem,
  ToolCallPart,
} from "@/components/Chat/types"
import { UserMessageEditForm } from "@/components/Chat/UserMessageEditForm"
import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { Message, MessageContent } from "@/components/ui/message"

export { extractImageUrls, extractTextParts, isValidImageUrl }

export interface ChatMessageProps {
  message: ChatUIMessage
  isStreaming?: boolean
  isChatStreaming?: boolean
  isLatestAssistant?: boolean
  isEditing?: boolean
  branchInfo?: BranchVersionInfo
  onSwitchBranch?: (direction: "prev" | "next") => void
  onDraftTopic?: (topicTitle: string) => void
  onStartEdit?: (messageId: string) => void
  onCancelEdit?: () => void
  onSaveEdit?: (messageId: string, newText: string) => void
  onRegenerate?: (assistantMsgId: string) => void
  onRetry?: (assistantMsgId: string) => void
}

function UserAttachmentList({ imageUrls }: { imageUrls: string[] }) {
  if (imageUrls.length === 0) return null
  return (
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
  )
}

function UserTextBubble({ text }: { text: string }) {
  if (!text) return null
  return (
    <Bubble align="end" variant="outline">
      <BubbleContent className="rounded-3xl border border-border bg-background text-foreground font-normal px-5 py-3 leading-relaxed shadow-none">
        {text}
      </BubbleContent>
    </Bubble>
  )
}

function MessageBranchControl({
  branchInfo,
  onSwitchBranch,
  disabled,
}: {
  branchInfo?: BranchVersionInfo
  onSwitchBranch?: (direction: "prev" | "next") => void
  disabled: boolean
}) {
  if (!branchInfo || branchInfo.totalVersions <= 1) return null
  return (
    <BranchSwitcher
      currentIndex={branchInfo.currentIndex}
      totalVersions={branchInfo.totalVersions}
      onPrevious={() => onSwitchBranch?.("prev")}
      onNext={() => onSwitchBranch?.("next")}
      disabled={disabled}
    />
  )
}

function UserMessageFooter({
  branchInfo,
  onSwitchBranch,
  text,
  createdAt,
  onStartEdit,
  messageId,
  isStreaming = false,
}: {
  branchInfo?: BranchVersionInfo
  onSwitchBranch?: (direction: "prev" | "next") => void
  text: string
  createdAt?: string
  onStartEdit?: (id: string) => void
  messageId: string
  isStreaming?: boolean
}) {
  const onEdit =
    !isStreaming && onStartEdit ? () => onStartEdit(messageId) : undefined

  return (
    <div className="flex items-center justify-end gap-1.5 pr-2 pt-0.5">
      <ChatMessageActions
        textToCopy={text}
        createdAt={createdAt}
        align="end"
        isStreaming={isStreaming}
        onEdit={onEdit}
      />
      <MessageBranchControl
        branchInfo={branchInfo}
        onSwitchBranch={onSwitchBranch}
        disabled={isStreaming}
      />
    </div>
  )
}

function UserMessageBubble({
  message,
  isEditing = false,
  branchInfo,
  onSwitchBranch,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  isStreaming = false,
}: {
  message: ChatUIMessage
  isEditing?: boolean
  branchInfo?: BranchVersionInfo
  onSwitchBranch?: (direction: "prev" | "next") => void
  onStartEdit?: (id: string) => void
  onCancelEdit?: () => void
  onSaveEdit?: (id: string, newText: string) => void
  isStreaming?: boolean
}) {
  const text = extractTextParts(message.parts)
  const imageUrls = extractImageUrls(message.parts)
  const createdAt = getMessageTimestamp(message)

  const isEditActive = Boolean(isEditing && !isStreaming)
  if (isEditActive && onSaveEdit) {
    return (
      <div className="group relative flex flex-col items-end w-full">
        <UserMessageEditForm
          initialText={text}
          onSave={(newText) => onSaveEdit(message.id, newText)}
          onCancel={onCancelEdit ?? (() => {})}
        />
      </div>
    )
  }

  return (
    <div className="group relative flex flex-col items-end w-full">
      <Message align="end">
        <MessageContent>
          <div className="flex flex-col items-end gap-2 max-w-full">
            <UserAttachmentList imageUrls={imageUrls} />
            <UserTextBubble text={text} />
          </div>
        </MessageContent>
      </Message>
      <UserMessageFooter
        branchInfo={branchInfo}
        onSwitchBranch={onSwitchBranch}
        text={text}
        createdAt={createdAt}
        onStartEdit={onStartEdit}
        messageId={message.id}
        isStreaming={isStreaming}
      />
    </div>
  )
}

interface RenderToolOrDraftOptions {
  part: ChatUIMessage["parts"][number]
  index: number
  sources: SourceUrlPart[]
  onDraftTopic?: (topicTitle: string) => void
}

function getToolCallItem(part: ToolCallPart, index: number): ToolCallItem {
  if (part.tool) return part.tool
  return {
    id: part.toolCallId || `tool-${index}`,
    name: part.name || "tool",
    state: part.state || "completed",
    input: part.input,
    output: part.output,
  }
}

function renderToolCallPart(part: ToolCallPart, index: number) {
  const toolItem = getToolCallItem(part, index)
  return (
    <ToolCallAccordion
      key={toolItem.id || `tool-${index}`}
      toolCalls={[toolItem]}
    />
  )
}

function renderDraftArtifactPart(
  part: ChatUIMessage["parts"][number] & { type: "draft_artifact" },
  index: number,
) {
  return (
    <DraftArtifactCard
      key={part.artifact.id || `draft-${index}`}
      artifact={part.artifact}
    />
  )
}

function renderToolOrDraftPart({
  part,
  index,
  sources,
  onDraftTopic,
}: RenderToolOrDraftOptions) {
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
    return renderToolCallPart(part as ToolCallPart, index)
  }
  if (part.type === "draft_artifact") {
    return renderDraftArtifactPart(part, index)
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
  return renderToolOrDraftPart({
    part,
    index,
    sources,
    onDraftTopic,
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

function AssistantRetryButton({ onRetry }: { onRetry?: () => void }) {
  if (!onRetry) return null
  return (
    <div className="flex items-center gap-2 pt-1.5">
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-lg bg-destructive/10 text-destructive hover:bg-destructive/20 border border-destructive/25 transition-colors cursor-pointer"
      >
        <RotateCw className="size-3" />
        <span>Retry generation</span>
      </button>
    </div>
  )
}

function AssistantMessageActions({
  isStreaming,
  isChatStreaming = false,
  assistantText,
  createdAt,
  branchInfo,
  onSwitchBranch,
}: {
  isStreaming: boolean
  isChatStreaming?: boolean
  assistantText: string
  createdAt?: string
  branchInfo?: BranchVersionInfo
  onSwitchBranch?: (direction: "prev" | "next") => void
}) {
  const isGenerating = Boolean(isStreaming || isChatStreaming)
  const hasBranch = Boolean(branchInfo && branchInfo.totalVersions > 1)
  const canShowActions = !isGenerating && Boolean(assistantText)
  if (!hasBranch && !canShowActions) return null

  return (
    <div className="flex items-center gap-1.5 pl-2 pt-0.5">
      {canShowActions && (
        <ChatMessageActions
          textToCopy={assistantText}
          createdAt={createdAt}
          align="start"
          isStreaming={isGenerating}
        />
      )}
      <MessageBranchControl
        branchInfo={branchInfo}
        onSwitchBranch={onSwitchBranch}
        disabled={isGenerating}
      />
    </div>
  )
}

function canDisplayAssistantBubble(
  isStreaming: boolean,
  hasVisibleContent: boolean,
): boolean {
  return isStreaming || hasVisibleContent
}

function shouldRenderAssistantThought(
  state: ReturnType<typeof prepareAssistantRenderState>,
  browserActivity: ChatUIMessage["browserActivity"],
): boolean {
  if (!state.hasThoughtOrTools) return false
  if (!browserActivity) return true
  return Boolean(
    state.combinedThought ||
      state.collectedTools.length > 0 ||
      state.webSearchPart,
  )
}

function AssistantMessageBubble({
  message,
  isStreaming,
  isChatStreaming = false,
  branchInfo,
  onSwitchBranch,
  onDraftTopic,
  onRetry,
}: {
  message: ChatUIMessage
  isStreaming: boolean
  isChatStreaming?: boolean
  branchInfo?: BranchVersionInfo
  onSwitchBranch?: (direction: "prev" | "next") => void
  onDraftTopic?: (topicTitle: string) => void
  onRetry?: () => void
}) {
  const state = prepareAssistantRenderState(message, isStreaming)
  if (!canDisplayAssistantBubble(isStreaming, state.hasVisibleContent)) {
    return null
  }
  const showThought = shouldRenderAssistantThought(
    state,
    message.browserActivity,
  )

  return (
    <div className="group relative flex flex-col items-start w-full">
      <Message align="start">
        <MessageContent>
          <AssistantQueuedNotice status={message.status} />

          {message.browserActivity && (
            <BrowserActivityPart
              activity={message.browserActivity}
              isStreaming={isStreaming}
            />
          )}

          {showThought && (
            <ThoughtPart
              content={state.combinedThought}
              toolCalls={state.collectedTools}
              webSearchPart={state.webSearchPart}
              sources={state.sources}
              isStreaming={isStreaming && !message.browserActivity}
              hasResponseStarted={state.hasResponseStarted}
            />
          )}

          {state.otherParts.map((part, index) => (
            <AssistantPartRenderer
              key={index}
              part={part}
              index={index}
              isStreaming={isStreaming}
              hasResponseStarted={state.hasResponseStarted}
              sources={state.sources}
              onDraftTopic={onDraftTopic}
            />
          ))}

          {message.status === "error" && (
            <AssistantRetryButton onRetry={onRetry} />
          )}
        </MessageContent>
      </Message>
      <AssistantMessageActions
        isStreaming={isStreaming}
        isChatStreaming={isChatStreaming}
        assistantText={state.assistantText}
        createdAt={state.createdAt}
        branchInfo={branchInfo}
        onSwitchBranch={onSwitchBranch}
      />
    </div>
  )
}

export function ChatMessage({
  message,
  isStreaming = false,
  isChatStreaming,
  isEditing = false,
  branchInfo,
  onSwitchBranch,
  onDraftTopic,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onRetry,
}: ChatMessageProps) {
  const isGenerating = Boolean(isChatStreaming || isStreaming)

  if (message.role === "user") {
    return (
      <UserMessageBubble
        message={message}
        isEditing={isEditing}
        branchInfo={branchInfo}
        onSwitchBranch={onSwitchBranch}
        onStartEdit={onStartEdit}
        onCancelEdit={onCancelEdit}
        onSaveEdit={onSaveEdit}
        isStreaming={isGenerating}
      />
    )
  }

  return (
    <AssistantMessageBubble
      message={message}
      isStreaming={isStreaming}
      isChatStreaming={isGenerating}
      branchInfo={branchInfo}
      onSwitchBranch={onSwitchBranch}
      onDraftTopic={onDraftTopic}
      onRetry={onRetry ? () => onRetry(message.id) : undefined}
    />
  )
}
