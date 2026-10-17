import { ChevronLeft, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"

export interface BranchSwitcherProps {
  currentIndex: number
  totalVersions: number
  onPrevious: () => void
  onNext: () => void
  className?: string
  disabled?: boolean
}

export function BranchSwitcher({
  currentIndex,
  totalVersions,
  onPrevious,
  onNext,
  className,
  disabled = false,
}: BranchSwitcherProps) {
  if (totalVersions <= 1) return null

  const isFirst = currentIndex <= 1
  const isLast = currentIndex >= totalVersions
  const disablePrev = disabled || isFirst
  const disableNext = disabled || isLast

  return (
    <div
      data-slot="branch-switcher"
      className={cn(
        "inline-flex items-center gap-0.5 select-none text-xs text-muted-foreground",
        className,
      )}
    >
      <button
        type="button"
        aria-label="Previous version"
        disabled={disablePrev}
        onClick={onPrevious}
        className="flex size-6 items-center justify-center rounded-md text-muted-foreground/70 hover:bg-muted/60 hover:text-foreground transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
      >
        <ChevronLeft className="size-3.5" />
      </button>

      <span className="px-0.5 text-[11px] font-normal tabular-nums text-muted-foreground/70">
        {currentIndex}/{totalVersions}
      </span>

      <button
        type="button"
        aria-label="Next version"
        disabled={disableNext}
        onClick={onNext}
        className="flex size-6 items-center justify-center rounded-md text-muted-foreground/70 hover:bg-muted/60 hover:text-foreground transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
      >
        <ChevronRight className="size-3.5" />
      </button>
    </div>
  )
}
