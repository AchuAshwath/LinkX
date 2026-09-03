import { Calendar, ImageIcon, Plus } from "lucide-react"
import * as React from "react"

import type { Platform } from "@/components/Common/PlatformSelector"
import { Button } from "@/components/ui/button"
import {
  AiDraftButton,
  getAiDraftButtonTitle,
  PencilSparklesIcon,
} from "./AiDraftButton"
import {
  CharacterLimitCircle,
  isCharacterLimitExceeded,
} from "./CharacterLimitCircle"
import { PostSchedulePicker } from "./PostSchedulePicker"

export { AiDraftButton, PencilSparklesIcon, getAiDraftButtonTitle }

interface LeftControlsProps {
  isScheduleOpen: boolean
  isScheduled: boolean
  isSubmitting: boolean
  isAiGenerating?: boolean
  isAiMode?: boolean
  isContentEmpty?: boolean
  scheduledAt?: Date | undefined
  onScheduleChange?: (date: Date | undefined) => void
  onToggleSchedule: (open: boolean) => void
  onActionTypeChange: (type: "draft" | "schedule" | "post") => void
  onImageClick?: () => void
  onToggleAiMode?: () => void
  onAiDraftSubmit?: () => void
}

function ScheduleAndMediaControls({
  isScheduleOpen,
  isScheduled,
  isSubmitting,
  isContentEmpty,
  isAiGenerating,
  isAiMode,
  scheduledAt,
  onScheduleChange,
  onToggleSchedule,
  onActionTypeChange,
  onImageClick,
  onToggleAiMode,
  onAiDraftSubmit,
}: LeftControlsProps) {
  const handleAiDraftClick = () => {
    if (!isContentEmpty && onAiDraftSubmit) {
      onAiDraftSubmit()
    } else {
      onToggleAiMode?.()
    }
  }

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

      <AiDraftButton
        isAiMode={Boolean(isAiMode)}
        isAiGenerating={Boolean(isAiGenerating)}
        isSubmitting={isSubmitting}
        isContentEmpty={Boolean(isContentEmpty)}
        onClick={handleAiDraftClick}
      />
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
  isAiMode?: boolean
  isAiGenerating?: boolean
  onCancelClick?: () => void
  onDraftClick: () => void
  onScheduleClick: () => void
  onPostClick: () => void
  onAiDraftSubmit?: () => void
}

function getPrimaryButtonLabel(
  isAiMode: boolean,
  isAiGenerating: boolean,
  isSubmitting: boolean,
  isScheduled: boolean,
): string {
  if (isAiMode) {
    return isAiGenerating ? "Drafting…" : "Draft"
  }
  if (isSubmitting) {
    return isScheduled ? "Scheduling…" : "Posting…"
  }
  return isScheduled ? "Schedule" : "Post"
}

function getPrimaryButtonHandler(
  isAiMode: boolean,
  isScheduled: boolean,
  onAiDraftSubmit?: () => void,
  onScheduleClick?: () => void,
  onPostClick?: () => void,
): (() => void) | undefined {
  if (isAiMode) return onAiDraftSubmit
  if (isScheduled) return onScheduleClick
  return onPostClick
}

function getPrimaryButtonDisabled(
  isAiMode: boolean,
  isDraftDisabled: boolean,
  isAiGenerating: boolean,
  isScheduleOrPublishDisabled: boolean,
): boolean {
  if (isAiMode) return isDraftDisabled || isAiGenerating
  return isScheduleOrPublishDisabled
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
  isAiMode = false,
  isAiGenerating = false,
  onCancelClick,
  onDraftClick,
  onScheduleClick,
  onPostClick,
  onAiDraftSubmit,
}: ActionButtonsProps) {
  const primaryLabel = getPrimaryButtonLabel(
    isAiMode,
    isAiGenerating,
    isSubmitting,
    isScheduled,
  )

  const handlePrimaryClick = getPrimaryButtonHandler(
    isAiMode,
    isScheduled,
    onAiDraftSubmit,
    onScheduleClick,
    onPostClick,
  )

  const isPrimaryDisabled = getPrimaryButtonDisabled(
    isAiMode,
    isDraftDisabled,
    isAiGenerating,
    isScheduleOrPublishDisabled,
  )

  const buttonStyle = isAiMode
    ? "bg-primary/90 hover:bg-primary text-primary-foreground shadow-xs"
    : "bg-primary text-primary-foreground hover:bg-primary/90 shadow-2xs hover:shadow-sm"

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
        disabled={isDraftDisabled || isAiMode}
        data-testid="save-draft-btn"
      >
        <Plus className="h-3.5 w-3.5 transition-transform duration-200 group-hover:scale-110" />
      </Button>

      <Button
        type="button"
        size="sm"
        onClick={handlePrimaryClick}
        disabled={isPrimaryDisabled}
        className={`h-8.5 min-w-[70px] px-4.5 text-xs font-bold rounded-full transition-all duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] hover:scale-[1.03] active:scale-95 cursor-pointer disabled:opacity-50 disabled:hover:scale-100 ${buttonStyle}`}
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

export interface PostActionBarProps {
  isSubmitting: boolean
  isContentEmpty: boolean
  canPublishOrSchedule?: boolean
  currentLength?: number
  platform?: Platform
  isXPremium?: boolean
  isAiGenerating?: boolean
  isAiMode?: boolean
  onActionTypeChange: (type: "draft" | "schedule" | "post") => void
  onImageClick?: () => void
  onDraftClick: () => void
  onToggleAiMode?: () => void
  onAiDraftSubmit?: () => void
  onScheduleClick: () => void
  onPostClick: () => void
  onCancelClick?: () => void
  showCancel?: boolean
  scheduledAt?: Date | undefined
  onScheduleChange?: (date: Date | undefined) => void
  isScheduleOpen: boolean
  onToggleSchedule: (open: boolean) => void
}

export const PostActionBar = React.memo(function PostActionBar({
  isSubmitting,
  isContentEmpty,
  canPublishOrSchedule = true,
  currentLength = 0,
  platform = "linkx",
  isXPremium = false,
  isAiGenerating = false,
  isAiMode = false,
  onActionTypeChange,
  onImageClick,
  onDraftClick,
  onToggleAiMode,
  onAiDraftSubmit,
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
        isAiMode={isAiMode}
        isContentEmpty={isContentEmpty}
        scheduledAt={scheduledAt}
        onScheduleChange={onScheduleChange}
        onToggleSchedule={onToggleSchedule}
        onActionTypeChange={onActionTypeChange}
        onImageClick={onImageClick}
        onToggleAiMode={onToggleAiMode}
        onAiDraftSubmit={onAiDraftSubmit}
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
        isAiMode={isAiMode}
        isAiGenerating={isAiGenerating}
        onCancelClick={onCancelClick}
        onDraftClick={onDraftClick}
        onScheduleClick={onScheduleClick}
        onPostClick={onPostClick}
        onAiDraftSubmit={onAiDraftSubmit}
      />
    </div>
  )
})

PostActionBar.displayName = "PostActionBar"
