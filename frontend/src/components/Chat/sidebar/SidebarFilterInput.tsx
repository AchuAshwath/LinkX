import { Search, X } from "lucide-react"

export function SidebarFilterInput({
  searchQuery,
  onSearchChange,
}: {
  searchQuery: string
  onSearchChange: (q: string) => void
}) {
  return (
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
  )
}
