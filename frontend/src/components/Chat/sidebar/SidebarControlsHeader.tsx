import { ChevronDown, MoreHorizontal, Search, SquarePen } from "lucide-react"
import {
  SortFilterMenu,
  type SortOption,
} from "@/components/Chat/sidebar/SortFilterMenu"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export function SidebarControlsHeader({
  isOpen,
  isSearchOpen,
  isSortMenuOpen,
  searchQuery,
  sortOrder,
  onToggleRecents,
  onToggleSearch,
  onToggleSortMenu,
  onSelectSortOrder,
  onNewChat,
}: {
  isOpen: boolean
  isSearchOpen: boolean
  isSortMenuOpen: boolean
  searchQuery: string
  sortOrder: SortOption
  onToggleRecents: () => void
  onToggleSearch: () => void
  onToggleSortMenu: () => void
  onSelectSortOrder: (o: SortOption) => void
  onNewChat: () => void
}) {
  return (
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
            !isOpen && "-rotate-90",
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
  )
}
