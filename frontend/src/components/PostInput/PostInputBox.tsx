import { Calendar } from "lucide-react"
import * as React from "react"

import { PlatformSelector } from "@/components/Common/PlatformSelector"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { PostActionBar } from "./PostActionBar"
import { formatDateTime } from "./PostSchedulePicker"
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

  const [isScheduleOpen, setIsScheduleOpen] = React.useState(false)
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)

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
      setIsScheduleOpen(false)
    }
  }, [createPostMutation.isSuccess, onSubmit])

  // Auto-resize textarea as user types
  React.useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto"
      textareaRef.current.style.height = `${Math.max(
        64,
        textareaRef.current.scrollHeight,
      )}px`
    }
  }, [])

  const initials =
    username
      .split(" ")
      .map((part) => part[0])
      .join("")
      .toUpperCase() || "U"

  return (
    <div className="flex gap-3 w-full">
      {/* Left Column: User Avatar */}
      <div className="shrink-0 pt-0.5">
        <Avatar className="h-10 w-10 transition-transform hover:scale-105 cursor-pointer">
          {avatarUrl ? <AvatarImage src={avatarUrl} alt={username} /> : null}
          <AvatarFallback className="text-xs font-semibold">
            {initials}
          </AvatarFallback>
        </Avatar>
      </div>

      {/* Right Column: Post Form */}
      <div className="flex-1 min-w-0">
        {/* Header: Username on left, Platform selector on right */}
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <span className="truncate text-sm font-semibold text-foreground">
            {username}
          </span>
          <PlatformSelector
            value={channel}
            onChange={setChannel}
            size="sm"
            className="shrink-0"
          />
        </div>

        {/* Seamless Borderless Textarea */}
        <textarea
          ref={textareaRef}
          value={content}
          onChange={handleContentChange}
          placeholder="What's happening?"
          aria-label="Post content"
          rows={2}
          className="w-full bg-transparent border-0 outline-none resize-none text-[15px] sm:text-[16px] leading-relaxed placeholder:text-muted-foreground/60 focus:outline-none focus:ring-0 p-0 text-foreground min-h-[64px]"
          data-testid="post-content-textarea"
        />

        {/* Bottom Toolbar & Actions */}
        <div className="pt-2.5 border-t border-border/40 mt-2">
          <PostActionBar
            isSubmitting={createPostMutation.isPending}
            isContentEmpty={content.trim().length === 0}
            actionType={actionType}
            canPublishOrSchedule={canPublishOrSchedule}
            onActionTypeChange={setActionType}
            onImageClick={() => {
              // TODO: Implement image upload functionality
            }}
            onDraftClick={() => handleSubmit("draft")}
            onScheduleClick={() => handleSubmit("schedule")}
            onPostClick={() => handleSubmit("post")}
            onCancelClick={onCancel}
            showCancel={!!onCancel}
            scheduledAt={scheduledAt}
            onScheduleChange={setScheduledAt}
            isScheduleOpen={isScheduleOpen}
            onToggleSchedule={setIsScheduleOpen}
          />
        </div>

        {/* Small description down below when scheduled */}
        {scheduledAt && (
          <div
            className="animate-in fade-in-0 slide-in-from-top-1 duration-200 flex items-center gap-1.5 text-xs text-muted-foreground pt-2"
            aria-live="polite"
            aria-atomic="true"
            data-testid="schedule-info"
          >
            <Calendar className="h-3.5 w-3.5 text-primary shrink-0" />
            <span>
              Will be published on{" "}
              <span className="font-medium text-foreground">
                {formatDateTime(scheduledAt)}
              </span>
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
