import type { KeyboardEvent, UIEvent, WheelEvent } from "react"
import { useRef } from "react"
import { ChatMessage } from "@/components/Chat/ChatMessage"
import { QuestionCard } from "@/components/Chat/QuestionCard"
import { Suggestions } from "@/components/Chat/Suggestions"
import type {
  AskUserAnswer,
  AskUserToolPart,
  ChatUIMessage,
} from "@/components/Chat/types"
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScroller,
} from "@/components/ui/message-scroller"
import { findSiblingVersions } from "@/hooks/useTranscriptTree"

export interface AIChatFeedProps {
  activeThreadId?: string | null
  localMessages: ChatUIMessage[]
  allMessages?: ChatUIMessage[]
  isStreaming: boolean
  pendingQuestion: AskUserToolPart | null
  onSendMessage: (text: string) => void
  onQuestionAnswer: (toolCallId: string, answers: AskUserAnswer[]) => void
  editingMessageId?: string | null
  onStartEdit?: (messageId: string) => void
  onCancelEdit?: () => void
  onSaveEdit?: (messageId: string, newText: string) => void
  onRegenerate?: (assistantMsgId: string) => void
  onRetry?: (assistantMsgId: string) => void
  onSwitchBranch?: (messageId: string, direction: "prev" | "next") => void
}

function EmptyChatSuggestions({
  onSendMessage,
}: {
  onSendMessage: (text: string) => void
}) {
  return (
    <div className="flex flex-1 min-h-0 items-center justify-center p-6 text-center">
      <div className="flex flex-col items-center">
        <h2 className="text-xl font-bold tracking-tight text-foreground">
          What would you like to create?
        </h2>
        <p className="text-xs text-muted-foreground mt-1.5 max-w-sm leading-relaxed">
          Brainstorm viral ideas, analyze trends, or draft posts with LinkX AI.
        </p>
        <div className="mt-6 w-full max-w-lg">
          <Suggestions onSelect={onSendMessage} />
        </div>
      </div>
    </div>
  )
}

function findLastAssistantIndex(messages: ChatUIMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "assistant") return i
  }
  return -1
}

function ConversationMessages({ feed }: { feed: AIChatFeedProps }) {
  const lastAssistantIndex = findLastAssistantIndex(feed.localMessages)
  const messagesToInspect = feed.allMessages ?? feed.localMessages
  return (
    <MessageScrollerContent className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6">
      {feed.localMessages.map((message, index) => {
        const branchInfo = findSiblingVersions(messagesToInspect, message.id)
        return (
          <MessageScrollerItem key={message.id} messageId={message.id}>
            <ChatMessage
              message={message}
              isStreaming={
                feed.isStreaming && index === feed.localMessages.length - 1
              }
              isChatStreaming={feed.isStreaming}
              isLatestAssistant={
                message.role === "assistant" && index === lastAssistantIndex
              }
              isEditing={feed.editingMessageId === message.id}
              branchInfo={branchInfo}
              onSwitchBranch={(dir) => feed.onSwitchBranch?.(message.id, dir)}
              onDraftTopic={(title) =>
                feed.onSendMessage(`Draft an engaging post about: "${title}"`)
              }
              onStartEdit={feed.onStartEdit}
              onCancelEdit={feed.onCancelEdit}
              onSaveEdit={feed.onSaveEdit}
              onRegenerate={feed.onRegenerate}
              onRetry={feed.onRetry}
            />
          </MessageScrollerItem>
        )
      })}
      {feed.pendingQuestion && (
        <QuestionCard
          part={feed.pendingQuestion}
          onAnswer={feed.onQuestionAnswer}
        />
      )}
    </MessageScrollerContent>
  )
}

function ConversationViewport({ feed }: { feed: AIChatFeedProps }) {
  const { scrollToEnd } = useMessageScroller()
  const previousScrollTop = useRef(0)

  function handleViewportScroll(event: UIEvent<HTMLDivElement>) {
    const viewport = event.currentTarget
    const scrollingUp = viewport.scrollTop < previousScrollTop.current
    previousScrollTop.current = viewport.scrollTop
    if (!scrollingUp && isNearEnd(viewport)) {
      scrollToEnd({ behavior: "auto" })
    }
  }

  function handleViewportWheel(event: WheelEvent<HTMLDivElement>) {
    if (event.deltaY > 0 && isNearEnd(event.currentTarget)) {
      scrollToEnd({ behavior: "auto" })
    }
  }

  function handleViewportKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const scrollsTowardEnd =
      ["ArrowDown", "PageDown", "End"].includes(event.key) ||
      (event.key === " " && !event.shiftKey)
    if (scrollsTowardEnd && isNearEnd(event.currentTarget)) {
      scrollToEnd({ behavior: "auto" })
    }
  }

  function isNearEnd(viewport: HTMLDivElement) {
    const distanceFromEnd =
      viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop
    return distanceFromEnd <= 8
  }

  return (
    <MessageScrollerViewport
      onScroll={handleViewportScroll}
      onWheel={handleViewportWheel}
      onKeyDown={handleViewportKeyDown}
    >
      <ConversationMessages feed={feed} />
    </MessageScrollerViewport>
  )
}

export function AIChatFeed({
  activeThreadId,
  localMessages,
  allMessages,
  isStreaming,
  pendingQuestion,
  onSendMessage,
  onQuestionAnswer,
  editingMessageId,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onRegenerate,
  onRetry,
  onSwitchBranch,
}: AIChatFeedProps) {
  if (localMessages.length === 0) {
    return <EmptyChatSuggestions onSendMessage={onSendMessage} />
  }

  const feed = {
    localMessages,
    allMessages,
    isStreaming,
    pendingQuestion,
    onSendMessage,
    onQuestionAnswer,
    editingMessageId,
    onStartEdit,
    onCancelEdit,
    onSaveEdit,
    onRegenerate,
    onRetry,
    onSwitchBranch,
  }

  return (
    <MessageScrollerProvider key={activeThreadId ?? "new-chat"} autoScroll>
      <MessageScroller className="flex-1 min-h-0">
        <ConversationViewport feed={feed} />
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  )
}
