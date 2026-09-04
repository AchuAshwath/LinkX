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

interface AISearchParams {
  threadId?: string
  prompt?: string
  autoRun?: boolean
}

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

const AI_MODEL_STORAGE_KEY = "linkx_ai_selected_model"

function getStoredModel(): string | null {
  try {
    return window?.localStorage?.getItem(AI_MODEL_STORAGE_KEY) ?? null
  } catch {
    return null
  }
}

function persistStoredModel(modelId: string): void {
  try {
    window?.localStorage?.setItem(AI_MODEL_STORAGE_KEY, modelId)
  } catch {
    // ignore
  }
}

function getInitialStoredModel(): string {
  const saved = getStoredModel()
  if (saved && !saved.startsWith("gemini")) return saved
  return "gpt-5.4"
}

function resolveFallbackModel(modelsData?: {
  default_model?: string | null
  data?: { id: string }[]
}): string {
  return modelsData?.default_model || modelsData?.data?.[0]?.id || "gpt-5.4"
}

function computeReconciledModel(modelsData?: {
  default_model?: string | null
  data?: { id: string }[]
}): string | null {
  if (!modelsData) return null
  const saved = getStoredModel()
  if (!saved || saved.startsWith("gemini")) {
    return resolveFallbackModel(modelsData)
  }
  const available = modelsData.data ?? []
  if (available.length > 0 && !available.some((m) => m.id === saved)) {
    return resolveFallbackModel(modelsData)
  }
  return null
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

function getUrlSearchParams(): AISearchParams {
  if (typeof window === "undefined") return {}
  try {
    const params = new URLSearchParams(window.location.search)
    return {
      threadId: params.get("threadId") || undefined,
      prompt: params.get("prompt") || undefined,
      autoRun: params.get("autoRun") === "true",
    }
  } catch {
    return {}
  }
}

function syncBrowserUrl(activeThreadId: string | null) {
  if (typeof window === "undefined") return
  try {
    const url = new URL(window.location.href)
    let changed = false
    if (url.searchParams.has("autoRun")) {
      url.searchParams.delete("autoRun")
      changed = true
    }
    if (url.searchParams.has("prompt")) {
      url.searchParams.delete("prompt")
      changed = true
    }
    const currentParam = url.searchParams.get("threadId")
    if (activeThreadId && currentParam !== activeThreadId) {
      url.searchParams.set("threadId", activeThreadId)
      changed = true
    } else if (!activeThreadId && currentParam) {
      url.searchParams.delete("threadId")
      changed = true
    }
    if (changed) {
      window.history.replaceState({}, "", url.pathname + url.search)
    }
  } catch {
    // ignore
  }
}

function useAutoRunPrompt({
  autoRun,
  prompt,
  handleSendMessage,
}: {
  autoRun?: boolean
  prompt?: string
  handleSendMessage: (text: string) => void
}) {
  const executedRef = React.useRef(false)
  React.useEffect(() => {
    if (!autoRun || !prompt || executedRef.current) return
    executedRef.current = true
    handleSendMessage(prompt)
  }, [autoRun, prompt, handleSendMessage])
}

function useAIModelSelection() {
  const { data: modelsData } = useQuery({
    queryKey: ["ai-models"],
    queryFn: () => AiThreadsService.listAiModels(),
  })

  const [selectedModelId, setSelectedModelIdState] = React.useState<string>(
    getInitialStoredModel,
  )

  const setSelectedModelId = React.useCallback((modelId: string) => {
    setSelectedModelIdState(modelId)
    persistStoredModel(modelId)
  }, [])

  React.useEffect(() => {
    const nextModel = computeReconciledModel(modelsData)
    if (nextModel) setSelectedModelId(nextModel)
  }, [modelsData, setSelectedModelId])

  return { selectedModelId, setSelectedModelId, modelsData }
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
  handleSendMessage: (text: string, images?: File[]) => Promise<void>
  handleQuestionAnswer: (id: string, answers: any[]) => void
  stopStream: () => void
}

function AIChatCenterColumn({
  activeThreadId,
  localMessages,
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
        isStreaming={isCurrentThreadStreaming}
        pendingQuestion={pendingQuestion}
        onSendMessage={handleSendMessage}
        onQuestionAnswer={handleQuestionAnswer}
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
          autoFocus
        />
      </div>
    </div>
  )
}

function AIPage() {
  const search = React.useMemo(() => getUrlSearchParams(), [])
  const queryClient = useQueryClient()
  const promptInputRef = React.useRef<HTMLTextAreaElement>(null)
  const [openMenuThreadId, setOpenMenuThreadId] = React.useState<string | null>(
    null,
  )

  const { selectedModelId, setSelectedModelId, modelsData } =
    useAIModelSelection()

  const { data: threadsData, isLoading: isThreadsLoading } = useQuery({
    queryKey: ["ai-threads"],
    queryFn: () => AiThreadsService.listChatThreads({ skip: 0, limit: 100 }),
  })

  const threads = threadsData?.data ?? []

  const feedState = useAIChatFeedState({
    threads,
    selectedModelId,
    initialThreadId: search.threadId,
  })

  const sidebarFilters = useThreadSidebarFilters(threads)

  const mutations = useThreadMutations({
    queryClient,
    activeThreadId: feedState.activeThreadId,
    setActiveThreadId: feedState.setActiveThreadId,
    threads,
    handleThreadDeleted: feedState.handleThreadDeleted,
  })

  const isCurrentThreadStreaming = feedState.isThreadStreaming(
    feedState.activeThreadId,
  )
  const isCurrentThreadQueued = feedState.isThreadQueued(
    feedState.activeThreadId,
  )
  const isCurrentThreadBusy = isCurrentThreadStreaming || isCurrentThreadQueued

  useAutoRunPrompt({
    autoRun: search.autoRun,
    prompt: search.prompt,
    handleSendMessage: feedState.handleSendMessage,
  })

  React.useEffect(() => {
    syncBrowserUrl(feedState.activeThreadId)
  }, [feedState.activeThreadId])

  React.useEffect(() => {
    function handleClickOutside() {
      setOpenMenuThreadId(null)
      sidebarFilters.setIsSortMenuOpen(false)
    }
    if (openMenuThreadId || sidebarFilters.isSortMenuOpen) {
      document.addEventListener("click", handleClickOutside)
      return () => document.removeEventListener("click", handleClickOutside)
    }
  }, [
    openMenuThreadId,
    sidebarFilters.isSortMenuOpen,
    sidebarFilters.setIsSortMenuOpen,
  ])

  function onNewChatClick() {
    feedState.handleNewChat()
    setTimeout(() => promptInputRef.current?.focus(), 50)
  }

  return (
    <div className="flex w-full h-[calc(100vh-3.5rem)] lg:h-screen overflow-hidden bg-background text-foreground">
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

      <AIChatCenterColumn
        activeThreadId={feedState.activeThreadId}
        localMessages={feedState.localMessages}
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
