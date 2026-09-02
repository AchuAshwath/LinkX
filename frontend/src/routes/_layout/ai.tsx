import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import * as React from "react"
import { AiThreadsService, type ChatThreadPublic } from "@/client"
import { AIChatFeed } from "@/components/Chat/AIChatFeed"
import {
  AIThreadsSidebar,
  type SortOption,
} from "@/components/Chat/AIThreadsSidebar"
import { DeleteThreadConfirmDialog } from "@/components/Chat/DeleteThreadConfirmDialog"
import { PromptForm } from "@/components/Chat/PromptForm"
import { RenameThreadDialog } from "@/components/Chat/RenameThreadDialog"
import { useAIChatFeedState } from "@/hooks/useAIChatFeedState"

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

const AI_MODEL_STORAGE_KEY = "linkx_ai_selected_model"

function getInitialStoredModel(): string {
  if (typeof window !== "undefined" && typeof localStorage !== "undefined") {
    try {
      const saved = localStorage.getItem(AI_MODEL_STORAGE_KEY)
      if (saved) return saved
    } catch {
      // ignore
    }
  }
  return "gemini-3.6-flash-high"
}

function filterAndSortThreads(
  threadList: ChatThreadPublic[],
  searchQuery: string,
  sortOrder: SortOption,
): ChatThreadPublic[] {
  let result = [...threadList]
  if (searchQuery.trim()) {
    const q = searchQuery.toLowerCase().trim()
    result = result.filter((t) => t.title.toLowerCase().includes(q))
  }
  result.sort((a, b) => {
    const timeA = a.created_at ? new Date(a.created_at).getTime() : 0
    const timeB = b.created_at ? new Date(b.created_at).getTime() : 0
    if (sortOrder === "recent") return timeB - timeA
    if (sortOrder === "oldest") return timeA - timeB
    if (sortOrder === "title") return a.title.localeCompare(b.title)
    if (sortOrder === "messages")
      return (b.message_count ?? 0) - (a.message_count ?? 0)
    return 0
  })
  return result
}

