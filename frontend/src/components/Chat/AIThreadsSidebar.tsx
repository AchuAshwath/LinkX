import {
  Archive,
  ArchiveRestore,
  Check,
  ChevronDown,
  MoreHorizontal,
  Pencil,
  Search,
  SquarePen,
  Trash2,
  X,
} from "lucide-react"

import type { ChatThreadPublic } from "@/client"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export type SortOption = "recent" | "oldest" | "title" | "messages"

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

function SortFilterMenu({
  sortOrder,
  onSelectSort,
}: {
  sortOrder: SortOption
  onSelectSort: (order: SortOption) => void
}) {
  const options: { id: SortOption; label: string }[] = [
    { id: "recent", label: "Most Recent" },
    { id: "oldest", label: "Oldest First" },
    { id: "title", label: "Alphabetical (A–Z)" },
    { id: "messages", label: "Most Messages" },
  ]

  return (
    <div
      role="menu"
      tabIndex={-1}
      className="absolute right-0 top-8 z-50 min-w-44 rounded-2xl border border-border bg-popover p-1 shadow-md animate-in fade-in-0 zoom-in-95 text-xs"
    >
      <div className="px-2.5 py-1.5 font-semibold text-muted-foreground text-[11px] border-b border-border/40 select-none">
        Sort by
      </div>
      <div className="p-0.5 space-y-0.5">
        {options.map((opt) => (
          <button
            key={opt.id}
            type="button"
            role="menuitem"
            onClick={(e) => {
              e.stopPropagation()
              onSelectSort(opt.id)
            }}
            className={cn(
              "flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-xs transition-colors cursor-pointer",
              sortOrder === opt.id
                ? "bg-accent text-accent-foreground font-semibold"
                : "text-popover-foreground hover:bg-accent/60 hover:text-accent-foreground font-medium",
            )}
          >
            <span>{opt.label}</span>
            {sortOrder === opt.id && (
              <Check className="size-3.5 text-primary" />
            )}
          </button>
        ))}
      </div>
    </div>
  )
}

export function ThreadListItem({
  thread,
  isActive,
  isMenuOpen,
  onSelect,
  onStartRename,
  onToggleArchive,
  onDelete,
  onToggleMenu,
}: {
  thread: ChatThreadPublic
  isActive: boolean
  isMenuOpen: boolean
  onSelect: () => void
  onStartRename: () => void
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

export interface AIThreadsSidebarProps {
  recentThreads: ChatThreadPublic[]
  archivedThreads: ChatThreadPublic[]
  activeThreadId: string | null
  openMenuThreadId: string | null
  isLoading: boolean
  sortOrder: SortOption
  searchQuery: string
  isSearchOpen: boolean
  isSortMenuOpen: boolean
  recentsOpen: boolean
  archivedOpen: boolean
  onSelectThread: (threadId: string) => void
  onNewChat: () => void
  onStartRename: (thread: ChatThreadPublic) => void
  onToggleArchive: (thread: ChatThreadPublic) => void
  onDeleteThread: (thread: ChatThreadPublic) => void
  onToggleMenu: (threadId: string) => void
  onToggleSearch: () => void
  onSearchChange: (q: string) => void
  onToggleSortMenu: () => void
  onSelectSortOrder: (order: SortOption) => void
  onToggleRecents: () => void
  onToggleArchived: () => void
}

export function AIThreadsSidebar({
  recentThreads,
  archivedThreads,
  activeThreadId,
  openMenuThreadId,
  isLoading,
  sortOrder,
  searchQuery,
  isSearchOpen,
  isSortMenuOpen,
  recentsOpen,
  archivedOpen,
  onSelectThread,
  onNewChat,
  onStartRename,
  onToggleArchive,
  onDeleteThread,
  onToggleMenu,
  onToggleSearch,
  onSearchChange,
  onToggleSortMenu,
  onSelectSortOrder,
  onToggleRecents,
  onToggleArchived,
}: AIThreadsSidebarProps) {
  return (
    <div className="hidden w-80 md:block shrink-0">
      <div className="sticky top-0 self-start p-4 flex flex-col gap-4">
        {/* Recents Section */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between px-2 py-1">
            <button
              type="button"
              onClick={onToggleRecents}
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
                aria-label="Filter chats"
                onClick={onToggleSearch}
                className={cn(
                  "size-7 rounded-full cursor-pointer transition-colors",
                  isSearchOpen || searchQuery
                    ? "bg-muted/80 text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Search className="size-3.5" />
              </Button>

              <div className="relative">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Sort options"
                  onClick={(e) => {
                    e.stopPropagation()
                    onToggleSortMenu()
                  }}
                  className={cn(
                    "size-7 rounded-full cursor-pointer transition-colors",
                    isSortMenuOpen
                      ? "bg-muted/80 text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <MoreHorizontal className="size-3.5" />
                </Button>
                {isSortMenuOpen && (
                  <SortFilterMenu
                    sortOrder={sortOrder}
                    onSelectSort={onSelectSortOrder}
                  />
                )}
              </div>

              <Button
                variant="ghost"
                size="icon"
                aria-label="New chat"
                onClick={onNewChat}
                className="size-7 text-muted-foreground hover:text-foreground rounded-full cursor-pointer"
              >
                <SquarePen className="size-3.5" />
              </Button>
            </div>
          </div>

          {(isSearchOpen || searchQuery) && (
            <div className="px-1 py-1 animate-in fade-in-0 duration-150">
              <div className="relative flex items-center">
                <Search className="absolute left-2.5 size-3 text-muted-foreground pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => onSearchChange(e.target.value)}
                  placeholder="Filter chats…"
                  className="w-full rounded-lg bg-muted/30 border border-border/60 pl-7 pr-7 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
                {searchQuery && (
                  <button
                    type="button"
                    aria-label="Clear filter"
                    onClick={() => onSearchChange("")}
                    className="absolute right-2 text-muted-foreground hover:text-foreground cursor-pointer"
                  >
                    <X className="size-3" />
                  </button>
                )}
              </div>
            </div>
          )}

          {recentsOpen && (
            <div className="space-y-0.5">
              {isLoading ? (
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
                    isMenuOpen={openMenuThreadId === thread.id}
                    onSelect={() => onSelectThread(thread.id)}
                    onStartRename={() => onStartRename(thread)}
                    onToggleArchive={() => onToggleArchive(thread)}
                    onDelete={() => onDeleteThread(thread)}
                    onToggleMenu={() => onToggleMenu(thread.id)}
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
              onClick={onToggleArchived}
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
                    isMenuOpen={openMenuThreadId === thread.id}
                    onSelect={() => onSelectThread(thread.id)}
                    onStartRename={() => onStartRename(thread)}
                    onToggleArchive={() => onToggleArchive(thread)}
                    onDelete={() => onDeleteThread(thread)}
                    onToggleMenu={() => onToggleMenu(thread.id)}
                  />
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
