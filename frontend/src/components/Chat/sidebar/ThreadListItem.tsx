import { Archive, Clock, Loader2, MoreHorizontal, Trash2 } from "lucide-react"
import type { ChatThreadPublic } from "@/client"
import { ThreadActionsMenu } from "@/components/Chat/sidebar/ThreadActionsMenu"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export interface ThreadItemActions {
  onSelect: (id: string) => void
  onStartRename: (thread: ChatThreadPublic) => void
  onToggleArchive: (thread: ChatThreadPublic) => void
  onDelete: (thread: ChatThreadPublic) => void
  onToggleMenu: (id: string) => void
}

export function ThreadListItem({
  thread,
  isActive,
  isMenuOpen,
  isStreaming,
  isQueued,
  actions,
}: {
  thread: ChatThreadPublic
  isActive: boolean
  isMenuOpen: boolean
  isStreaming?: boolean
  isQueued?: boolean
  actions: ThreadItemActions
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
        onClick={() => actions.onSelect(thread.id)}
        className="flex flex-1 items-center truncate text-left cursor-pointer min-w-0 pr-2 focus:outline-none py-1 select-none"
      >
        <span
          className={cn(
            "truncate",
            isArchived
              ? "text-xs text-muted-foreground font-normal group-hover:text-foreground"
              : "text-xs text-foreground font-medium",
          )}
        >
          {thread.title}
        </span>
        {isStreaming && (
          <span
            data-testid="thread-generating-badge"
            className="ml-1.5 flex items-center gap-1 text-[10px] font-medium text-primary px-1.5 py-0.5 rounded-md bg-primary/10 shrink-0"
          >
            <Loader2 className="size-2.5 animate-spin" />
            <span className="hidden sm:inline">Generating</span>
          </span>
        )}
        {isQueued && (
          <span
            data-testid="thread-queued-badge"
            className="ml-1.5 flex items-center gap-1 text-[10px] font-medium text-muted-foreground px-1.5 py-0.5 rounded-md bg-muted/60 shrink-0"
          >
            <Clock className="size-2.5" />
            <span className="hidden sm:inline">Queued</span>
          </span>
        )}
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
              actions.onDelete(thread)
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
              actions.onToggleArchive(thread)
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
              actions.onToggleMenu(thread.id)
            }}
          >
            <MoreHorizontal className="size-3" />
          </Button>

          {isMenuOpen && (
            <ThreadActionsMenu
              isArchived={isArchived}
              onToggleArchive={() => actions.onToggleArchive(thread)}
              onStartRename={() => actions.onStartRename(thread)}
              onDelete={() => actions.onDelete(thread)}
            />
          )}
        </div>
      </div>
    </div>
  )
}
