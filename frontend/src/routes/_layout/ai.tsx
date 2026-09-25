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
import {
  type AIChatUrlParams,
  getAIChatUrlParams,
  useAIChatContext,
} from "@/context/AIChatContext"
import { useAIChatFeedState } from "@/hooks/useAIChatFeedState"
import { useAIModelSelection } from "@/hooks/useAIModelSelection"

type AISearchParams = AIChatUrlParams

export const Route = createFileRoute("/_layout/ai")({
  validateSearch: (search: Record<string, unknown>): AISearchParams => ({
    threadId: typeof search.threadId === "string" ? search.threadId : undefined,
    prompt: typeof search.prompt === "string" ? search.prompt : undefined,
    autoRun: search.autoRun === true || search.autoRun === "true",
  }),
  component: AIPage,
  head: () => ({
    meta: [
      {
        title: "Chat - LinkX",
      },
    ],
  }),
})

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

function cleanTransientUrlParams(url: URL): boolean {
  let changed = false
  for (const key of ["autoRun", "prompt"]) {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key)
      changed = true
    }
  }
  return changed
}

function syncThreadIdParam(url: URL, activeThreadId: string | null): boolean {
  const current = url.searchParams.get("threadId")
  if (activeThreadId && current !== activeThreadId) {
    url.searchParams.set("threadId", activeThreadId)
    return true
  }
  if (!activeThreadId && current) {
    url.searchParams.delete("threadId")
    return true
  }
  return false
}

function syncBrowserUrl(
  activeThreadId: string | null,
  targetThreadId?: string,
  isAutoRunPending?: boolean,
) {
  if (typeof window === "undefined") return
  try {
    const url = new URL(window.location.href)
    if (url.pathname !== "/ai") return
    if (isAutoRunPending) return
    if (targetThreadId && activeThreadId !== targetThreadId) return
    const transientChanged = cleanTransientUrlParams(url)
    const threadChanged = syncThreadIdParam(url, activeThreadId)
    if (transientChanged || threadChanged) {
      window.history.replaceState({}, "", url.pathname + url.search)
    }
  } catch {
    // ignore
  }
}

interface AutoRunPromptOptions {
  autoRun?: boolean
  prompt?: string
  targetThreadId?: string
  isThreadsLoading?: boolean
  activeThreadId: string | null
  setActiveThreadId: (id: string | null) => void
  handleNewChat: () => void
  handleSendMessage: (
    text: string,
    images?: File[],
    editMessageId?: string,
    targetThreadIdOverride?: string,
  ) => Promise<void>
}

function useAutoRunPrompt({
  autoRun,
  prompt,
  targetThreadId,
  isThreadsLoading,
  activeThreadId,
  setActiveThreadId,
  handleNewChat,
  handleSendMessage,
}: AutoRunPromptOptions) {
  const executedPromptRef = React.useRef<string | null>(null)

  React.useEffect(() => {
    if (!autoRun || !prompt) return
    if (isThreadsLoading) return
    if (executedPromptRef.current === prompt) return

    if (targetThreadId) {
      if (activeThreadId !== targetThreadId) {
        setActiveThreadId(targetThreadId)
        return
      }
      executedPromptRef.current = prompt
      handleSendMessage(prompt, undefined, undefined, targetThreadId)
      return
    }

    if (activeThreadId !== null) {
      handleNewChat()
      return
    }

    executedPromptRef.current = prompt
    handleSendMessage(prompt)
  }, [
    autoRun,
    prompt,
    targetThreadId,
    isThreadsLoading,
    activeThreadId,
    setActiveThreadId,
    handleNewChat,
    handleSendMessage,
  ])
}

function useThreadSidebarFilters(threads: ChatThreadPublic[]) {
  const [recentsOpen, setRecentsOpen] = React.useState(true)
  const [archivedOpen, setArchivedOpen] = React.useState(true)
  const [isSearchOpen, setIsSearchOpen] = React.useState(false)
  const [searchQuery, setSearchQuery] = React.useState("")
  const [sortOrder, setSortOrder] = React.useState<SortOption>("recent")
  const [isSortMenuOpen, setIsSortMenuOpen] = React.useState(false)

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

  return {
    recentsOpen,
    setRecentsOpen,
    archivedOpen,
    setArchivedOpen,
    isSearchOpen,
    setIsSearchOpen,
    searchQuery,
    setSearchQuery,
    sortOrder,
    setSortOrder,
    isSortMenuOpen,
    setIsSortMenuOpen,
    recentThreads,
    archivedThreads,
  }
}

