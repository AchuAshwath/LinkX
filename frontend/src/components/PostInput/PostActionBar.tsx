"use client"

import {
  Calendar,
  ChevronDown,
  FileText,
  ImageIcon,
  Send,
  Smile,
} from "lucide-react"
import * as React from "react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export interface PostActionBarProps {
  isSubmitting: boolean
  isContentEmpty: boolean
  actionType: "draft" | "schedule" | "post"
  onActionTypeChange: (type: "draft" | "schedule" | "post") => void
  onImageClick?: () => void
  onEmojiClick?: () => void
  onDraftClick: () => void
  onScheduleClick: () => void
  onPostClick: () => void
  onCancelClick?: () => void
  showCancel?: boolean
}

export const PostActionBar = React.memo(function PostActionBar({
  isSubmitting,
  isContentEmpty,
  actionType,
  onActionTypeChange,
  onImageClick,
  onEmojiClick,
  onDraftClick,
  onScheduleClick,
  onPostClick,
  onCancelClick,
  showCancel = true,
}: PostActionBarProps) {
  const buttonLabel = React.useMemo(() => {
    if (isSubmitting) {
      if (actionType === "draft") return "Saving…"
      if (actionType === "schedule") return "Scheduling…"
      return "Posting…"
    }
    if (actionType === "draft") return "Save as Draft"
    if (actionType === "schedule") return "Schedule"
    return "Post"
  }, [isSubmitting, actionType])

  const buttonIcon = React.useMemo(() => {
    if (isSubmitting) return null
    if (actionType === "draft") return <FileText className="h-4 w-4" />
    if (actionType === "schedule") return <Calendar className="h-4 w-4" />
    return <Send className="h-4 w-4" />
  }, [isSubmitting, actionType])

  const isDisabled = isContentEmpty || isSubmitting

  return (
    <>
      {/* Left: Icon Action Buttons */}
      <div className="flex items-center gap-1 shrink-0">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-10 w-10 rounded-full hover:bg-accent active:scale-95 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 transition-colors sm:h-9 sm:w-9"
          aria-label="Add image"
          onClick={onImageClick}
          data-testid="add-image-btn"
          disabled={isSubmitting}
        >
          <ImageIcon className="h-5 w-5 sm:h-[18px] sm:w-[18px]" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-10 w-10 rounded-full hover:bg-accent active:scale-95 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 transition-colors sm:h-9 sm:w-9"
          aria-label="Add emoji"
          onClick={onEmojiClick}
          data-testid="add-emoji-btn"
          disabled={isSubmitting}
        >
          <Smile className="h-5 w-5 sm:h-[18px] sm:w-[18px]" />
        </Button>
      </div>

      {/* Right: Action Buttons */}
      <div className="flex items-center gap-2 shrink-0 ml-auto">
        {showCancel && onCancelClick && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onCancelClick}
            className="px-4 font-medium focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1"
            disabled={isSubmitting}
            data-testid="cancel-btn"
          >
            Cancel
          </Button>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              size="sm"
              className="bg-primary px-4 font-medium text-primary-foreground transition-colors hover:bg-primary/90 active:scale-95 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1"
              disabled={isDisabled}
              data-testid="post-action-dropdown"
            >
              <span className="flex items-center gap-2">
                {buttonIcon}
                <span className="hidden sm:inline">{buttonLabel}</span>
                <span className="inline sm:hidden">Post</span>
                <ChevronDown className="h-3.5 w-3.5 opacity-70" />
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem
              onClick={() => {
                onActionTypeChange("draft")
                onDraftClick()
              }}
              disabled={isDisabled}
              className="cursor-pointer"
            >
              <FileText className="mr-2 h-4 w-4" />
              <span>Save as Draft</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                onActionTypeChange("schedule")
                onScheduleClick()
              }}
              disabled={isDisabled}
              className="cursor-pointer"
            >
              <Calendar className="mr-2 h-4 w-4" />
              <span>Schedule</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => {
                onActionTypeChange("post")
                onPostClick()
              }}
              disabled={isDisabled}
              className="cursor-pointer"
            >
              <Send className="mr-2 h-4 w-4" />
              <span>Post Now</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </>
  )
})

PostActionBar.displayName = "PostActionBar"
