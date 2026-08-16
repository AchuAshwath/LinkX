import { Bot, Calendar, ImageIcon, Plus } from "lucide-react"
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
  canPublishOrSchedule?: boolean
  currentLength?: number
  platform?: Platform
  isXPremium?: boolean
  isAiGenerating?: boolean
  onActionTypeChange: (type: "draft" | "schedule" | "post") => void
  onImageClick?: () => void
  onDraftClick: () => void
  onAiDraftClick?: () => void
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
  isAiGenerating?: boolean
  scheduledAt?: Date | undefined
  onScheduleChange?: (date: Date | undefined) => void
  onToggleSchedule: (open: boolean) => void
  onActionTypeChange: (type: "draft" | "schedule" | "post") => void
  onImageClick?: () => void
  onAiDraftClick?: () => void
}

function ScheduleAndMediaControls({
  isScheduleOpen,
  isScheduled,
  isSubmitting,
  isAiGenerating,
  scheduledAt,
  onScheduleChange,
  onToggleSchedule,
  onActionTypeChange,
  onImageClick,
  onAiDraftClick,
}: LeftControlsProps) {
  const mediaAndAiButtons = (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="-ml-2 h-8.5 w-8.5 rounded-full text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] hover:scale-105 active:scale-95 cursor-pointer shrink-0"
        aria-label="Add media"
        title="Add media"
        onClick={onImageClick}
        data-testid="add-image-btn"
        disabled={isSubmitting}
      >
        <ImageIcon className="h-4.5 w-4.5" />
      </Button>

      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={`h-8.5 w-8.5 rounded-full transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] hover:scale-105 active:scale-95 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shrink-0 ${
          isAiGenerating
            ? "text-primary bg-primary/15 animate-pulse"
            : "text-muted-foreground hover:text-primary hover:bg-primary/10"
        }`}
        aria-label="Draft with AI"
        title="Draft with AI"
        onClick={onAiDraftClick}
        disabled={isSubmitting || isAiGenerating}
        data-testid="ai-draft-btn"
      >
        <Bot
          className={`h-4.5 w-4.5 transition-transform duration-200 ${
            isAiGenerating ? "animate-spin" : "group-hover:scale-110"
          }`}
        />
      </Button>
    </>
  )

  if (!isScheduleOpen) {
    return (
      <div className="flex items-center gap-1 min-w-0">
        {mediaAndAiButtons}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={`h-8.5 w-8.5 rounded-full transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] hover:scale-105 active:scale-95 cursor-pointer shrink-0 ${
            isScheduled
              ? "text-primary bg-primary/15 hover:bg-primary/20 ring-1 ring-primary/30 shadow-xs"
              : "text-muted-foreground hover:text-primary hover:bg-primary/10"
          }`}
          aria-label="Schedule post"
          title="Schedule post"
          onClick={() => {
            onToggleSchedule(true)
            onActionTypeChange("schedule")
            if (!scheduledAt) {
              onScheduleChange?.(new Date(Date.now() + 2 * 3600 * 1000))
            }
          }}
          disabled={isSubmitting}
          data-testid="schedule-post-btn"
        >
          <Calendar className="h-4.5 w-4.5 transition-transform duration-200 group-hover:scale-110" />
        </Button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1.5 min-w-0 animate-in fade-in-0 slide-in-from-left-1 duration-150">
      {mediaAndAiButtons}
      <PostSchedulePicker
        initialValue={scheduledAt}
        onChangeDateTime={onScheduleChange}
      />
    </div>
  )
}

interface ActionButtonsProps {
  isSubmitting: boolean
  isScheduled: boolean
  isDraftDisabled: boolean
  isScheduleOrPublishDisabled: boolean
  showCancel: boolean
  currentLength: number
  platform: Platform
  isXPremium?: boolean
  onCancelClick?: () => void
  onDraftClick: () => void
  onScheduleClick: () => void
  onPostClick: () => void
}

function ActionButtonsGroup({
  isSubmitting,
  isScheduled,
  isDraftDisabled,
  isScheduleOrPublishDisabled,
  showCancel,
  currentLength,
  platform,
  isXPremium,
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

      <CharacterLimitCircle
        currentLength={currentLength}
        platform={platform}
        isXPremium={isXPremium}
      />

      {/* Subtle vertical separator like Twitter/X */}
      <div className="h-4 w-px bg-border/60 mx-0.5 shrink-0" />

      {/* Save Draft Circular Button - Tooltip: "Add to draft" */}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7 rounded-full border border-border/70 hover:border-primary/70 text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] hover:scale-105 active:scale-95 cursor-pointer disabled:opacity-30 disabled:hover:scale-100 disabled:cursor-not-allowed shrink-0 p-0"
        aria-label="Add to draft"
        title="Add to draft"
        onClick={onDraftClick}
        disabled={isDraftDisabled}
        data-testid="save-draft-btn"
      >
        <Plus className="h-3.5 w-3.5 transition-transform duration-200 group-hover:scale-110" />
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
  canPublishOrSchedule = true,
  currentLength = 0,
  platform = "linkx",
  isXPremium = false,
  isAiGenerating = false,
  onActionTypeChange,
  onImageClick,
  onDraftClick,
  onAiDraftClick,
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
  const isOverLimit = isCharacterLimitExceeded(
    currentLength,
    platform,
    isXPremium,
  )
  const isDraftDisabled = isContentEmpty || isSubmitting || isOverLimit
  const isScheduleOrPublishDisabled =
    isContentEmpty || isSubmitting || !canPublishOrSchedule || isOverLimit

  return (
    <div className="flex items-center justify-between gap-2 w-full min-w-0 flex-nowrap">
      <ScheduleAndMediaControls
        isScheduleOpen={isScheduleOpen}
        isScheduled={isScheduled}
        isSubmitting={isSubmitting}
        isAiGenerating={isAiGenerating}
        scheduledAt={scheduledAt}
        onScheduleChange={onScheduleChange}
        onToggleSchedule={onToggleSchedule}
        onActionTypeChange={onActionTypeChange}
        onImageClick={onImageClick}
        onAiDraftClick={onAiDraftClick}
      />

      <ActionButtonsGroup
        isSubmitting={isSubmitting}
        isScheduled={isScheduled}
        isDraftDisabled={isDraftDisabled}
        isScheduleOrPublishDisabled={isScheduleOrPublishDisabled}
        showCancel={showCancel}
        currentLength={currentLength}
        platform={platform}
        isXPremium={isXPremium}
        onCancelClick={onCancelClick}
        onDraftClick={onDraftClick}
        onScheduleClick={onScheduleClick}
        onPostClick={onPostClick}
      />
    </div>
  )
})

PostActionBar.displayName = "PostActionBar"