interface ThreadMutationsOptions {
  queryClient: ReturnType<typeof useQueryClient>
  activeThreadId: string | null
  setActiveThreadId: (id: string | null) => void
  threads: ChatThreadPublic[]
  handleThreadDeleted: (deletedId: string) => void
}

function useThreadMutations({
  queryClient,
  activeThreadId,
  setActiveThreadId,
  threads,
  handleThreadDeleted,
}: ThreadMutationsOptions) {
  const [threadToRename, setThreadToRename] =
    React.useState<ChatThreadPublic | null>(null)
  const [threadToDelete, setThreadToDelete] =
    React.useState<ChatThreadPublic | null>(null)

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
      handleThreadDeleted(deletedId)
      if (activeThreadId === deletedId) {
        const remaining = threads.filter((t) => t.id !== deletedId)
        setActiveThreadId(remaining.length > 0 ? remaining[0].id : null)
      }
      setThreadToDelete(null)
    },
  })

  function handleConfirmRename(title: string) {
    if (!threadToRename) return
    updateThreadMutation.mutate({ id: threadToRename.id, title })
    setThreadToRename(null)
  }

  function handleToggleArchive(thread: ChatThreadPublic) {
    updateThreadMutation.mutate({
      id: thread.id,
      isArchived: !thread.is_archived,
    })
  }

  return {
    threadToRename,
    setThreadToRename,
    threadToDelete,
    setThreadToDelete,
    updateThreadMutation,
    deleteThreadMutation,
    handleConfirmRename,
    handleToggleArchive,
  }
}

interface AIChatCenterColumnProps {
  activeThreadId: string | null
  localMessages: ReturnType<typeof useAIChatFeedState>["localMessages"]
  allMessages?: ReturnType<typeof useAIChatFeedState>["allMessages"]
  isCurrentThreadStreaming: boolean
  isCurrentThreadBusy: boolean
  isCurrentThreadQueued: boolean
  pendingQuestion: ReturnType<typeof useAIChatFeedState>["pendingQuestion"]
  threadDrafts: Record<string, string>
  setThreadDraft: (id: string | null, val: string) => void
  promptInputRef: React.RefObject<HTMLTextAreaElement | null>
  selectedModelId: string
  modelsData?: { data?: { id: string; name?: string }[] }
  setSelectedModelId: (id: string) => void
  handleSendMessage: (
    text: string,
    images?: File[],
    editMessageId?: string,
  ) => Promise<void>
  handleQuestionAnswer: (id: string, answers: any[]) => void
  stopStream: () => void
  editingMessageId: string | null
  onStartEdit: (messageId: string) => void
  onCancelEdit: () => void
  onSaveEdit: (messageId: string, newText: string) => void
  onRegenerate: (assistantMsgId: string) => void
  onRetry: (assistantMsgId: string) => void
  onSwitchBranch?: (messageId: string, direction: "prev" | "next") => void
  onEditLastUserMessage: () => void
}

function AIChatCenterColumn({
  activeThreadId,
  localMessages,
  allMessages,
  isCurrentThreadStreaming,
  isCurrentThreadBusy,
  isCurrentThreadQueued,
  pendingQuestion,
  threadDrafts,
  setThreadDraft,
  promptInputRef,
  selectedModelId,
  modelsData,
  setSelectedModelId,
  handleSendMessage,
  handleQuestionAnswer,
  stopStream,
  editingMessageId,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onRegenerate,
  onRetry,
  onSwitchBranch,
  onEditLastUserMessage,
}: AIChatCenterColumnProps) {
  const currentKey = activeThreadId ?? "new-chat"
  const draftValue = threadDrafts[currentKey] ?? ""
  const placeholderText = isCurrentThreadQueued
    ? "Waiting in queue..."
    : "Ask anything"

  return (
    <div className="relative mx-auto flex min-h-0 w-full flex-1 max-w-2xl border-r-0 md:border-r border-border flex-col h-[calc(100vh-3.5rem)] lg:h-screen overflow-hidden">
      <AIChatFeed
        localMessages={localMessages}
        allMessages={allMessages}
        isStreaming={isCurrentThreadStreaming}
        pendingQuestion={pendingQuestion}
        onSendMessage={handleSendMessage}
        onQuestionAnswer={handleQuestionAnswer}
        editingMessageId={editingMessageId}
        onStartEdit={onStartEdit}
        onCancelEdit={onCancelEdit}
        onSaveEdit={onSaveEdit}
        onRegenerate={onRegenerate}
        onRetry={onRetry}
        onSwitchBranch={onSwitchBranch}
      />

      <div className="mx-auto flex w-full max-w-2xl flex-col gap-2 px-4 pb-4 shrink-0">
        <PromptForm
          key={currentKey}
          inputRef={promptInputRef}
          initialValue={draftValue}
          onValueChange={(val) => setThreadDraft(activeThreadId, val)}
          placeholder={placeholderText}
          isBusy={isCurrentThreadBusy}
          selectedModelId={selectedModelId}
          models={modelsData?.data?.map((m) => ({
            id: m.id,
            name: m.name || m.id,
          }))}
          onSelectModel={setSelectedModelId}
          onSubmit={handleSendMessage}
          onStop={stopStream}
          onEditLastUserMessage={onEditLastUserMessage}
          autoFocus
        />
      </div>
    </div>
  )
}

