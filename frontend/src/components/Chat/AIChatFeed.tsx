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
} from "@/components/ui/message-scroller"
import { findSiblingVersions } from "@/hooks/useTranscriptTree"

export interface AIChatFeedProps {
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

export function AIChatFeed({
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

  const lastAssistantIndex = findLastAssistantIndex(localMessages)
  const messagesToInspect = allMessages ?? localMessages

  return (
    <MessageScrollerProvider>
      <MessageScroller className="flex-1 min-h-0">
        <MessageScrollerViewport>
          <MessageScrollerContent className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6">
            {localMessages.map((message, index) => {
              const branchInfo = findSiblingVersions(
                messagesToInspect,
                message.id,
              )
              return (
                <MessageScrollerItem key={message.id} messageId={message.id}>
                  <ChatMessage
                    message={message}
                    isStreaming={
                      isStreaming && index === localMessages.length - 1
                    }
                    isLatestAssistant={
                      message.role === "assistant" &&
                      index === lastAssistantIndex
                    }
                    isEditing={editingMessageId === message.id}
                    branchInfo={branchInfo}
                    onSwitchBranch={(dir) => onSwitchBranch?.(message.id, dir)}
                    onDraftTopic={(title) =>
                      onSendMessage(`Draft an engaging post about: "${title}"`)
                    }
                    onStartEdit={onStartEdit}
                    onCancelEdit={onCancelEdit}
                    onSaveEdit={onSaveEdit}
                    onRegenerate={onRegenerate}
                    onRetry={onRetry}
                  />
                </MessageScrollerItem>
              )
            })}

            {pendingQuestion && (
              <QuestionCard
                part={pendingQuestion}
                onAnswer={onQuestionAnswer}
              />
            )}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  )
}