function AIPage() {
  const queryClient = useQueryClient()
  const promptInputRef = React.useRef<HTMLTextAreaElement>(null)

  const [threadToRename, setThreadToRename] =
    React.useState<ChatThreadPublic | null>(null)
  const [threadToDelete, setThreadToDelete] =
    React.useState<ChatThreadPublic | null>(null)
  const [openMenuThreadId, setOpenMenuThreadId] = React.useState<string | null>(
    null,
  )
  const [recentsOpen, setRecentsOpen] = React.useState(true)
  const [archivedOpen, setArchivedOpen] = React.useState(true)
  const [isSearchOpen, setIsSearchOpen] = React.useState(false)
  const [searchQuery, setSearchQuery] = React.useState("")
  const [sortOrder, setSortOrder] = React.useState<SortOption>("recent")
  const [isSortMenuOpen, setIsSortMenuOpen] = React.useState(false)

  const { data: modelsData } = useQuery({
    queryKey: ["ai-models"],
    queryFn: () => AiThreadsService.listAiModels(),
  })

  const [selectedModelId, setSelectedModelIdState] = React.useState<string>(
    getInitialStoredModel,
  )

  const setSelectedModelId = React.useCallback((modelId: string) => {
    setSelectedModelIdState(modelId)
    if (typeof window !== "undefined" && typeof localStorage !== "undefined") {
      try {
        localStorage.setItem(AI_MODEL_STORAGE_KEY, modelId)
      } catch {
        // ignore
      }
    }
  }, [])

  React.useEffect(() => {
    if (!modelsData) return
    const saved =
      typeof window !== "undefined" && typeof localStorage !== "undefined"
        ? localStorage.getItem(AI_MODEL_STORAGE_KEY)
        : null

    if (!saved) {
      const defaultId = modelsData.default_model || modelsData.data?.[0]?.id
      if (defaultId) setSelectedModelId(defaultId)
    } else if (modelsData.data && modelsData.data.length > 0) {
      const exists = modelsData.data.some((m) => m.id === saved)
      if (!exists) {
        const fallback = modelsData.default_model || modelsData.data[0].id
        setSelectedModelId(fallback)
      }
    }
  }, [modelsData, setSelectedModelId])

  const { data: threadsData, isLoading: isThreadsLoading } = useQuery({
    queryKey: ["ai-threads"],
    queryFn: () => AiThreadsService.listChatThreads({ skip: 0, limit: 100 }),
  })

  const threads = threadsData?.data ?? []

  const {
    activeThreadId,
    setActiveThreadId,
    localMessages,
    setLocalMessages,
    pendingQuestion,
    threadDrafts,
    setThreadDraft,
    isStreaming,
    stopStream,
    handleSendMessage,
    handleQuestionAnswer,
    handleNewChat,
  } = useAIChatFeedState({ threads, selectedModelId })

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

  React.useEffect(() => {
    function handleClickOutside() {
      setOpenMenuThreadId(null)
      setIsSortMenuOpen(false)
    }
    if (openMenuThreadId || isSortMenuOpen) {
      document.addEventListener("click", handleClickOutside)
      return () => document.removeEventListener("click", handleClickOutside)
    }
  }, [openMenuThreadId, isSortMenuOpen])

  function onNewChatClick() {
    handleNewChat()
    setTimeout(() => promptInputRef.current?.focus(), 50)
  }

  function handleConfirmRename(title: string) {
    if (!threadToRename) return
    updateThreadMutation.mutate({ id: threadToRename.id, title })
    setThreadToRename(null)
  }

  function handleToggleArchive(thread: ChatThreadPublic) {
    setOpenMenuThreadId(null)
    updateThreadMutation.mutate({
      id: thread.id,
      isArchived: !thread.is_archived,
    })
  }

  const recentThreads = React.useMemo(
    () =>
      filterAndSortThreads(
        threads.filter((t) => !t.is_archived),
        searchQuery,
        sortOrder,
      ),
    [threads, searchQuery, sortOrder],
  )

  const archivedThreads = React.useMemo(
    () =>
      filterAndSortThreads(
        threads.filter((t) => t.is_archived),
        searchQuery,
        sortOrder,
      ),
    [threads, searchQuery, sortOrder],
  )

  return (
    <div className="flex w-full min-h-[calc(100vh-3.5rem)] lg:min-h-screen bg-background text-foreground">
      <RenameThreadDialog
        thread={threadToRename}
        isOpen={Boolean(threadToRename)}
        isPending={updateThreadMutation.isPending}
        onClose={() => setThreadToRename(null)}
        onConfirm={handleConfirmRename}
      />

      <DeleteThreadConfirmDialog
        thread={threadToDelete}
        isOpen={Boolean(threadToDelete)}
        isPending={deleteThreadMutation.isPending}
        onClose={() => setThreadToDelete(null)}
        onConfirm={() => {
          if (threadToDelete) {
            deleteThreadMutation.mutate(threadToDelete.id)
          }
        }}
      />

      {/* 1. Center Column: Active Chat Feed */}
      <div className="relative mx-auto flex min-h-0 w-full flex-1 max-w-2xl border-r-0 md:border-r border-border flex-col h-[calc(100vh-3.5rem)] lg:h-screen overflow-hidden">
        <AIChatFeed
          localMessages={localMessages}
          isStreaming={isStreaming}
          pendingQuestion={pendingQuestion}
          onSendMessage={handleSendMessage}
          onQuestionAnswer={handleQuestionAnswer}
        />

        <div className="mx-auto flex w-full max-w-2xl flex-col gap-2 px-4 pb-4 shrink-0">
          <PromptForm
            key={activeThreadId ?? "new-chat"}
            inputRef={promptInputRef}
            initialValue={threadDrafts[activeThreadId ?? "new-chat"] ?? ""}
            onValueChange={(val) => setThreadDraft(activeThreadId, val)}
            placeholder="Ask anything"
            isBusy={isStreaming}
            selectedModelId={selectedModelId}
            models={modelsData?.data}
            onSelectModel={setSelectedModelId}
            onSubmit={handleSendMessage}
            onStop={stopStream}
            autoFocus
          />
        </div>
      </div>

      {/* 2. Right Column: History Sidebar */}
      <AIThreadsSidebar
        recentThreads={recentThreads}
        archivedThreads={archivedThreads}
        activeThreadId={activeThreadId}
        openMenuThreadId={openMenuThreadId}
        isLoading={isThreadsLoading}
        filters={{
          searchQuery,
          isSearchOpen,
          sortOrder,
          isSortMenuOpen,
          recentsOpen,
          archivedOpen,
        }}
        filterHandlers={{
          onToggleSearch: () => setIsSearchOpen((prev) => !prev),
          onSearchChange: setSearchQuery,
          onToggleSortMenu: () => setIsSortMenuOpen((prev) => !prev),
          onSelectSortOrder: (newOrder) => {
            setSortOrder(newOrder)
            setIsSortMenuOpen(false)
          },
          onToggleRecents: () => setRecentsOpen((prev) => !prev),
          onToggleArchived: () => setArchivedOpen((prev) => !prev),
          onNewChat: onNewChatClick,
        }}
        actions={{
          onSelect: (threadId) => {
            if (threadId !== activeThreadId) {
              stopStream()
              setActiveThreadId(threadId)
            }
          },
          onStartRename: (t) => {
            setOpenMenuThreadId(null)
            setThreadToRename(t)
          },
          onToggleArchive: handleToggleArchive,
          onDelete: (t) => {
            setOpenMenuThreadId(null)
            setThreadToDelete(t)
          },
          onToggleMenu: (id) =>
            setOpenMenuThreadId((prev) => (prev === id ? null : id)),
        }}
      />
    </div>
  )
}