interface AIPageViewProps {
  feedState: ReturnType<typeof useAIChatFeedState>
  threads: ChatThreadPublic[]
  isThreadsLoading: boolean
  selectedModelId: string
  setSelectedModelId: (id: string) => void
  modelsData?: {
    default_model?: string | null
    data?: { id: string; name?: string }[]
  }
  searchThreadId?: string
  autoRun?: boolean
  prompt?: string
}

function computeIsAutoRunPending({
  autoRun,
  prompt,
  isThreadsLoading,
  activeThreadId,
  targetThreadId,
}: {
  autoRun?: boolean
  prompt?: string
  isThreadsLoading: boolean
  activeThreadId: string | null
  targetThreadId?: string
}): boolean {
  if (!autoRun || !prompt) return false
  if (isThreadsLoading) return true
  if (targetThreadId) return activeThreadId !== targetThreadId
  return activeThreadId !== null
}

function useSyncActiveThreadWithTarget(
  effectiveTargetThreadId: string | undefined,
  activeThreadId: string | null,
  setActiveThreadId: (id: string | null) => void,
) {
  const prevRef = React.useRef<string | undefined>(undefined)
  React.useEffect(() => {
    if (!effectiveTargetThreadId) return
    if (effectiveTargetThreadId === prevRef.current) return
    prevRef.current = effectiveTargetThreadId
    if (activeThreadId !== effectiveTargetThreadId) {
      setActiveThreadId(effectiveTargetThreadId)
    }
  }, [effectiveTargetThreadId, activeThreadId, setActiveThreadId])
}

function useBrowserHistoryPopstate(
  activeThreadId: string | null,
  setActiveThreadId: (id: string | null) => void,
) {
  React.useEffect(() => {
    function handlePopState() {
      const params = new URLSearchParams(window.location.search)
      const tid = params.get("threadId") || null
      if (tid !== activeThreadId) {
        setActiveThreadId(tid)
      }
    }
    window.addEventListener("popstate", handlePopState)
    return () => window.removeEventListener("popstate", handlePopState)
  }, [activeThreadId, setActiveThreadId])
}

function useAIPageNavigation({
  feedState,
  isThreadsLoading,
  searchThreadId,
  autoRun,
  prompt,
}: {
  feedState: ReturnType<typeof useAIChatFeedState>
  isThreadsLoading: boolean
  searchThreadId?: string
  autoRun?: boolean
  prompt?: string
}) {
  const effectiveTargetThreadId = searchThreadId

  useAutoRunPrompt({
    autoRun,
    prompt,
    targetThreadId: effectiveTargetThreadId,
    isThreadsLoading,
    activeThreadId: feedState.activeThreadId,
    setActiveThreadId: feedState.setActiveThreadId,
    handleNewChat: feedState.handleNewChat,
    handleSendMessage: feedState.handleSendMessage,
  })

  useSyncActiveThreadWithTarget(
    effectiveTargetThreadId,
    feedState.activeThreadId,
    feedState.setActiveThreadId,
  )

  const isAutoRunPending = computeIsAutoRunPending({
    autoRun,
    prompt,
    isThreadsLoading,
    activeThreadId: feedState.activeThreadId,
    targetThreadId: effectiveTargetThreadId,
  })

  React.useEffect(() => {
    syncBrowserUrl(
      feedState.activeThreadId,
      effectiveTargetThreadId,
      isAutoRunPending,
    )
  }, [feedState.activeThreadId, effectiveTargetThreadId, isAutoRunPending])

  useBrowserHistoryPopstate(
    feedState.activeThreadId,
    feedState.setActiveThreadId,
  )
}

