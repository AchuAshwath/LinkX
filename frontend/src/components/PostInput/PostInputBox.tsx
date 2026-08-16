import { useQuery } from "@tanstack/react-query"
import { Calendar, X } from "lucide-react"
import * as React from "react"

import { AuthService } from "@/client"
import {
  type Platform,
  PlatformSelector,
} from "@/components/Common/PlatformSelector"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"
import { MediaThumbnail } from "./MediaThumbnail"
import { PostActionBar } from "./PostActionBar"
import { formatDateTime } from "./PostSchedulePicker"
import { useComposerDragDrop } from "./useComposerDragDrop"
import { useComposerSubmission } from "./useComposerSubmission"
import { usePostForm } from "./usePostForm"

export interface EditMode {
  postId: string
  initialScheduledAt?: Date | null
  onSaved?: () => void
}

export interface PostInputBoxProps {
  username: string
  avatarUrl?: string
  initialContent?: string
  initialImageUrl?: string
  initialPlatform?: Platform
  onSubmit?: () => void
  onCancel?: () => void
  canPublishOrSchedule?: boolean
  autoFocus?: boolean
  editMode?: EditMode
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
  onClear,
}: {
  scheduledAt: Date | null | undefined
  onClear?: () => void
}) {
  if (!scheduledAt) return null

  return (
    <div
      className="animate-in fade-in-0 slide-in-from-top-1 duration-200 flex items-center justify-between gap-2 text-xs text-muted-foreground mb-2.5"
      aria-live="polite"
      aria-atomic="true"
      data-testid="schedule-info"
    >
      <div className="flex items-center gap-1.5 min-w-0 truncate">
        <Calendar className="h-3.5 w-3.5 text-primary shrink-0" />
        <span className="truncate">
          Will be published on{" "}
          <span className="font-medium text-foreground">
            {formatDateTime(scheduledAt)}
          </span>
        </span>
      </div>
      {onClear && (
        <button
          type="button"
          onClick={onClear}
          className="h-5 w-5 rounded-full hover:bg-muted/80 text-muted-foreground hover:text-foreground flex items-center justify-center transition-all duration-150 active:scale-95 cursor-pointer shrink-0 ml-2 -mr-1"
          title="Remove schedule"
          aria-label="Remove schedule"
          data-testid="clear-schedule-btn"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  )
}

interface PostInputFormBodyProps {
  username: string
  channel: Platform
  setChannel: (val: Platform) => void
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  content: string
  handleContentChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
  imageUrl: string | null
  isUploadingMedia: boolean
  removeMedia: () => void
  isSubmitting: boolean
  isAiGenerating?: boolean
  setActionType: (type: "draft" | "schedule" | "post") => void
  canPublishOrSchedule: boolean
  isXPremium?: boolean
  onImageClick: () => void
  handleSubmit: (action: "draft" | "schedule" | "post") => void
  onAiDraftClick?: () => void
  onCancel?: () => void
  scheduledAt?: Date
  setScheduledAt: (date?: Date) => void
  isScheduleOpen: boolean
  setIsScheduleOpen: (open: boolean) => void
}

function PostInputFormBody({
  username,
  channel,
  setChannel,
  textareaRef,
  content,
  handleContentChange,
  imageUrl,
  isUploadingMedia,
  removeMedia,
  isSubmitting,
  isAiGenerating,
  setActionType,
  canPublishOrSchedule,
  isXPremium,
  onImageClick,
  handleSubmit,
  onAiDraftClick,
  onCancel,
  scheduledAt,
  setScheduledAt,
  isScheduleOpen,
  setIsScheduleOpen,
}: PostInputFormBodyProps) {
  return (
    <div className="flex-1 min-w-0">
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

      {imageUrl && (
        <MediaThumbnail
          imageUrl={imageUrl}
          isUploading={isUploadingMedia}
          onRemove={removeMedia}
        />
      )}

      <div className="pt-2.5 border-t border-border/40 mt-2">
        <PostInputScheduledNotice
          scheduledAt={scheduledAt}
          onClear={() => {
            setScheduledAt(undefined)
            setIsScheduleOpen(false)
            setActionType("post")
          }}
        />

        <PostActionBar
          isSubmitting={isSubmitting}
          isAiGenerating={isAiGenerating}
          isContentEmpty={content.trim().length === 0 && !imageUrl}
          canPublishOrSchedule={canPublishOrSchedule}
          currentLength={content.length}
          platform={channel}
          isXPremium={isXPremium}
          onActionTypeChange={setActionType}
          onImageClick={onImageClick}
          onDraftClick={() => handleSubmit("draft")}
          onAiDraftClick={onAiDraftClick}
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
    </div>
  )
}

interface UseComposerLifecycleOptions {
  initialContent?: string
  initialImageUrl?: string | null
  autoFocus?: boolean
  isSuccess: boolean
  setContent: (content: string) => void
  setImageUrl: (url: string | null) => void
  onSubmit?: () => void
  setIsScheduleOpen: (open: boolean) => void
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
}

function useComposerLifecycle({
  initialContent,
  initialImageUrl,
  autoFocus,
  isSuccess,
  setContent,
  setImageUrl,
  onSubmit,
  setIsScheduleOpen,
  textareaRef,
}: UseComposerLifecycleOptions) {
  React.useEffect(() => {
    if (initialContent) setContent(initialContent)
  }, [initialContent, setContent])

  React.useEffect(() => {
    if (initialImageUrl) setImageUrl(initialImageUrl)
  }, [initialImageUrl, setImageUrl])

  React.useEffect(() => {
    if (isSuccess) {
      onSubmit?.()
      setIsScheduleOpen(false)
    }
  }, [isSuccess, onSubmit, setIsScheduleOpen])

  React.useEffect(() => {
    if (!autoFocus) return
    const timer = setTimeout(() => textareaRef.current?.focus(), 50)
    return () => clearTimeout(timer)
  }, [autoFocus, textareaRef])
}

export function PostInputBox({
  username,
  avatarUrl,
  initialContent,
  initialImageUrl,
  initialPlatform,
  onSubmit,
  onCancel,
  canPublishOrSchedule = true,
  autoFocus = false,
  editMode,
}: PostInputBoxProps) {
  const form = usePostForm({
    initialContent,
    initialImageUrl,
    initialPlatform,
  })

  const { isSuccess, isSubmitting, onSubmitHandler, onAiDraftHandler } =
    useComposerSubmission({ editMode, form })

  const { data: xStatus } = useQuery({
    queryKey: ["x", "status"],
    queryFn: () => AuthService.xStatus(),
    staleTime: 60000,
  })

  const [isScheduleOpen, setIsScheduleOpen] = React.useState(false)
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)
  const { isDragging, fileInputRef, handleFileSelect, dragProps } =
    useComposerDragDrop(form.uploadMedia)

  useComposerLifecycle({
    initialContent,
    initialImageUrl,
    autoFocus,
    isSuccess,
    setContent: form.setContent,
    setImageUrl: form.setImageUrl,
    onSubmit,
    setIsScheduleOpen,
    textareaRef,
  })

  return (
    <section
      aria-label={editMode ? "Edit post" : "Post composer"}
      className={cn(
        "flex gap-3 w-full rounded-2xl p-1 transition-colors duration-200",
        isDragging && "bg-primary/5 ring-2 ring-primary/30 ring-dashed",
      )}
      {...dragProps}
    >
      <input
        type="file"
        ref={fileInputRef}
        accept="image/jpeg,image/png,image/gif,image/webp"
        onChange={handleFileSelect}
        className="hidden"
        data-testid="post-image-file-input"
      />

      <PostInputAvatar username={username} avatarUrl={avatarUrl} />

      <PostInputFormBody
        username={username}
        channel={form.channel}
        setChannel={form.setChannel}
        textareaRef={textareaRef}
        content={form.content}
        handleContentChange={form.handleContentChange}
        imageUrl={form.imageUrl}
        isUploadingMedia={form.isUploadingMedia}
        removeMedia={form.removeMedia}
        isSubmitting={isSubmitting}
        isAiGenerating={form.isGeneratingAiDraft}
        setActionType={form.setActionType}
        canPublishOrSchedule={canPublishOrSchedule}
        isXPremium={Boolean(xStatus?.is_premium)}
        onImageClick={() => fileInputRef.current?.click()}
        handleSubmit={onSubmitHandler}
        onAiDraftClick={onAiDraftHandler}
        onCancel={onCancel}
        scheduledAt={form.scheduledAt}
        setScheduledAt={form.setScheduledAt}
        isScheduleOpen={isScheduleOpen}
        setIsScheduleOpen={setIsScheduleOpen}
      />
    </section>
  )
}
