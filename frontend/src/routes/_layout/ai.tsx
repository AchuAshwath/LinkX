import { createFileRoute } from "@tanstack/react-router"
import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  MoreHorizontal,
  Pencil,
  SquarePen,
  Trash2,
} from "lucide-react"
import * as React from "react"
import { ChatMessage } from "@/components/Chat/ChatMessage"
import { PromptForm } from "@/components/Chat/PromptForm"
import { QuestionCard } from "@/components/Chat/QuestionCard"
import { Suggestions } from "@/components/Chat/Suggestions"
import type {
  AskUserAnswer,
  AskUserToolPart,
  ChatUIMessage,
} from "@/components/Chat/types"
import { Button } from "@/components/ui/button"
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller"
import { cn } from "@/lib/utils"

export interface ChatThread {
  id: string
  title: string
  dateGroup: string
  category: "recent" | "archived"
  messages: ChatUIMessage[]
  pendingQuestion?: AskUserToolPart | null
}

const INITIAL_THREADS: ChatThread[] = [
  {
    id: "thread-1",
    title: "Rich Markdown & Typography",
    dateGroup: "Today",
    category: "recent",
    messages: [
      {
        id: "m-101",
        role: "user",
        parts: [
          {
            type: "text",
            text: "Showcase all rich markdown capabilities from the chatbot template: headings, formatted lists, blockquotes, code blocks with syntax highlighting, and a comparison table.",
          },
        ],
      },
      {
        id: "m-102",
        role: "assistant",
        parts: [
          {
            type: "text",
            text: `## 🚀 Launching Next-Gen Social Growth with LinkX

> *"The future of developer social presence isn't spamming; it's high-signal, self-healing agent pipelines."*

Here is how LinkX compares to traditional single-channel tools:

| Feature | Traditional Tools | LinkX AI Copilot |
| :--- | :--- | :--- |
| **Drafting Engine** | Static templates | Autonomous LangGraph agents |
| **Agent Telemetry** | Black box | Live subgraph execution |
| **Multi-Channel** | Manual copy-paste | Synchronized X & LinkedIn adaptation |
| **Safety Guardrails** | None | Human-in-the-loop validation |

### 🛠️ Example Integration Code

Here is how you can stream real-time tokens using our local FastAPI endpoint:

\`\`\`typescript
export async function streamChatThread(threadId: string, prompt: string) {
  const response = await fetch(\`/api/v1/ai/threads/\${threadId}/chat\`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  })

  const reader = response.body?.getReader()
  console.log("Streaming tokens from local LangGraph engine...")
  return reader
}
\`\`\`

### 💡 Key Takeaways:
1. **Zero Vendor Lock-in**: Run locally with \`uv run fastapi dev\` and Postgres in Docker.
2. **Deterministic UI**: Built with pure shadcn/ui primitives and theme tokens.
3. **Conversational Iteration**: Refine drafts dynamically within thread history.`,
          },
        ],
      },
    ],
  },
  {
    id: "thread-2",
    title: "Web Search & Citations",
    dateGroup: "Today",
    category: "recent",
    messages: [
      {
        id: "m-201",
        role: "user",
        parts: [
          {
            type: "text",
            text: "Search the web for the latest open-source AI agent framework developments in 2026 and give me key source citations.",
          },
        ],
      },
      {
        id: "m-202",
        role: "assistant",
        parts: [
          {
            type: "tool-web_search",
            toolCallId: "ws-1",
            state: "output-available",
            input: { query: "trending open source AI agent frameworks 2026" },
          },
          {
            type: "text",
            text: `### 🌐 Research Summary: AI Agent Frameworks (2026)

Based on live developer sentiment and repository analytics:

1. **Stateful Graph Architectures**: Frameworks like LangGraph and AutoGen are dominant for cyclic multi-step reasoning with checkpointing.
2. **Deterministic Tool Use**: Teams are moving away from monolithic agent prompts in favor of strict typed tool calling (Pydantic / Zod).
3. **On-Device & Local Weights**: Growing shift toward local LiteLLM proxies and Ollama for cost efficiency and privacy.`,
          },
          {
            type: "source-url",
            sourceId: "src-1",
            url: "https://github.com/langchain-ai/langgraph",
            title: "LangGraph - Multi-Agent Stateful Orchestration",
          },
          {
            type: "source-url",
            sourceId: "src-2",
            url: "https://news.ycombinator.com/item?id=41289",
            title: "Hacker News - The Shift to On-Device Agent Workflows",
          },
          {
            type: "source-url",
            sourceId: "src-3",
            url: "https://arxiv.org/abs/2602.09114",
            title: "ArXiv - Self-Healing AI Execution Graphs",
          },
        ],
      },
    ],
  },
  {
    id: "thread-3",
    title: "Interactive Questionnaire (HITL)",
    dateGroup: "Mar 5, 2026",
    category: "archived",
    messages: [
      {
        id: "m-301",
        role: "user",
        parts: [
          {
            type: "text",
            text: "Help me craft a 30-day founder growth strategy. Ask me clarifying questions first before generating the calendar.",
          },
        ],
      },
      {
        id: "m-302",
        role: "assistant",
        parts: [
          {
            type: "text",
            text: "I'd love to tailor your 30-day content calendar. Before I assemble the schedule, please select your primary focus and tone preferences below:",
          },
        ],
      },
    ],
    pendingQuestion: {
      type: "tool-ask_user",
      toolCallId: "q-growth-strategy",
      state: "input-available",
      input: {
        questions: [
          {
            question:
              "What is your primary growth objective for the next 30 days?",
            choices: [
              "Brand Awareness & Founder Audience",
              "B2B Leads & Product Signups",
              "Developer Community & Open Source Stars",
            ],
          },
          {
            question: "Which content style resonates best with your audience?",
            choices: [
              "Deep Technical Teardowns & Architecture",
              "Build-in-Public Metrics & Lessons Learned",
              "Contrarian Takes & Industry Insights",
            ],
          },
        ],
      },
    },
  },
  {
    id: "thread-4",
    title: "Conversational Post Refinement",
    dateGroup: "Feb 11, 2026",
    category: "archived",
    messages: [
      {
        id: "m-401",
        role: "user",
        parts: [
          {
            type: "text",
            text: "Write a short hook about why writing code for humans is harder than writing code for computers.",
          },
        ],
      },
      {
        id: "m-402",
        role: "assistant",
        parts: [
          {
            type: "text",
            text: "Here is a starter hook:\n\n*99% of developers write code for compilers. The top 1% write code for future humans who have to maintain it.*",
          },
        ],
      },
      {
        id: "m-403",
        role: "user",
        parts: [
          {
            type: "text",
            text: "Make it punchier, format it for X with high engagement, and add a provocative closing question.",
          },
        ],
      },
      {
        id: "m-404",
        role: "assistant",
        parts: [
          {
            type: "text",
            text: `**Most developers write code to execute.\nElite engineers write code to communicate.**

Compilers don't care about clean architecture.
Your future teammate at 2 AM debugging an outage does.

Are you building for machines or humans? Drop your take below 👇 #CleanCode #SoftwareEngineering`,
          },
        ],
      },
    ],
  },
]

