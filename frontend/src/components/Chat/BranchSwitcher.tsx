import { ChevronLeft, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"

export interface BranchSwitcherProps {
  currentIndex: number
  totalVersions: number
  onPrevious: () => void
  onNext: () => void
  className?: string
}

export function BranchSwitcher({
  currentIndex,
  totalVersions,
  onPrevious,
  onNext,
  className,
}: BranchSwitcherProps) {
  if (totalVersions <= 1) return null

  const isFirst = currentIndex <= 1
  const isLast = currentIndex >= totalVersions

  return (
    <div
      data-slot="branch-switcher"
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full border border-border/40 bg-muted/40 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground select-none transition-colors",
        className,
      )}
    >
      <button
        type="button"
        aria-label="Previous version"
        disabled={isFirst}
        onClick={onPrevious}
        className={cn(
          "flex size-4.5 items-center justify-center rounded-full transition-colors",
          isFirst
            ? "opacity-30 cursor-not-allowed text-muted-foreground"
            : "hover:bg-muted/80 hover:text-foreground cursor-pointer active:scale-95",
        )}
      >
        <ChevronLeft className="size-3" />
      </button>

      <span className="px-1 text-[10px] tabular-nums tracking-tight">
        {currentIndex} of {totalVersions}
      </span>

      <button
        type="button"
        aria-label="Next version"
        disabled={isLast}
        onClick={onNext}
        className={cn(
          "flex size-4.5 items-center justify-center rounded-full transition-colors",
          isLast
            ? "opacity-30 cursor-not-allowed text-muted-foreground"
            : "hover:bg-muted/80 hover:text-foreground cursor-pointer active:scale-95",
        )}
      >
        <ChevronRight className="size-3" />
      </button>
    </div>
  )
}
