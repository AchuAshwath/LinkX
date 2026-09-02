import { Archive, ArchiveRestore, Pencil, Trash2 } from "lucide-react"

export function ThreadActionsMenu({
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