export const Route = createFileRoute("/_layout/ai")({
  component: AIPage,
  head: () => ({
    meta: [
      {
        title: "Chat - LinkX",
      },
    ],
  }),
})

function AIPage() {
  const [threads, setThreads] = React.useState<ChatThread[]>(INITIAL_THREADS)
  const [activeThreadId, setActiveThreadId] = React.useState<string>("thread-1")
  const [isBusy, setIsBusy] = React.useState(false)
  const [editingThreadId, setEditingThreadId] = React.useState<string | null>(
    null,
  )
  const [editTitleInput, setEditTitleInput] = React.useState("")
  const [openMenuThreadId, setOpenMenuThreadId] = React.useState<string | null>(
    null,
  )
  const [recentsOpen, setRecentsOpen] = React.useState(true)
  const [archivedOpen, setArchivedOpen] = React.useState(true)

  const activeThread =
    threads.find((t) => t.id === activeThreadId) || threads[0]

  // Close kebab menu when clicking outside
  React.useEffect(() => {
    const handleDocumentClick = () => {
      setOpenMenuThreadId(null)
    }
    if (openMenuThreadId) {
      document.addEventListener("click", handleDocumentClick)
    }
    return () => {
      document.removeEventListener("click", handleDocumentClick)
    }
  }, [openMenuThreadId])

  const handleNewChat = () => {
    const newThreadId = `thread-${Date.now()}`
    const newThread: ChatThread = {
      id: newThreadId,
      title: "New Chat",
      dateGroup: "Today",
      category: "recent",
      messages: [],
    }
    setThreads((prev) => [newThread, ...prev])
    setActiveThreadId(newThreadId)
    setRecentsOpen(true)
  }

  const handleSendMessage = (text: string) => {
    if (!text.trim()) return

    const userMessage: ChatUIMessage = {
      id: `usr-${Date.now()}`,
      role: "user",
      parts: [{ type: "text", text }],
    }

    setIsBusy(true)

    setThreads((prev) =>
      prev.map((t) => {
        if (t.id === activeThreadId) {
          const isFirstMessage = t.messages.length === 0
          return {
            ...t,
            title: isFirstMessage
              ? text.slice(0, 32) + (text.length > 32 ? "…" : "")
              : t.title,
            messages: [...t.messages, userMessage],
          }
        }
        return t
      }),
    )

    setTimeout(() => {
      const assistantMessage: ChatUIMessage = {
        id: `asst-${Date.now()}`,
        role: "assistant",
        parts: [
          {
            type: "text",
            text: `I've received your request: "${text}".\n\nOnce connected to the backend SSE endpoint (Issue #107), this will stream real-time responses directly from your local LangGraph models.`,
          },
        ],
      }

      setThreads((prev) =>
        prev.map((t) =>
          t.id === activeThreadId
            ? {
                ...t,
                messages: [...t.messages, assistantMessage],
              }
            : t,
        ),
      )
      setIsBusy(false)
    }, 800)
  }

  const handleStop = () => {
    setIsBusy(false)
  }

  const handleQuestionAnswer = (
    _toolCallId: string,
    answers: AskUserAnswer[],
  ) => {
    const formattedAnswers = answers
      .filter((a) => a.answer.trim().length > 0)
      .map((a) => `• **${a.question}**\n  👉 ${a.answer}`)
      .join("\n\n")

    const userReply: ChatUIMessage = {
      id: `ans-${Date.now()}`,
      role: "user",
      parts: [
        {
          type: "text",
          text: `Here are my preferences:\n\n${formattedAnswers}`,
        },
      ],
    }

    const assistantFollowUp: ChatUIMessage = {
      id: `followup-${Date.now()}`,
      role: "assistant",
      parts: [
        {
          type: "text",
          text: `Great choices! Based on your selections, here is your customized **30-Day Content Framework**:\n\n- **Week 1-2**: High-signal founder insights and technical architectural choices.\n- **Week 3**: Interactive poll and build-in-public metrics.\n- **Week 4**: Case study teardown and community call to action.\n\nWould you like me to draft individual posts for Week 1?`,
        },
      ],
    }

    setThreads((prev) =>
      prev.map((t) =>
        t.id === activeThreadId
          ? {
              ...t,
              pendingQuestion: null,
              messages: [...t.messages, userReply, assistantFollowUp],
            }
          : t,
      ),
    )
  }

  const handleRenameThread = (id: string, newTitle: string) => {
    const trimmed = newTitle.trim()
    if (trimmed) {
      setThreads((prev) =>
        prev.map((t) => (t.id === id ? { ...t, title: trimmed } : t)),
      )
    }
    setEditingThreadId(null)
  }

  const handleToggleArchive = (id: string) => {
    setOpenMenuThreadId(null)
    setThreads((prev) =>
      prev.map((t) => {
        if (t.id === id) {
          const nextCategory = t.category === "recent" ? "archived" : "recent"
          return { ...t, category: nextCategory }
        }
        return t
      }),
    )
  }

  const handleDeleteThread = (id: string) => {
    setOpenMenuThreadId(null)
    setThreads((prev) => {
      const filtered = prev.filter((t) => t.id !== id)
      if (activeThreadId === id) {
        if (filtered.length > 0) {
          setActiveThreadId(filtered[0].id)
        } else {
          const newThreadId = `thread-${Date.now()}`
          const newThread: ChatThread = {
            id: newThreadId,
            title: "New Chat",
            dateGroup: "Today",
            category: "recent",
            messages: [],
          }
          setActiveThreadId(newThreadId)
          return [newThread]
        }
      }
      return filtered
    })
  }

  const handleSelectThread = (id: string) => {
    setOpenMenuThreadId(null)
    setEditingThreadId(null)
    setActiveThreadId(id)
  }

  const recentThreads = threads.filter((t) => t.category === "recent")
  const archivedThreads = threads.filter((t) => t.category === "archived")

  const messages = activeThread?.messages || []

  const renderThreadItem = (thread: ChatThread) => {
    const isActive = thread.id === activeThreadId
    const isEditing = editingThreadId === thread.id
    const isMenuOpen = openMenuThreadId === thread.id
    const isArchived = thread.category === "archived"

    return (
      <div
        key={thread.id}
        className={cn(
          "group relative flex items-center justify-between rounded-full transition-colors",
          isArchived
            ? "px-3 py-1.5 text-xs text-muted-foreground"
            : "px-3.5 py-2 text-xs text-foreground",
          isActive
            ? isArchived
              ? "bg-muted/30 text-foreground/80 font-normal"
              : "bg-muted/50 text-foreground font-medium"
            : isArchived
              ? "text-muted-foreground/70 hover:bg-muted/20 hover:text-muted-foreground"
              : "text-muted-foreground hover:bg-muted/30 hover:text-foreground",
        )}
      >
        {isEditing ? (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              handleRenameThread(thread.id, editTitleInput)
            }}
            className="flex-1 mr-1"
          >
            <input
              type="text"
              value={editTitleInput}
              onChange={(e) => setEditTitleInput(e.target.value)}
              onBlur={() => handleRenameThread(thread.id, editTitleInput)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setEditingThreadId(null)
              }}
              className="w-full bg-background border border-input rounded-full px-3 py-0.5 text-xs text-foreground outline-none focus:ring-1 focus:ring-ring"
            />
          </form>
        ) : (
          <button
            type="button"
            onClick={() => handleSelectThread(thread.id)}
            className="flex flex-1 items-center truncate text-left cursor-pointer min-w-0 pr-2 focus:outline-none py-1 select-none"
          >
            <span
              className={cn(
                "truncate w-full",
                isArchived
                  ? "text-xs text-muted-foreground font-normal group-hover:text-foreground"
                  : "text-xs text-foreground font-medium",
              )}
            >
              {thread.title}
            </span>
          </button>
        )}

        {/* Action Icons */}
        <div className="flex items-center gap-0.5 shrink-0">
          {/* Recent items show Archive button; Archived items show direct Delete button */}
          {isArchived ? (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Delete thread"
              className="size-6 opacity-0 group-hover:opacity-100 hover:bg-destructive/10 rounded-full shrink-0 transition-opacity text-muted-foreground hover:text-destructive cursor-pointer"
              onClick={(e) => {
                e.stopPropagation()
                handleDeleteThread(thread.id)
              }}
            >
              <Trash2 className="size-3" />
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Archive thread"
              className="size-6 opacity-0 group-hover:opacity-100 hover:bg-muted/60 rounded-full shrink-0 transition-opacity text-muted-foreground hover:text-foreground cursor-pointer"
              onClick={(e) => {
                e.stopPropagation()
                handleToggleArchive(thread.id)
              }}
            >
              <Archive className="size-3" />
            </Button>
          )}

          <div className="relative">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Thread options"
              className={cn(
                "size-6 hover:bg-muted/60 rounded-full shrink-0 transition-opacity cursor-pointer text-muted-foreground hover:text-foreground",
                isMenuOpen
                  ? "opacity-100 bg-muted/60 text-foreground"
                  : "opacity-0 group-hover:opacity-100",
              )}
              onClick={(e) => {
                e.stopPropagation()
                setOpenMenuThreadId((prev) =>
                  prev === thread.id ? null : thread.id,
                )
              }}
            >
              <MoreHorizontal className="size-3" />
            </Button>

            {isMenuOpen && (
              <div
                role="menu"
                tabIndex={-1}
                className="absolute right-0 top-7 z-50 min-w-28 rounded-2xl border border-border bg-popover p-1 shadow-md animate-in fade-in-0 zoom-in-95"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleToggleArchive(thread.id)
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-popover-foreground hover:bg-accent hover:text-accent-foreground cursor-pointer font-medium"
                >
                  {isArchived ? (
                    <>
                      <ArchiveRestore className="size-3.5" />
                      <span>Unarchive</span>
                    </>
                  ) : (
                    <>
                      <Archive className="size-3.5" />
                      <span>Archive</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={(e) => {
                    e.stopPropagation()
                    setOpenMenuThreadId(null)
                    setEditingThreadId(thread.id)
                    setEditTitleInput(thread.title)
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-popover-foreground hover:bg-accent hover:text-accent-foreground cursor-pointer font-medium"
                >
                  <Pencil className="size-3.5" />
                  <span>Rename</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDeleteThread(thread.id)
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-destructive hover:bg-destructive/10 cursor-pointer font-medium"
                >
                  <Trash2 className="size-3.5" />
                  <span>Delete</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex w-full min-h-[calc(100vh-3.5rem)] lg:min-h-screen bg-background text-foreground">
      {/* 1. Center Column: Active Chat Feed */}
      <div className="relative mx-auto flex min-h-0 w-full flex-1 max-w-2xl border-r-0 md:border-r border-border flex-col h-[calc(100vh-3.5rem)] lg:h-screen overflow-hidden">
        {/* Clean Top Header */}
        <div className="sticky top-0 z-10 border-b border-border bg-background/80 backdrop-blur-md px-4 py-3 flex items-center justify-between">
          <h1 className="font-bold text-lg text-foreground tracking-tight truncate">
            {activeThread ? activeThread.title : "Chat"}
          </h1>

          <Button
            size="sm"
            onClick={handleNewChat}
            className="md:hidden text-xs rounded-full h-8 px-3 font-semibold shadow-sm"
          >
            New Chat
          </Button>
        </div>

        {/* Message Feed / Empty State */}
        <div className="relative flex-1 min-h-0">
          {messages.length === 0 ? (
            <div className="flex h-full items-center justify-center p-6 text-center pb-32">
              <div className="flex flex-col items-center">
                <h2 className="text-xl font-bold tracking-tight text-foreground">
                  What would you like to create?
                </h2>
                <p className="text-xs text-muted-foreground mt-1.5 max-w-sm leading-relaxed">
                  Brainstorm viral ideas, analyze trends, or draft posts with
                  LinkX AI.
                </p>
                <div className="mt-6 w-full max-w-lg">
                  <Suggestions onSelect={handleSendMessage} />
                </div>
              </div>
            </div>
          ) : (
            <MessageScrollerProvider>
              <MessageScroller className="h-full">
                <MessageScrollerViewport>
                  <MessageScrollerContent className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 pt-6 pb-36 sm:px-6 sm:pb-40">
                    {messages.map((message) => (
                      <MessageScrollerItem
                        key={message.id}
                        messageId={message.id}
                        scrollAnchor={message.role === "user"}
                      >
                        <ChatMessage message={message} />
                      </MessageScrollerItem>
                    ))}

                    {/* Interactive Human-In-The-Loop Question Card */}
                    {activeThread?.pendingQuestion && (
                      <QuestionCard
                        part={activeThread.pendingQuestion}
                        onAnswer={handleQuestionAnswer}
                      />
                    )}

                    {isBusy && (
                      <MessageScrollerItem messageId="thinking">
                        <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground font-medium animate-pulse">
                          <span className="size-2 rounded-full bg-primary animate-ping" />
                          Generating response…
                        </div>
                      </MessageScrollerItem>
                    )}
                  </MessageScrollerContent>
                </MessageScrollerViewport>
              </MessageScroller>

              {/* Floating Composer Overlay with Gradient Fade (Matching Reference UI) */}
              <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col items-center bg-gradient-to-t from-background via-background/90 to-transparent pt-10 pb-4 px-4 sm:pb-6 sm:px-6">
                <div className="pointer-events-auto mb-2">
                  <MessageScrollerButton />
                </div>
                <div className="pointer-events-auto w-full max-w-2xl">
                  <PromptForm
                    placeholder="Ask anything"
                    isBusy={isBusy}
                    onSubmit={handleSendMessage}
                    onStop={handleStop}
                  />
                </div>
              </div>
            </MessageScrollerProvider>
          )}

          {messages.length === 0 && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col items-center pb-4 px-4 sm:pb-6 sm:px-6">
              <div className="pointer-events-auto w-full max-w-2xl">
                <PromptForm
                  placeholder="Ask anything"
                  isBusy={isBusy}
                  onSubmit={handleSendMessage}
                  onStop={handleStop}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 2. Right Column: History Sidebar (Recents & Archived) */}
      <div className="hidden w-80 md:block shrink-0">
        <div className="sticky top-0 self-start p-4 flex flex-col gap-4">
          {/* Recents Section (Matching Screenshot) */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between px-2 py-1">
              <button
                type="button"
                onClick={() => setRecentsOpen((prev) => !prev)}
                className="flex items-center gap-1.5 text-sm font-semibold text-foreground hover:text-muted-foreground transition-colors cursor-pointer select-none"
              >
                <span>Recents</span>
                <ChevronDown
                  className={cn(
                    "size-3.5 text-muted-foreground transition-transform duration-200",
                    !recentsOpen && "-rotate-90",
                  )}
                />
              </button>

              <div className="flex items-center gap-0.5">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Recent chats options"
                  className="size-7 text-muted-foreground hover:text-foreground rounded-full cursor-pointer"
                >
                  <MoreHorizontal className="size-3.5" />
                </Button>

                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="New chat"
                  onClick={handleNewChat}
                  className="size-7 text-muted-foreground hover:text-foreground rounded-full cursor-pointer"
                >
                  <SquarePen className="size-3.5" />
                </Button>
              </div>
            </div>

            {/* Recents List */}
            {recentsOpen && (
              <div className="space-y-0.5">
                {recentThreads.length === 0 ? (
                  <p className="px-3 py-1.5 text-xs text-muted-foreground">
                    No chats
                  </p>
                ) : (
                  recentThreads.map(renderThreadItem)
                )}
              </div>
            )}
          </div>

          {/* Archived Section (Old Ones - Subdued & Smaller) */}
          <div className="flex flex-col gap-1 border-t border-border/40 pt-2.5">
            <div className="flex items-center justify-between px-2 py-1">
              <button
                type="button"
                onClick={() => setArchivedOpen((prev) => !prev)}
                className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors cursor-pointer select-none"
              >
                <span>Archived</span>
                <ChevronDown
                  className={cn(
                    "size-3.5 text-muted-foreground transition-transform duration-200",
                    !archivedOpen && "-rotate-90",
                  )}
                />
              </button>
            </div>

            {/* Archived List */}
            {archivedOpen && (
              <div className="space-y-0.5">
                {archivedThreads.length === 0 ? (
                  <p className="px-3 py-1.5 text-xs text-muted-foreground">
                    No chats
                  </p>
                ) : (
                  archivedThreads.map(renderThreadItem)
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
