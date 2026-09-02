import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
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
import { AiThreadsService, type ChatThreadPublic } from "@/client"
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
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller"
import { useAIChatStream } from "@/hooks/useAIChatStream"
import { cn } from "@/lib/utils"

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

function DeleteThreadConfirmDialog({
  thread,
  isOpen,
  isPending,
  onClose,
  onConfirm,
}: {
  thread: ChatThreadPublic | null
  isOpen: boolean
  isPending: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  if (!thread) return null

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete Chat?</DialogTitle>
          <DialogDescription>
            This will permanently delete{" "}
            <span className="font-semibold text-foreground">
              "{thread.title}"
            </span>{" "}
            and its entire conversation history from your workspace. This action
            cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <DialogFooter className="mt-4 gap-2.5 sm:gap-2.5">
          <DialogClose asChild>
            <Button
              variant="outline"
              size="sm"
              disabled={isPending}
              onClick={onClose}
              className="cursor-pointer"
            >
              Cancel
            </Button>
          </DialogClose>
          <Button
            variant="destructive"
            size="sm"
            disabled={isPending}
            onClick={onConfirm}
            className="font-semibold cursor-pointer"
          >
            {isPending ? "Deleting…" : "Delete Chat"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ThreadActionsMenu({
  isArchived,
  onToggleArchive,
  onStartRename,
  onDelete,
}: {
  isArchived: boolean
  onToggleArchive: () => void
  onStartRename: () => void
  onDelete: () => void
}) {
  return (
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
          onToggleArchive()
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
          onStartRename()
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
          onDelete()
        }}
        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-destructive hover:bg-destructive/10 cursor-pointer font-medium"
      >
        <Trash2 className="size-3.5" />
        <span>Delete</span>
      </button>
    </div>
  )
}

function ThreadListItem({
  thread,
  isActive,
  isEditing,
  editTitleInput,
  isMenuOpen,
  onSelect,
  onStartRename,
  onRenameSubmit,
  onRenameCancel,
  onEditTitleChange,
  onToggleArchive,
  onDelete,
  onToggleMenu,
}: {
  thread: ChatThreadPublic
  isActive: boolean
  isEditing: boolean
  editTitleInput: string
  isMenuOpen: boolean
  onSelect: () => void
  onStartRename: () => void
  onRenameSubmit: (newTitle: string) => void
  onRenameCancel: () => void
  onEditTitleChange: (val: string) => void
  onToggleArchive: () => void
  onDelete: () => void
  onToggleMenu: () => void
}) {
  const isArchived = Boolean(thread.is_archived)

  return (
    <div
      data-slot="thread-item"
      className={cn(
        "group relative flex items-center justify-between rounded-xl px-3 py-1.5 text-xs transition-colors cursor-pointer",
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
            onRenameSubmit(editTitleInput)
          }}
          className="flex-1 mr-1"
        >
          <input
            type="text"
            value={editTitleInput}
            onChange={(e) => onEditTitleChange(e.target.value)}
            onBlur={() => onRenameSubmit(editTitleInput)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onRenameCancel()
            }}
            className="w-full bg-background border border-input rounded-full px-3 py-0.5 text-xs text-foreground outline-none focus:ring-1 focus:ring-ring"
          />
        </form>
      ) : (
        <button
          type="button"
          onClick={onSelect}
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

      <div className="flex items-center gap-0.5 shrink-0">
        {isArchived ? (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Delete thread"
            className="size-6 opacity-0 group-hover:opacity-100 hover:bg-destructive/10 rounded-full shrink-0 transition-opacity text-muted-foreground hover:text-destructive cursor-pointer"
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
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
              onToggleArchive()
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
              onToggleMenu()
            }}
          >
            <MoreHorizontal className="size-3" />
          </Button>

          {isMenuOpen && (
            <ThreadActionsMenu
              isArchived={isArchived}
              onToggleArchive={onToggleArchive}
              onStartRename={onStartRename}
              onDelete={onDelete}
            />
          )}
        </div>
      </div>
    </div>
  )
}

