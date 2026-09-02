import { Check } from "lucide-react"
import { cn } from "@/lib/utils"

export type SortOption = "recent" | "oldest" | "title" | "messages"

const SORT_OPTIONS: { id: SortOption; label: string }[] = [
  { id: "recent", label: "Most Recent" },
  { id: "oldest", label: "Oldest First" },
  { id: "title", label: "Alphabetical (A–Z)" },
  { id: "messages", label: "Most Messages" },
]

export function SortFilterMenu({
  sortOrder,
  onSelectSort,
}: {
  sortOrder: SortOption
  onSelectSort: (order: SortOption) => void
}) {
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
        {SORT_OPTIONS.map((opt) => (
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
