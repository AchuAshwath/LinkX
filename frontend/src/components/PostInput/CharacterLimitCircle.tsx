import * as React from "react"
import type { Platform } from "@/components/Common/PlatformSelector"
import { cn } from "@/lib/utils"

export interface CharacterLimitCircleProps {
  currentLength: number
  platform: Platform
  className?: string
}

const RADIUS = 10
const CIRCUMFERENCE = 2 * Math.PI * RADIUS // ~62.831853

export function getCharacterLimit(platform: Platform): number {
  return platform === "linkedin" ? 3000 : 280
}

export function getWarnThreshold(platform: Platform): number {
  return platform === "linkedin" ? 100 : 20
}

export function isCharacterLimitExceeded(
  currentLength: number,
  platform: Platform,
): boolean {
  return currentLength > getCharacterLimit(platform)
}

function getGaugeColorClasses(isOverLimit: boolean, isWarning: boolean) {
  if (isOverLimit) {
    return {
      stroke: "text-destructive",
      text: "text-destructive",
    }
  }
  if (isWarning) {
    return {
      stroke: "text-amber-500",
      text: "text-amber-500 font-semibold",
    }
  }
  return {
    stroke: "text-primary",
    text: "text-muted-foreground",
  }
}

export const CharacterLimitCircle = React.memo(function CharacterLimitCircle({
  currentLength,
  platform,
  className,
}: CharacterLimitCircleProps) {
  const maxLimit = getCharacterLimit(platform)
  const warnThreshold = getWarnThreshold(platform)
  const remaining = maxLimit - currentLength
  const isOverLimit = remaining < 0
  const isWarning = remaining <= warnThreshold && remaining >= 0
  const showText = remaining <= warnThreshold

  const percentage = Math.min(
    100,
    Math.max(0, (currentLength / maxLimit) * 100),
  )
  const offset = CIRCUMFERENCE * (1 - percentage / 100)

  const colors = getGaugeColorClasses(isOverLimit, isWarning)

  return (
    <div
      className={cn(
        "relative inline-flex items-center justify-center shrink-0 w-7 h-7 select-none",
        className,
      )}
      role="progressbar"
      aria-label={`Character count: ${currentLength}/${maxLimit}`}
      aria-valuenow={currentLength}
      aria-valuemax={maxLimit}
      title={`${currentLength}/${maxLimit} characters`}
      data-testid="character-limit-gauge"
    >
      <svg
        className="w-full h-full -rotate-90 transform"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        {/* Background track circle */}
        <circle
          cx="12"
          cy="12"
          r={RADIUS}
          stroke="currentColor"
          strokeWidth="2"
          fill="none"
          className="text-muted/30 dark:text-muted/40"
        />
        {/* Active progress circle */}
        <circle
          cx="12"
          cy="12"
          r={RADIUS}
          stroke="currentColor"
          strokeWidth="2"
          fill="none"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className={cn(
            colors.stroke,
            "transition-[stroke-dashoffset,stroke] duration-150 ease-out",
          )}
        />
      </svg>

      {showText && (
        <span
          className={cn(
            "absolute inset-0 flex items-center justify-center text-[10px] leading-none tracking-tighter tabular-nums",
            colors.text,
          )}
          data-testid={
            isOverLimit ? "character-limit-exceeded" : "character-limit-warning"
          }
        >
          {remaining}
        </span>
      )}
    </div>
  )
})

CharacterLimitCircle.displayName = "CharacterLimitCircle"