function AIPage() {
  const queryClient = useQueryClient()
  const { isStreaming, startStream, stop: stopStream } = useAIChatStream()

  const [activeThreadId, setActiveThreadId] = React.useState<string | null>(
    null,
  )
  const [editingThreadId, setEditingThreadId] = React.useState<string | null>(
    null,
  )
  const [editTitleInput, setEditTitleInput] = React.useState("")
  const [openMenuThreadId, setOpenMenuThreadId] = React.useState<string | null>(
    null,
  )
  const [recentsOpen, setRecentsOpen] = React.useState(true)
  const [archivedOpen, setArchivedOpen] = React.useState(true)

  // Confirmation dialog state for thread deletion
  const [threadToDelete, setThreadToDelete] =
    React.useState<ChatThreadPublic | null>(null)

  // Local optimistic messages state during streaming
  const [localMessages, setLocalMessages] = React.useState<ChatUIMessage[]>([])
  const [pendingQuestion, setPendingQuestion] =
    React.useState<AskUserToolPart | null>(null)

  // 1. Fetch user threads from PostgreSQL backend
  const { data: threadsData, isLoading: isThreadsLoading } = useQuery({
    queryKey: ["ai-threads"],
    queryFn: () => AiThreadsService.listChatThreads({ skip: 0, limit: 100 }),
  })

  const threads = threadsData?.data ?? []

  // Auto-select first thread if none selected
  React.useEffect(() => {
    if (!activeThreadId && threads.length > 0) {
      setActiveThreadId(threads[0].id)
    }
  }, [activeThreadId, threads])

  // 2. Fetch active thread detail with full JSONB transcript
  const { data: activeThreadDetail } = useQuery({
    queryKey: ["ai-thread", activeThreadId],
    queryFn: () => AiThreadsService.getChatThread({ id: activeThreadId! }),
    enabled: !!activeThreadId,
  })

  // Synchronize local messages from persistent database transcript when not streaming
  React.useEffect(() => {
    if (!isStreaming && activeThreadDetail?.transcript) {
      const msgs =
        (activeThreadDetail.transcript as { messages?: ChatUIMessage[] })
          ?.messages || []
      setLocalMessages(msgs)
    }
  }, [activeThreadDetail, isStreaming])

  // 3. Mutations for thread persistence
  const createThreadMutation = useMutation({
    mutationFn: (prompt?: string) =>
      AiThreadsService.createChatThread({
        requestBody: { origin: "composer", prompt },
      }),
    onSuccess: (newThread) => {
      queryClient.invalidateQueries({ queryKey: ["ai-threads"] })
      setActiveThreadId(newThread.id)
    },
  })

  const updateThreadMutation = useMutation({
    mutationFn: ({
      id,
      title,
      isArchived,
    }: {
      id: string
      title?: string
      isArchived?: boolean
    }) =>
      AiThreadsService.updateChatThread({
        id,
        requestBody: { title, is_archived: isArchived },
      }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["ai-threads"] })
      queryClient.invalidateQueries({ queryKey: ["ai-thread", variables.id] })
    },
  })

  const deleteThreadMutation = useMutation({
    mutationFn: (id: string) => AiThreadsService.deleteChatThread({ id }),
    onSuccess: (_, deletedId) => {
      queryClient.invalidateQueries({ queryKey: ["ai-threads"] })
      if (activeThreadId === deletedId) {
        const remaining = threads.filter((t) => t.id !== deletedId)
        setActiveThreadId(remaining.length > 0 ? remaining[0].id : null)
        setLocalMessages([])
      }
      setThreadToDelete(null)
    },
  })

  // Close menus on document click
  React.useEffect(() => {
    const handleDocumentClick = () => setOpenMenuThreadId(null)
    if (openMenuThreadId) {
      document.addEventListener("click", handleDocumentClick)
    }
    return () => document.removeEventListener("click", handleDocumentClick)
  }, [openMenuThreadId])

  const handleNewChat = () => {
    createThreadMutation.mutate(undefined)
    setLocalMessages([])
    setRecentsOpen(true)
  }

  const handleSendMessage = async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return

    let threadId = activeThreadId

    // If no thread exists yet, create it in DB first
    if (!threadId) {
      const newThread = await createThreadMutation.mutateAsync(trimmed)
      threadId = newThread.id
    }

    const userMessage: ChatUIMessage = {
      id: `usr-${Date.now()}`,
      role: "user",
      parts: [{ type: "text", text: trimmed }],
    }

    const assistantPlaceholder: ChatUIMessage = {
      id: `asst-${Date.now()}`,
      role: "assistant",
      parts: [],
    }

    setLocalMessages((prev) => [...prev, userMessage, assistantPlaceholder])

    startStream(threadId, trimmed, {
      onThought: (content) => {
        setLocalMessages((prev) =>
          prev.map((msg, idx) =>
            idx === prev.length - 1
              ? {
                  ...msg,
                  parts: [
                    ...msg.parts.filter((p) => p.type !== "thought"),
                    { type: "thought", content },
                  ],
                }
              : msg,
          ),
        )
      },
      onTextDelta: (content) => {
        setLocalMessages((prev) =>
          prev.map((msg, idx) => {
            if (idx !== prev.length - 1) return msg
            const existingTextPart = msg.parts.find((p) => p.type === "text")
            const otherParts = msg.parts.filter((p) => p.type !== "text")
            const newText =
              (existingTextPart ? existingTextPart.text : "") + content
            return {
              ...msg,
              parts: [...otherParts, { type: "text", text: newText }],
            }
          }),
        )
      },
      onDraftArtifact: (artifact) => {
        setLocalMessages((prev) =>
          prev.map((msg, idx) =>
            idx === prev.length - 1
              ? {
                  ...msg,
                  parts: [...msg.parts, { type: "draft_artifact", artifact }],
                }
              : msg,
          ),
        )
      },
      onError: (errorMsg) => {
        setLocalMessages((prev) =>
          prev.map((msg, idx) =>
            idx === prev.length - 1
              ? {
                  ...msg,
                  parts: [
                    {
                      type: "text",
                      text: `⚠️ **Error generating response**: ${errorMsg}`,
                    },
                  ],
                }
              : msg,
          ),
        )
      },
      onDone: () => {
        queryClient.invalidateQueries({ queryKey: ["ai-thread", threadId] })
        queryClient.invalidateQueries({ queryKey: ["ai-threads"] })
      },
    })
  }

  const handleRenameThread = (id: string, newTitle: string) => {
    const trimmed = newTitle.trim()
    if (trimmed) {
      updateThreadMutation.mutate({ id, title: trimmed })
    }
    setEditingThreadId(null)
  }

  const handleToggleArchive = (thread: ChatThreadPublic) => {
    setOpenMenuThreadId(null)
    updateThreadMutation.mutate({
      id: thread.id,
      isArchived: !thread.is_archived,
    })
  }

  const handleOpenDeleteDialog = (thread: ChatThreadPublic) => {
    setOpenMenuThreadId(null)
    setThreadToDelete(thread)
  }

  const handleConfirmDelete = () => {
    if (threadToDelete) {
      deleteThreadMutation.mutate(threadToDelete.id)
    }
  }

  const handleQuestionAnswer = (
    _toolCallId: string,
    answers: AskUserAnswer[],
  ) => {
    const formattedAnswers = answers
      .filter((a) => a.answer.trim().length > 0)
      .map((a) => `• **${a.question}**\n  👉 ${a.answer}`)
      .join("\n\n")

    setPendingQuestion(null)
    handleSendMessage(`Here are my preferences:\n\n${formattedAnswers}`)
  }

  const recentThreads = threads.filter((t) => !t.is_archived)
  const archivedThreads = threads.filter((t) => t.is_archived)
  const currentThread = threads.find((t) => t.id === activeThreadId)

  return (
    <div className="flex w-full min-h-[calc(100vh-3.5rem)] lg:min-h-screen bg-background text-foreground">
      {/* Delete Thread Confirmation Dialog */}
      <DeleteThreadConfirmDialog
        thread={threadToDelete}
        isOpen={Boolean(threadToDelete)}
        isPending={deleteThreadMutation.isPending}
        onClose={() => setThreadToDelete(null)}
        onConfirm={handleConfirmDelete}
      />

      {/* 1. Center Column: Active Chat Feed */}
      <div className="relative mx-auto flex min-h-0 w-full flex-1 max-w-2xl border-r-0 md:border-r border-border flex-col h-[calc(100vh-3.5rem)] lg:h-screen overflow-hidden">
        {/* Top Header */}
        <div className="sticky top-0 z-10 border-b border-border bg-background/80 backdrop-blur-md px-4 py-3 flex items-center justify-between">
          <h1 className="font-bold text-lg text-foreground tracking-tight truncate">
            {currentThread ? currentThread.title : "New Chat"}
          </h1>

          <Button
            size="sm"
            onClick={handleNewChat}
            className="md:hidden text-xs rounded-full h-8 px-3 font-semibold shadow-sm cursor-pointer"
          >
            New Chat
          </Button>
        </div>

        {/* Message Feed / Empty State */}
        <div className="relative flex-1 min-h-0">
          {localMessages.length === 0 ? (
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
                    {localMessages.map((message) => (
                      <MessageScrollerItem
                        key={message.id}
                        messageId={message.id}
                        scrollAnchor={message.role === "user"}
                      >
                        <ChatMessage message={message} />
                      </MessageScrollerItem>
                    ))}

                    {pendingQuestion && (
                      <QuestionCard
                        part={pendingQuestion}
                        onAnswer={handleQuestionAnswer}
                      />
                    )}

                    {isStreaming && (
                      <MessageScrollerItem messageId="thinking">
                        <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground font-medium animate-pulse">
                          <span className="size-2 rounded-full bg-primary animate-ping" />
                          Streaming response…
                        </div>
                      </MessageScrollerItem>
                    )}
                  </MessageScrollerContent>
                </MessageScrollerViewport>
              </MessageScroller>

              <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col items-center bg-gradient-to-t from-background via-background/90 to-transparent pt-10 pb-4 px-4 sm:pb-6 sm:px-6">
                <div className="pointer-events-auto mb-2">
                  <MessageScrollerButton />
                </div>
                <div className="pointer-events-auto w-full max-w-2xl">
                  <PromptForm
                    placeholder="Ask anything"
                    isBusy={isStreaming}
                    onSubmit={handleSendMessage}
                    onStop={stopStream}
                  />
                </div>
              </div>
            </MessageScrollerProvider>
          )}

          {localMessages.length === 0 && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col items-center pb-4 px-4 sm:pb-6 sm:px-6">
              <div className="pointer-events-auto w-full max-w-2xl">
                <PromptForm
                  placeholder="Ask anything"
                  isBusy={isStreaming}
                  onSubmit={handleSendMessage}
                  onStop={stopStream}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 2. Right Column: History Sidebar */}
      <div className="hidden w-80 md:block shrink-0">
        <div className="sticky top-0 self-start p-4 flex flex-col gap-4">
          {/* Recents Section */}
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
                  aria-label="New chat"
                  onClick={handleNewChat}
                  className="size-7 text-muted-foreground hover:text-foreground rounded-full cursor-pointer"
                >
                  <SquarePen className="size-3.5" />
                </Button>
              </div>
            </div>

            {recentsOpen && (
              <div className="space-y-0.5">
                {isThreadsLoading ? (
                  <p className="px-3 py-1.5 text-xs text-muted-foreground animate-pulse">
                    Loading chats…
                  </p>
                ) : recentThreads.length === 0 ? (
                  <p className="px-3 py-1.5 text-xs text-muted-foreground">
                    No recent chats
                  </p>
                ) : (
                  recentThreads.map((thread) => (
                    <ThreadListItem
                      key={thread.id}
                      thread={thread}
                      isActive={thread.id === activeThreadId}
                      isEditing={editingThreadId === thread.id}
                      editTitleInput={editTitleInput}
                      isMenuOpen={openMenuThreadId === thread.id}
                      onSelect={() => {
                        if (thread.id !== activeThreadId) {
                          stopStream()
                          setActiveThreadId(thread.id)
                          setEditingThreadId(null)
                        }
                      }}
                      onStartRename={() => {
                        setOpenMenuThreadId(null)
                        setEditingThreadId(thread.id)
                        setEditTitleInput(thread.title)
                      }}
                      onRenameSubmit={(title) =>
                        handleRenameThread(thread.id, title)
                      }
                      onRenameCancel={() => setEditingThreadId(null)}
                      onEditTitleChange={setEditTitleInput}
                      onToggleArchive={() => handleToggleArchive(thread)}
                      onDelete={() => handleOpenDeleteDialog(thread)}
                      onToggleMenu={() =>
                        setOpenMenuThreadId((prev) =>
                          prev === thread.id ? null : thread.id,
                        )
                      }
                    />
                  ))
                )}
              </div>
            )}
          </div>

          {/* Archived Section */}
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

            {archivedOpen && (
              <div className="space-y-0.5">
                {archivedThreads.length === 0 ? (
                  <p className="px-3 py-1.5 text-xs text-muted-foreground">
                    No archived chats
                  </p>
                ) : (
                  archivedThreads.map((thread) => (
                    <ThreadListItem
                      key={thread.id}
                      thread={thread}
                      isActive={thread.id === activeThreadId}
                      isEditing={editingThreadId === thread.id}
                      editTitleInput={editTitleInput}
                      isMenuOpen={openMenuThreadId === thread.id}
                      onSelect={() => {
                        if (thread.id !== activeThreadId) {
                          stopStream()
                          setActiveThreadId(thread.id)
                          setEditingThreadId(null)
                        }
                      }}
                      onStartRename={() => {
                        setOpenMenuThreadId(null)
                        setEditingThreadId(thread.id)
                        setEditTitleInput(thread.title)
                      }}
                      onRenameSubmit={(title) =>
                        handleRenameThread(thread.id, title)
                      }
                      onRenameCancel={() => setEditingThreadId(null)}
                      onEditTitleChange={setEditTitleInput}
                      onToggleArchive={() => handleToggleArchive(thread)}
                      onDelete={() => handleOpenDeleteDialog(thread)}
                      onToggleMenu={() =>
                        setOpenMenuThreadId((prev) =>
                          prev === thread.id ? null : thread.id,
                        )
                      }
                    />
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
