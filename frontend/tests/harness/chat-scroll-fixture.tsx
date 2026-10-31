import { useState } from "react"
import { createRoot, type Root } from "react-dom/client"
import { AIChatFeed } from "@/components/Chat/AIChatFeed"
import { PromptForm } from "@/components/Chat/PromptForm"
import type { ChatUIMessage } from "@/components/Chat/types"

const EXPANDED_ANSWER = Array.from(
  { length: 16 },
  (_, index) =>
    `Streaming answer paragraph ${index + 1}: a useful detail that makes this response tall enough to exercise follow behavior.`,
).join("\n\n")
const ACTIVITY_PREVIEW = Array.from(
  { length: 12 },
  (_, index) =>
    `Visible page detail ${index + 1} with contextual text from the shared browser tab.`,
).join(" ")

function makeTranscript(threadId: string, answer: string): ChatUIMessage[] {
  const history: ChatUIMessage[] = Array.from(
    { length: 8 },
    (_, index): ChatUIMessage[] => [
      {
        id: `${threadId}-user-${index}`,
        role: "user",
        parts: [{ type: "text", text: `Question ${index + 1}` }],
      },
      {
        id: `${threadId}-assistant-${index}`,
        role: "assistant",
        parts: [{ type: "text", text: "A previous answer." }],
      },
    ],
  ).flat()

  return [
    ...history,
    {
      id: `${threadId}-latest-user`,
      role: "user",
      parts: [{ type: "text", text: "Summarize the page" }],
    },
    {
      id: `${threadId}-latest-answer`,
      role: "assistant",
      parts: [{ type: "text", text: answer }],
      browserActivity: {
        steps: [],
        tools: [
          {
            id: `${threadId}-read`,
            name: "read_shared_view",
            state: "completed",
            input: { view_index: 1, view_count: 1 },
            output: {
              note_preview: ACTIVITY_PREVIEW,
              preview_truncated: true,
            },
          },
        ],
        warning: null,
      },
    },
  ]
}

function ChatScrollFixture() {
  const [threadId, setThreadId] = useState("thread-1")
  const [answer, setAnswer] = useState("A short streaming answer.")
  const [isStreaming, setIsStreaming] = useState(true)
  const [isSharing, setIsSharing] = useState(true)
  const messages = makeTranscript(threadId, answer)

  return (
    <main className="fixed inset-0 mx-auto flex max-w-3xl flex-col overflow-hidden border border-border bg-background p-4">
      <div className="flex shrink-0 items-center gap-2 pb-3">
        <button type="button" onClick={() => setAnswer(EXPANDED_ANSWER)}>
          Grow answer
        </button>
        <button
          type="button"
          onClick={() =>
            setAnswer((current) => `${current}\n\n${EXPANDED_ANSWER}`)
          }
        >
          Append activity
        </button>
        <button type="button" onClick={() => setIsStreaming(false)}>
          Complete response
        </button>
        <button type="button" onClick={() => setThreadId("thread-2")}>
          Switch thread
        </button>
      </div>
      <AIChatFeed
        activeThreadId={threadId}
        localMessages={messages}
        isStreaming={isStreaming}
        pendingQuestion={null}
        onSendMessage={() => {}}
        onQuestionAnswer={() => {}}
      />
      <div className="shrink-0 px-4 pt-2">
        <PromptForm
          onSubmit={() => true}
          isBusy={isStreaming}
          observationSlot={{
            view: {
              isConnected: isSharing,
              hasCurrentFrame: true,
              status: "Browser tab shared",
            },
            videoRef: () => {},
            onStart: () => setIsSharing(true),
            onStop: () => setIsSharing(false),
            onReset: () => {},
          }}
        />
      </div>
    </main>
  )
}

export function mountChatScrollFixture(container: HTMLElement) {
  const root: Root = createRoot(container)
  root.render(<ChatScrollFixture />)
  return () => root.unmount()
}
