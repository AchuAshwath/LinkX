import { Calendar, ImageIcon, X } from "lucide-react"
import * as React from "react"

import type { Platform } from "@/components/Common/PlatformSelector"
import { Button } from "@/components/ui/button"
import {
  CharacterLimitCircle,
  isCharacterLimitExceeded,
} from "./CharacterLimitCircle"
import { PostSchedulePicker } from "./PostSchedulePicker"

export interface PostActionBarProps {
  isSubmitting: boolean
  isContentEmpty: boolean
  actionType: "draft" | "schedule" | "post"
  canPublishOrSchedule?: boolean
  currentLength?: number
  platform?: Platform
  onActionTypeChange: (type: "draft" | "schedule" | "post") => void
  onImageClick?: () => void
  onDraftClick: () => void
  onScheduleClick: () => void
  onPostClick: () => void
  onCancelClick?: () => void
  showCancel?: boolean
  scheduledAt?: Date | undefined
  onScheduleChange?: (date: Date | undefined) => void
  isScheduleOpen: boolean
  onToggleSchedule: (open: boolean) => void
}

interface LeftControlsProps {
  isScheduleOpen: boolean
  isScheduled: boolean
  isSubmitting: boolean
  scheduledAt?: Date | undefined
  onScheduleChange?: (date: Date | undefined) => void
  onToggleSchedule: (open: boolean) => void
  onActionTypeChange: (type: "draft" | "schedule" | "post") => void
  onImageClick?: () => void
}