function useDismissMenusOnOutsideClick({
  openMenuThreadId,
  setOpenMenuThreadId,
  isSortMenuOpen,
  setIsSortMenuOpen,
}: {
  openMenuThreadId: string | null
  setOpenMenuThreadId: (id: string | null) => void
  isSortMenuOpen: boolean
  setIsSortMenuOpen: (open: boolean) => void
}) {
  React.useEffect(() => {
    function handleClickOutside() {
      setOpenMenuThreadId(null)
      setIsSortMenuOpen(false)
    }
    if (openMenuThreadId || isSortMenuOpen) {
      document.addEventListener("click", handleClickOutside)
      return () => document.removeEventListener("click", handleClickOutside)
    }
  }, [openMenuThreadId, isSortMenuOpen, setOpenMenuThreadId, setIsSortMenuOpen])
}

function AIPageDialogs({
  mutations,
}: {
  mutations: ReturnType<typeof useThreadMutations>
}) {
  return (
    <>
      <RenameThreadDialog
        thread={mutations.threadToRename}
        isOpen={Boolean(mutations.threadToRename)}
        isPending={mutations.updateThreadMutation.isPending}
        onClose={() => mutations.setThreadToRename(null)}
        onConfirm={mutations.handleConfirmRename}
      />

      <DeleteThreadConfirmDialog
        thread={mutations.threadToDelete}
        isOpen={Boolean(mutations.threadToDelete)}
        isPending={mutations.deleteThreadMutation.isPending}
        onClose={() => mutations.setThreadToDelete(null)}
        onConfirm={() => {
          if (mutations.threadToDelete) {
            mutations.deleteThreadMutation.mutate(mutations.threadToDelete.id)
          }
        }}
      />
    </>
  )
}

