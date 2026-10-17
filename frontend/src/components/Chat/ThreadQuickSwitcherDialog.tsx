import { Search } from "lucide-react"
import * as React from "react"
import type { ChatThreadPublic } from "@/client"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

export interface ThreadQuickSwitcherDialogProps {
  isOpen: boolean
  onClose: () => void
  onSelectThread: (threadId: string | null) => void
  threads: ChatThreadPublic[]
}

function filterThreads(
  threads: ChatThreadPublic[],
  query: string,
): ChatThreadPublic[] {
  const trimmed = query.toLowerCase().trim()
  if (!trimmed) return threads
  return threads.filter((t) => (t.title ?? "").toLowerCase().includes(trimmed))
}

function getNextIndex(current: number, max: number): number {
  if (max <= 0) return 0
  if (current >= max) return max - 1
  return current + 1 < max ? current + 1 : current
}

function getPrevIndex(current: number, max?: number): number {
  if (max !== undefined && current >= max) {
    return Math.max(0, max - 1)
  }
  return current > 0 ? current - 1 : 0
}

function isImeEvent(event: React.KeyboardEvent): boolean {
  if (event.nativeEvent?.isComposing) return true
  if ((event as unknown as { isComposing?: boolean }).isComposing) return true
  if (event.key === "Process") return true
  return event.keyCode === 229
}

interface ThreadListItemProps {
  thread: ChatThreadPublic
  isSelected: boolean
  onSelect: () => void
}

function ThreadListItem({ thread, isSelected, onSelect }: ThreadListItemProps) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={isSelected}
      onClick={onSelect}
      className={cn(
        "w-full flex items-center justify-between px-3 py-2 text-sm rounded-md cursor-pointer transition-colors select-none text-left",
        isSelected
          ? "bg-accent text-accent-foreground font-medium"
          : "hover:bg-muted/60 text-foreground",
      )}
    >
      <span className="truncate">{thread.title || "Untitled Thread"}</span>
      {thread.is_archived && (
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider ml-2 shrink-0">
          Archived
        </span>
      )}
    </button>
  )
}

interface ThreadSwitcherListProps {
  filtered: ChatThreadPublic[]
  selectedIndex: number
  onSelect: (threadId: string) => void
}

function ThreadSwitcherList({
  filtered,
  selectedIndex,
  onSelect,
}: ThreadSwitcherListProps) {
  if (filtered.length === 0) {
    return (
      <div className="py-6 text-center text-sm text-muted-foreground">
        No conversations found
      </div>
    )
  }

  return (
    <div role="listbox" className="max-h-72 overflow-y-auto p-1.5 space-y-0.5">
      {filtered.map((thread, index) => (
        <ThreadListItem
          key={thread.id}
          thread={thread}
          isSelected={index === selectedIndex}
          onSelect={() => onSelect(thread.id)}
        />
      ))}
    </div>
  )
}

function useSwitcherKeyboardNav({
  filtered,
  selectedIndex,
  setSelectedIndex,
  handleSelect,
}: {
  filtered: ChatThreadPublic[]
  selectedIndex: number
  setSelectedIndex: React.Dispatch<React.SetStateAction<number>>
  handleSelect: (id: string | null) => void
}) {
  return React.useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (isImeEvent(event)) return

      if (event.key === "ArrowDown") {
        event.preventDefault()
        setSelectedIndex((idx) => getNextIndex(idx, filtered.length))
        return
      }

      if (event.key === "ArrowUp") {
        event.preventDefault()
        setSelectedIndex((idx) => getPrevIndex(idx, filtered.length))
        return
      }

      if (event.key === "Enter") {
        event.preventDefault()
        const target = filtered[selectedIndex]
        if (target) {
          handleSelect(target.id)
        }
      }
    },
    [filtered, selectedIndex, setSelectedIndex, handleSelect],
  )
}

function useThreadQuickSwitcher({
  isOpen,
  onClose,
  onSelectThread,
  threads,
}: ThreadQuickSwitcherDialogProps) {
  const [query, setQuery] = React.useState("")
  const [selectedIndex, setSelectedIndex] = React.useState(0)
  const inputRef = React.useRef<HTMLInputElement>(null)

  const filtered = React.useMemo(
    () => filterThreads(threads, query),
    [threads, query],
  )

  React.useEffect(() => {
    if (isOpen) {
      setQuery("")
      setSelectedIndex(0)
      const timer = setTimeout(() => inputRef.current?.focus(), 50)
      return () => clearTimeout(timer)
    }
  }, [isOpen])

  React.useEffect(() => {
    if (filtered.length > 0 && selectedIndex >= filtered.length) {
      setSelectedIndex(filtered.length - 1)
    }
  }, [filtered.length, selectedIndex])

  const handleSelect = React.useCallback(
    (threadId: string | null) => {
      onSelectThread(threadId)
      onClose()
    },
    [onSelectThread, onClose],
  )

  const handleKeyDown = useSwitcherKeyboardNav({
    filtered,
    selectedIndex,
    setSelectedIndex,
    handleSelect,
  })

  const handleQueryChange = React.useCallback((value: string) => {
    setQuery(value)
    setSelectedIndex(0)
  }, [])

  return {
    query,
    selectedIndex,
    inputRef,
    filtered,
    handleSelect,
    handleKeyDown,
    handleQueryChange,
  }
}

export function ThreadQuickSwitcherDialog(
  props: ThreadQuickSwitcherDialogProps,
) {
  const {
    query,
    selectedIndex,
    inputRef,
    filtered,
    handleSelect,
    handleKeyDown,
    handleQueryChange,
  } = useThreadQuickSwitcher(props)

  return (
    <Dialog
      open={props.isOpen}
      onOpenChange={(open) => !open && props.onClose()}
    >
      <DialogContent className="p-0 gap-0 max-w-lg overflow-hidden sm:max-w-lg">
        <DialogHeader className="sr-only">
          <DialogTitle>Switch Conversation</DialogTitle>
          <DialogDescription>
            Quickly search and switch between conversation threads
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center border-b border-border px-3 py-2.5">
          <Search className="size-4 text-muted-foreground mr-2 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search conversations..."
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            autoFocus
          />
        </div>

        <ThreadSwitcherList
          filtered={filtered}
          selectedIndex={selectedIndex}
          onSelect={handleSelect}
        />
      </DialogContent>
    </Dialog>
  )
}
