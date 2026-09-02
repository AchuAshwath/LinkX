import { ChevronDown } from "lucide-react"

import type { ChatThreadPublic } from "@/client"
import { SidebarControlsHeader } from "@/components/Chat/sidebar/SidebarControlsHeader"
import { SidebarFilterInput } from "@/components/Chat/sidebar/SidebarFilterInput"
import type { SortOption } from "@/components/Chat/sidebar/SortFilterMenu"
import {
  type ThreadItemActions,
  ThreadListItem,
} from "@/components/Chat/sidebar/ThreadListItem"
import { cn } from "@/lib/utils"

export type { SortOption, ThreadItemActions }

function ThreadListSection({
  threads,
  activeThreadId,
  openMenuThreadId,
  isLoading,
  emptyMessage,
  actions,
}: {
  threads: ChatThreadPublic[]
  activeThreadId: string | null
  openMenuThreadId: string | null
  isLoading: boolean
  emptyMessage: string
  actions: ThreadItemActions
}) {
  if (isLoading) {
    return (
      <p className="px-3 py-1.5 text-xs text-muted-foreground animate-pulse">
        Loading chats…
      </p>
    )
  }

  if (threads.length === 0) {
    return (
      <p className="px-3 py-1.5 text-xs text-muted-foreground">
        {emptyMessage}
      </p>
    )
  }

  return (
    <div className="space-y-0.5">
      {threads.map((thread) => (
        <ThreadListItem
          key={thread.id}
          thread={thread}
          isActive={thread.id === activeThreadId}
          isMenuOpen={openMenuThreadId === thread.id}
          actions={actions}
        />
      ))}
    </div>
  )
}

export interface SidebarFilterState {
  searchQuery: string
  isSearchOpen: boolean
  sortOrder: SortOption
  isSortMenuOpen: boolean
  recentsOpen: boolean
  archivedOpen: boolean
}

export interface SidebarFilterHandlers {
  onToggleSearch: () => void
  onSearchChange: (q: string) => void
  onToggleSortMenu: () => void
  onSelectSortOrder: (order: SortOption) => void
  onToggleRecents: () => void
  onToggleArchived: () => void
  onNewChat: () => void
}

export interface AIThreadsSidebarProps {
  recentThreads: ChatThreadPublic[]
  archivedThreads: ChatThreadPublic[]
  activeThreadId: string | null
  openMenuThreadId: string | null
  isLoading: boolean
  filters: SidebarFilterState
  filterHandlers: SidebarFilterHandlers
  actions: ThreadItemActions
}

export function AIThreadsSidebar({
  recentThreads,
  archivedThreads,
  activeThreadId,
  openMenuThreadId,
  isLoading,
  filters,
  filterHandlers,
  actions,
}: AIThreadsSidebarProps) {
  return (
    <div className="hidden w-80 md:block shrink-0">
      <div className="sticky top-0 self-start p-4 flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <SidebarControlsHeader
            isOpen={filters.recentsOpen}
            isSearchOpen={filters.isSearchOpen}
            isSortMenuOpen={filters.isSortMenuOpen}
            searchQuery={filters.searchQuery}
            sortOrder={filters.sortOrder}
            onToggleRecents={filterHandlers.onToggleRecents}
            onToggleSearch={filterHandlers.onToggleSearch}
            onToggleSortMenu={filterHandlers.onToggleSortMenu}
            onSelectSortOrder={filterHandlers.onSelectSortOrder}
            onNewChat={filterHandlers.onNewChat}
          />

          {(filters.isSearchOpen || filters.searchQuery) && (
            <SidebarFilterInput
              searchQuery={filters.searchQuery}
              onSearchChange={filterHandlers.onSearchChange}
            />
          )}

          {filters.recentsOpen && (
            <ThreadListSection
              threads={recentThreads}
              activeThreadId={activeThreadId}
              openMenuThreadId={openMenuThreadId}
              isLoading={isLoading}
              emptyMessage="No recent chats"
              actions={actions}
            />
          )}
        </div>

        <div className="flex flex-col gap-1 border-t border-border/40 pt-2.5">
          <div className="flex items-center justify-between px-2 py-1">
            <button
              type="button"
              onClick={filterHandlers.onToggleArchived}
              className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors cursor-pointer select-none"
            >
              <span>Archived</span>
              <ChevronDown
                className={cn(
                  "size-3.5 text-muted-foreground transition-transform duration-200",
                  !filters.archivedOpen && "-rotate-90",
                )}
              />
            </button>
          </div>

          {filters.archivedOpen && (
            <ThreadListSection
              threads={archivedThreads}
              activeThreadId={activeThreadId}
              openMenuThreadId={openMenuThreadId}
              isLoading={isLoading}
              emptyMessage="No archived chats"
              actions={actions}
            />
          )}
        </div>
      </div>
    </div>
  )
}