function AIPageView({
  feedState,
  threads,
  isThreadsLoading,
  selectedModelId,
  setSelectedModelId,
  modelsData,
  searchThreadId,
  autoRun,
  prompt,
}: AIPageViewProps) {
  const queryClient = useQueryClient()
  const promptInputRef = React.useRef<HTMLTextAreaElement>(null)
  const [openMenuThreadId, setOpenMenuThreadId] = React.useState<string | null>(
    null,
  )

  const sidebarFilters = useThreadSidebarFilters(threads)

  const mutations = useThreadMutations({
    queryClient,
    activeThreadId: feedState.activeThreadId,
    setActiveThreadId: feedState.setActiveThreadId,
    threads,
    handleThreadDeleted: feedState.handleThreadDeleted,
  })

  useAIPageNavigation({
    feedState,
    isThreadsLoading,
    searchThreadId,
    autoRun,
    prompt,
  })

  useDismissMenusOnOutsideClick({
    openMenuThreadId,
    setOpenMenuThreadId,
    isSortMenuOpen: sidebarFilters.isSortMenuOpen,
    setIsSortMenuOpen: sidebarFilters.setIsSortMenuOpen,
  })

  const isCurrentThreadStreaming = feedState.isThreadStreaming(
    feedState.activeThreadId,
  )
  const isCurrentThreadQueued = feedState.isThreadQueued(
    feedState.activeThreadId,
  )
  const isCurrentThreadBusy = isCurrentThreadStreaming || isCurrentThreadQueued

  function onNewChatClick() {
    feedState.handleNewChat()
    setTimeout(() => promptInputRef.current?.focus(), 50)
  }

  return (
    <div className="flex w-full h-[calc(100vh-3.5rem)] lg:h-screen overflow-hidden bg-background text-foreground">
      <AIPageDialogs mutations={mutations} />

      <AIChatCenterColumn
        activeThreadId={feedState.activeThreadId}
        localMessages={feedState.localMessages}
        allMessages={feedState.allMessages}
        isCurrentThreadStreaming={isCurrentThreadStreaming}
        isCurrentThreadBusy={isCurrentThreadBusy}
        isCurrentThreadQueued={isCurrentThreadQueued}
        pendingQuestion={feedState.pendingQuestion}
        threadDrafts={feedState.threadDrafts}
        setThreadDraft={feedState.setThreadDraft}
        promptInputRef={promptInputRef}
        selectedModelId={selectedModelId}
        modelsData={modelsData}
        setSelectedModelId={setSelectedModelId}
        handleSendMessage={feedState.handleSendMessage}
        handleQuestionAnswer={feedState.handleQuestionAnswer}
        stopStream={feedState.stopStream}
        editingMessageId={feedState.editingMessageId}
        onStartEdit={feedState.handleStartEdit}
        onCancelEdit={feedState.handleCancelEdit}
        onSaveEdit={feedState.handleEditMessage}
        onRegenerate={feedState.handleRegenerate}
        onRetry={feedState.handleRetry}
        onSwitchBranch={feedState.handleSwitchBranch}
        onEditLastUserMessage={feedState.handleEditLastUserMessage}
      />

      <AIThreadsSidebar
        recentThreads={sidebarFilters.recentThreads}
        archivedThreads={sidebarFilters.archivedThreads}
        activeThreadId={feedState.activeThreadId}
        openMenuThreadId={openMenuThreadId}
        isLoading={isThreadsLoading}
        streamingThreadId={feedState.streamingThreadId}
        queuedThreadIds={feedState.queuedThreadIds}
        filters={{
          searchQuery: sidebarFilters.searchQuery,
          isSearchOpen: sidebarFilters.isSearchOpen,
          sortOrder: sidebarFilters.sortOrder,
          isSortMenuOpen: sidebarFilters.isSortMenuOpen,
          recentsOpen: sidebarFilters.recentsOpen,
          archivedOpen: sidebarFilters.archivedOpen,
        }}
        filterHandlers={{
          onToggleSearch: () => sidebarFilters.setIsSearchOpen((prev) => !prev),
          onSearchChange: sidebarFilters.setSearchQuery,
          onToggleSortMenu: () =>
            sidebarFilters.setIsSortMenuOpen((prev) => !prev),
          onSelectSortOrder: (newOrder) => {
            sidebarFilters.setSortOrder(newOrder)
            sidebarFilters.setIsSortMenuOpen(false)
          },
          onToggleRecents: () => sidebarFilters.setRecentsOpen((prev) => !prev),
          onToggleArchived: () =>
            sidebarFilters.setArchivedOpen((prev) => !prev),
          onNewChat: onNewChatClick,
        }}
        actions={{
          onSelect: (threadId) => {
            if (threadId !== feedState.activeThreadId) {
              feedState.setActiveThreadId(threadId)
            }
          },
          onStartRename: (t) => {
            setOpenMenuThreadId(null)
            mutations.setThreadToRename(t)
          },
          onToggleArchive: (t) => {
            setOpenMenuThreadId(null)
            mutations.handleToggleArchive(t)
          },
          onDelete: (t) => {
            setOpenMenuThreadId(null)
            mutations.setThreadToDelete(t)
          },
          onToggleMenu: (id) =>
            setOpenMenuThreadId((prev) => (prev === id ? null : id)),
        }}
      />
    </div>
  )
}

function AIPageFallback({ search }: { search: AISearchParams }) {
  const { selectedModelId, setSelectedModelId, modelsData } =
    useAIModelSelection()

  const { data: threadsData, isLoading: isThreadsLoading } = useQuery({
    queryKey: ["ai-threads"],
    queryFn: () => AiThreadsService.listChatThreads({ skip: 0, limit: 100 }),
  })

  const threads = threadsData?.data ?? []
  const initialThreadId = search.threadId

  const feedState = useAIChatFeedState({
    threads,
    selectedModelId,
    initialThreadId,
    isAutoRun: Boolean(search.autoRun || search.prompt),
  })

  return (
    <AIPageView
      feedState={feedState}
      threads={threads}
      isThreadsLoading={isThreadsLoading}
      selectedModelId={selectedModelId}
      setSelectedModelId={setSelectedModelId}
      modelsData={modelsData}
      searchThreadId={initialThreadId}
      autoRun={search.autoRun}
      prompt={search.prompt}
    />
  )
}

function AIPage() {
  const search = getAIChatUrlParams()
  const context = useAIChatContext()

  if (context) {
    return (
      <AIPageView
        feedState={context.feedState}
        threads={context.threads}
        isThreadsLoading={context.isThreadsLoading}
        selectedModelId={context.selectedModelId}
        setSelectedModelId={context.setSelectedModelId}
        modelsData={context.modelsData}
        searchThreadId={search.threadId}
        autoRun={search.autoRun}
        prompt={search.prompt}
      />
    )
  }

  return <AIPageFallback search={search} />
}
