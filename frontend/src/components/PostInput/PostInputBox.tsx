import { Calendar } from "lucide-react"
import * as React from "react"

import {
  type Platform,
  PlatformSelector,
} from "@/components/Common/PlatformSelector"
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
  autoFocus?: boolean
}

function PostInputAvatar({
  username,
  avatarUrl,
}: {
  username: string
  avatarUrl?: string
}) {
  const initials =
    username
      ?.split(" ")
      .map((part) => part[0])
      .join("")
      .toUpperCase()
      .slice(0, 2) || "U"

  return (
    <div className="shrink-0 pt-0.5">
      <Avatar className="h-10 w-10 transition-transform hover:scale-105 select-none">
        {avatarUrl ? <AvatarImage src={avatarUrl} alt={username} /> : null}
        <AvatarFallback className="text-xs font-semibold">
          {initials}
        </AvatarFallback>
      </Avatar>
    </div>
  )
}

function PostInputScheduledNotice({
  scheduledAt,
}: {
  scheduledAt: Date | null | undefined
}) {
  if (!scheduledAt) return null

  return (
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
  )
}

export function PostInputBox({
  username,
  avatarUrl,
  initialContent,
  onSubmit,
  onCancel,
  canPublishOrSchedule = true,
  autoFocus = false,
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

  React.useEffect(() => {
    if (initialContent !== undefined && initialContent !== "") {
      setContent(initialContent)
    }
  }, [initialContent, setContent])

  React.useEffect(() => {
    if (createPostMutation.isSuccess) {
      onSubmit?.()
      setIsScheduleOpen(false)
    }
  }, [createPostMutation.isSuccess, onSubmit])

  React.useEffect(() => {
    if (autoFocus) {
      const timer = setTimeout(() => {
        textareaRef.current?.focus()
      }, 50)
      return () => clearTimeout(timer)
    }
  }, [autoFocus])

  return (
    <div className="flex gap-3 w-full">
      <PostInputAvatar username={username} avatarUrl={avatarUrl} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <span className="truncate text-sm font-semibold text-foreground">
            {username}
          </span>
          <PlatformSelector
            value={channel}
            onChange={(val: Platform) => setChannel(val)}
            size="sm"
            className="shrink-0"
          />
        </div>

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

        <div className="pt-2.5 border-t border-border/40 mt-2">
          <PostActionBar
            isSubmitting={createPostMutation.isPending}
            isContentEmpty={content.trim().length === 0}
            actionType={actionType}
            canPublishOrSchedule={canPublishOrSchedule}
            onActionTypeChange={setActionType}
            onImageClick={() => {}}
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

        <PostInputScheduledNotice scheduledAt={scheduledAt} />
      </div>
    </div>
  )
}
