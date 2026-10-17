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
        "inline-flex items-center gap-0.5 text-xs text-muted-foreground select-none",
        className,
      )}
    >
      <button
        type="button"
        aria-label="Previous version"
        disabled={isFirst}
        onClick={onPrevious}
        className={cn(
          "flex size-5 items-center justify-center rounded text-muted-foreground/70 transition-colors",
          isFirst
            ? "opacity-30 cursor-not-allowed"
            : "hover:text-foreground cursor-pointer active:scale-95",
        )}
      >
        <ChevronLeft className="size-3.5" />
      </button>

      <span className="px-0.5 text-[11px] tabular-nums font-normal text-muted-foreground/80">
        {currentIndex} of {totalVersions}
      </span>

      <button
        type="button"
        aria-label="Next version"
        disabled={isLast}
        onClick={onNext}
        className={cn(
          "flex size-5 items-center justify-center rounded text-muted-foreground/70 transition-colors",
          isLast
            ? "opacity-30 cursor-not-allowed"
            : "hover:text-foreground cursor-pointer active:scale-95",
        )}
      >
        <ChevronRight className="size-3.5" />
      </button>
    </div>
  )
}