function ScheduleAndMediaControls({
  isScheduleOpen,
  isScheduled,
  isSubmitting,
  scheduledAt,
  onScheduleChange,
  onToggleSchedule,
  onActionTypeChange,
  onImageClick,
}: LeftControlsProps) {
  if (!isScheduleOpen) {
    return (
      <div className="flex items-center gap-1.5 min-w-0 flex-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={`h-8.5 w-8.5 rounded-full transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] hover:scale-105 active:scale-95 cursor-pointer ${
            isScheduled
              ? "text-primary bg-primary/15 hover:bg-primary/20 ring-1 ring-primary/30 shadow-xs"
              : "text-muted-foreground hover:text-primary hover:bg-primary/10"
          }`}
          aria-label="Schedule post"
          onClick={() => {
            onToggleSchedule(true)
            onActionTypeChange("schedule")
            if (!scheduledAt) {
              onScheduleChange?.(new Date(Date.now() + 4 * 3600 * 1000))
            }
          }}
          disabled={isSubmitting}
        >
          <Calendar className="h-4.5 w-4.5 transition-transform duration-200 group-hover:scale-110" />
        </Button>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8.5 w-8.5 rounded-full text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] hover:scale-105 active:scale-95 cursor-pointer"
          aria-label="Add media"
          onClick={onImageClick}
          data-testid="add-image-btn"
          disabled={isSubmitting}
        >
          <ImageIcon className="h-4.5 w-4.5" />
        </Button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 flex-wrap min-w-0 flex-1 animate-in fade-in-0 zoom-in-[0.98] slide-in-from-left-3 duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]">
      <PostSchedulePicker
        initialValue={scheduledAt}
        onChangeDateTime={onScheduleChange}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted transition-all duration-200 ease-out hover:rotate-90 active:scale-90 cursor-pointer"
        aria-label="Close schedule"
        onClick={() => {
          onToggleSchedule(false)
          onScheduleChange?.(undefined)
          onActionTypeChange("post")
        }}
      >
        <X className="h-3.5 w-3.5" />
      </Button>

      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-8.5 w-8.5 rounded-full text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] hover:scale-105 active:scale-95 cursor-pointer"
        aria-label="Add media"
        onClick={onImageClick}
        data-testid="add-image-btn"
        disabled={isSubmitting}
      >
        <ImageIcon className="h-4.5 w-4.5" />
      </Button>
    </div>
  )
}

interface ActionButtonsProps {
  isSubmitting: boolean
  isContentEmpty: boolean
  actionType: "draft" | "schedule" | "post"
  isScheduled: boolean
  isDraftDisabled: boolean
  isScheduleOrPublishDisabled: boolean
  showCancel: boolean
  currentLength: number
  platform: Platform
  onCancelClick?: () => void
  onDraftClick: () => void
  onScheduleClick: () => void
  onPostClick: () => void
}

function ActionButtonsGroup({
  isSubmitting,
  actionType,
  isScheduled,
  isDraftDisabled,
  isScheduleOrPublishDisabled,
  showCancel,
  currentLength,
  platform,
  onCancelClick,
  onDraftClick,
  onScheduleClick,
  onPostClick,
}: ActionButtonsProps) {
  const primaryLabel = isSubmitting
    ? isScheduled
      ? "Scheduling…"
      : "Posting…"
    : isScheduled
      ? "Schedule"
      : "Post"

  return (
    <div className="flex items-center gap-2 shrink-0 ml-auto">
      {showCancel && onCancelClick && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onCancelClick}
          className="h-8.5 px-3 text-xs font-semibold rounded-full hover:bg-muted transition-all duration-200 active:scale-95"
          disabled={isSubmitting}
          data-testid="cancel-btn"
        >
          Cancel
        </Button>
      )}

      <CharacterLimitCircle currentLength={currentLength} platform={platform} />

      <Button
        type="button"
        size="sm"
        onClick={onDraftClick}
        disabled={isDraftDisabled}
        className="h-8.5 px-4 text-xs font-bold rounded-full bg-white text-black hover:bg-white/95 border border-zinc-200/90 shadow-2xs hover:shadow-sm transition-all duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] hover:scale-[1.03] active:scale-95 cursor-pointer disabled:opacity-50 disabled:hover:scale-100"
        data-testid="save-draft-btn"
      >
        {isSubmitting && actionType === "draft" ? "Saving…" : "Save"}
      </Button>

      <Button
        type="button"
        size="sm"
        onClick={isScheduled ? onScheduleClick : onPostClick}
        disabled={isScheduleOrPublishDisabled}
        className="h-8.5 min-w-[70px] px-4.5 text-xs font-bold rounded-full bg-primary text-primary-foreground hover:bg-primary/90 shadow-2xs hover:shadow-sm transition-all duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] hover:scale-[1.03] active:scale-95 cursor-pointer disabled:opacity-50 disabled:hover:scale-100"
        data-testid="primary-post-btn"
      >
        <span
          key={primaryLabel}
          className="inline-block animate-in fade-in-0 zoom-in-95 duration-150"
        >
          {primaryLabel}
        </span>
      </Button>
    </div>
  )
}

export const PostActionBar = React.memo(function PostActionBar({
  isSubmitting,
  isContentEmpty,
  actionType,
  canPublishOrSchedule = true,
  currentLength = 0,
  platform = "linkx",
  onActionTypeChange,
  onImageClick,
  onDraftClick,
  onScheduleClick,
  onPostClick,
  onCancelClick,
  showCancel = true,
  scheduledAt,
  onScheduleChange,
  isScheduleOpen,
  onToggleSchedule,
}: PostActionBarProps) {
  const isScheduled = Boolean(scheduledAt || isScheduleOpen)
  const isOverLimit = isCharacterLimitExceeded(currentLength, platform)
  const isDraftDisabled = isContentEmpty || isSubmitting || isOverLimit
  const isScheduleOrPublishDisabled =
    isContentEmpty || isSubmitting || !canPublishOrSchedule || isOverLimit

  return (
    <div className="flex flex-wrap items-center justify-between gap-2.5 w-full">
      <ScheduleAndMediaControls
        isScheduleOpen={isScheduleOpen}
        isScheduled={isScheduled}
        isSubmitting={isSubmitting}
        scheduledAt={scheduledAt}
        onScheduleChange={onScheduleChange}
        onToggleSchedule={onToggleSchedule}
        onActionTypeChange={onActionTypeChange}
        onImageClick={onImageClick}
      />

      <ActionButtonsGroup
        isSubmitting={isSubmitting}
        isContentEmpty={isContentEmpty}
        actionType={actionType}
        isScheduled={isScheduled}
        isDraftDisabled={isDraftDisabled}
        isScheduleOrPublishDisabled={isScheduleOrPublishDisabled}
        showCancel={showCancel}
        currentLength={currentLength}
        platform={platform}
        onCancelClick={onCancelClick}
        onDraftClick={onDraftClick}
        onScheduleClick={onScheduleClick}
        onPostClick={onPostClick}
      />
    </div>
  )
})

PostActionBar.displayName = "PostActionBar"
