"use client"

import * as React from "react"

import { PlatformSelector } from "@/components/Common/PlatformSelector"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Textarea } from "@/components/ui/textarea"
import { PostActionBar } from "./PostActionBar"
import { formatDateTime, PostSchedulePicker } from "./PostSchedulePicker"
import { usePostForm } from "./usePostForm"

interface PostInputBoxProps {
  username: string
  avatarUrl?: string
  initialContent?: string
  onSubmit?: () => void
  onCancel?: () => void
  canPublishOrSchedule?: boolean
}

export function PostInputBox({
  username,
  avatarUrl,
  initialContent,
  onSubmit,
  onCancel,
  canPublishOrSchedule = true,
}: PostInputBoxProps) {
  const {
    content,
    setContent,
    scheduledAt,
    setScheduledAt,
    channel,
    setChannel,
    actionType,
    setActionType,
    handleSubmit,
    handleContentChange,
    createPostMutation,
  } = usePostForm()

  // Sync initialContent when provided
  React.useEffect(() => {
    if (initialContent !== undefined && initialContent !== "") {
      setContent(initialContent)
    }
  }, [initialContent, setContent])

  // Call onSubmit callback if provided
  React.useEffect(() => {
    if (createPostMutation.isSuccess) {
      onSubmit?.()
    }
  }, [createPostMutation.isSuccess, onSubmit])

  const initials =
    username
      .split(" ")
      .map((part) => part[0])
      .join("")
      .toUpperCase() || "U"

  return (
    <div className="w-full space-y-4">
      {/* Header: Avatar + Username + Channel Selector */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <Avatar className="h-9 w-9 shrink-0">
            {avatarUrl ? <AvatarImage src={avatarUrl} alt={username} /> : null}
            <AvatarFallback className="text-xs font-semibold">
              {initials}
            </AvatarFallback>
          </Avatar>
          <span className="truncate text-sm font-semibold text-foreground">
            {username}
          </span>
        </div>

        {/* Channel Selector */}
        <PlatformSelector
          value={channel}
          onChange={setChannel}
          size="md"
          className="shrink-0"
        />
      </div>

      {/* Textarea - Mobile optimized */}
      <Textarea
        value={content}
        onChange={handleContentChange}
        placeholder="What's happening?"
        aria-label="Post content"
        className="min-h-24 resize-none border border-input rounded-lg bg-background py-2.5 px-3.5 text-sm leading-relaxed placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary sm:min-h-20"
        data-testid="post-content-textarea"
      />

      {/* Controls: Date Picker + Action Bar - Responsive */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-3">
        {/* Date/Time Picker - Full width on mobile, flex-1 on desktop */}
        <div className="w-full sm:w-auto">
          <PostSchedulePicker onChangeDateTime={setScheduledAt} />
        </div>

        {/* Action Bar - Below on mobile, right-aligned on desktop */}
        <div className="flex items-center gap-3 w-full sm:w-auto sm:ml-auto shrink-0">
          <PostActionBar
            isSubmitting={createPostMutation.isPending}
            isContentEmpty={content.trim().length === 0}
            actionType={actionType}
            canPublishOrSchedule={canPublishOrSchedule}
            onActionTypeChange={setActionType}
            onImageClick={() => {
              // TODO: Implement image upload functionality
            }}
            onEmojiClick={() => {
              // TODO: Implement emoji picker functionality
            }}
            onDraftClick={() => handleSubmit("draft")}
            onScheduleClick={() => handleSubmit("schedule")}
            onPostClick={() => handleSubmit("post")}
            onCancelClick={onCancel}
            showCancel={!!onCancel}
          />
        </div>
      </div>

      {/* Schedule Info - Below controls */}
      {scheduledAt && (
        <p
          className="text-sm leading-relaxed text-muted-foreground"
          aria-live="polite"
          aria-atomic="true"
          data-testid="schedule-info"
        >
          Post will be published on{" "}
          <span className="font-semibold text-foreground">
            {formatDateTime(scheduledAt)}
          </span>
        </p>
      )}
    </div>
  )
}
