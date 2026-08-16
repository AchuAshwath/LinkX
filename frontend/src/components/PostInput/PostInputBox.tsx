import { Calendar, Loader2, X } from "lucide-react"
import * as React from "react"

import {
  type Platform,
  PlatformSelector,
} from "@/components/Common/PlatformSelector"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"
import { PostActionBar } from "./PostActionBar"
import { formatDateTime } from "./PostSchedulePicker"
import { usePostForm } from "./usePostForm"

interface PostInputBoxProps {
  username: string
  avatarUrl?: string
  initialContent?: string
  initialImageUrl?: string
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

interface MediaThumbnailProps {
  imageUrl: string
  isUploading: boolean
  onRemove: () => void
}

function MediaThumbnail({
  imageUrl,
  isUploading,
  onRemove,
}: MediaThumbnailProps) {
  return (
    <div
      className="relative mt-3 group overflow-hidden rounded-xl border border-border/60 bg-muted/20 max-w-md"
      data-testid="post-media-preview"
    >
      <img
        src={imageUrl}
        alt="Post attachment"
        className="w-full max-h-52 object-cover rounded-xl"
      />
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove image"
        className="absolute top-2.5 right-2.5 inline-flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-white shadow-md backdrop-blur-xs transition-all hover:bg-black hover:scale-105 active:scale-95 focus:outline-none focus:ring-2 focus:ring-white/50 cursor-pointer"
        data-testid="remove-media-btn"
      >
        <X className="h-4 w-4" />
      </button>
      {isUploading && (
        <div
          className="absolute inset-0 bg-black/40 backdrop-blur-[1px] rounded-xl flex items-center justify-center text-white"
          data-testid="media-uploading-spinner"
        >
          <Loader2 className="h-6 w-6 animate-spin text-white" />
        </div>
      )}
    </div>
  )
}

function useComposerDragDrop(onUpload: (file: File) => void) {
  const [isDragging, setIsDragging] = React.useState(false)
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) onUpload(file)
    e.target.value = ""
  }

  const handleDragOver = (e: React.DragEvent<HTMLElement>) => {
    e.preventDefault()
    e.stopPropagation()
    if (!isDragging) setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent<HTMLElement>) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.currentTarget.contains(e.relatedTarget as Node)) return
    setIsDragging(false)
  }

  const handleDrop = (e: React.DragEvent<HTMLElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file?.type.startsWith("image/")) onUpload(file)
  }

  return {
    isDragging,
    fileInputRef,
    handleFileSelect,
    dragProps: {
      onDragOver: handleDragOver,
      onDragLeave: handleDragLeave,
      onDrop: handleDrop,
    },
  }
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
  actionType: "draft" | "schedule" | "post"
  setActionType: (type: "draft" | "schedule" | "post") => void
  canPublishOrSchedule: boolean
  onImageClick: () => void
  handleSubmit: (action: "draft" | "schedule" | "post") => void
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
  actionType,
  setActionType,
  canPublishOrSchedule,
  onImageClick,
  handleSubmit,
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
        <PostActionBar
          isSubmitting={isSubmitting}
          isContentEmpty={content.trim().length === 0 && !imageUrl}
          actionType={actionType}
          canPublishOrSchedule={canPublishOrSchedule}
          currentLength={content.length}
          platform={channel}
          onActionTypeChange={setActionType}
          onImageClick={onImageClick}
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
  )
}

export function PostInputBox({
  username,
  avatarUrl,
  initialContent,
  initialImageUrl,
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
    imageUrl,
    setImageUrl,
    isUploadingMedia,
    uploadMedia,
    removeMedia,
    handleSubmit,
    handleContentChange,
    createPostMutation,
  } = usePostForm({
    initialContent,
    initialImageUrl,
  })

  const [isScheduleOpen, setIsScheduleOpen] = React.useState(false)
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)
  const { isDragging, fileInputRef, handleFileSelect, dragProps } =
    useComposerDragDrop(uploadMedia)

  React.useEffect(() => {
    if (initialContent) setContent(initialContent)
  }, [initialContent, setContent])

  React.useEffect(() => {
    if (initialImageUrl) setImageUrl(initialImageUrl)
  }, [initialImageUrl, setImageUrl])

  React.useEffect(() => {
    if (createPostMutation.isSuccess) {
      onSubmit?.()
      setIsScheduleOpen(false)
    }
  }, [createPostMutation.isSuccess, onSubmit])

  React.useEffect(() => {
    if (!autoFocus) return
    const timer = setTimeout(() => textareaRef.current?.focus(), 50)
    return () => clearTimeout(timer)
  }, [autoFocus])

  return (
    <section
      aria-label="Post composer"
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
        channel={channel}
        setChannel={setChannel}
        textareaRef={textareaRef}
        content={content}
        handleContentChange={handleContentChange}
        imageUrl={imageUrl}
        isUploadingMedia={isUploadingMedia}
        removeMedia={removeMedia}
        isSubmitting={createPostMutation.isPending || isUploadingMedia}
        actionType={actionType}
        setActionType={setActionType}
        canPublishOrSchedule={canPublishOrSchedule}
        onImageClick={() => fileInputRef.current?.click()}
        handleSubmit={handleSubmit}
        onCancel={onCancel}
        scheduledAt={scheduledAt}
        setScheduledAt={setScheduledAt}
        isScheduleOpen={isScheduleOpen}
        setIsScheduleOpen={setIsScheduleOpen}
      />
    </section>
  )
}
