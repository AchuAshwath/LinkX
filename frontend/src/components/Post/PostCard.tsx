import {
  AlertCircle,
  Check,
  Clock,
  Edit,
  Eye,
  Loader2,
  MoreHorizontal,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react"
import * as React from "react"
import type { Platform } from "@/components/Common/PlatformSelector"
import { PostActionFooter } from "@/components/Post/PostActionFooter"
import { PostSchedulePicker } from "@/components/PostInput/PostSchedulePicker"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Textarea } from "@/components/ui/textarea"
import { formatFullDateTime, formatRelativeTime, getInitials } from "@/utils"

export interface PostAuthorData {
  name: string
  username: string
  avatarUrl?: string | null
}

export interface PostCardData {
  id: string
  author: PostAuthorData
  content: string
  imageUrl?: string | null
  createdAt: Date | string
  relativeDate?: string
  scheduledAt?: Date | string | null
  platform?: Platform
  status?: "draft" | "scheduled" | "published" | "failed" | string
  type?: "draft" | "scheduled" | "posted"
  likes?: number
  reposts?: number
  comments?: number
  isLiked?: boolean
  isReposted?: boolean
  errorReason?: string | null
}

export interface PostCardProps {
  post: PostCardData
  isEditing?: boolean
  onLike?: (postId: string) => void
  onRepost?: (postId: string) => void
  onComment?: (postId: string) => void
  onShare?: (postId: string) => void
  onEdit?: (postId: string) => void
  onSave?: (
    postId: string,
    data: { content: string; platform: Platform; scheduledAt?: Date | null },
  ) => void
  onCancel?: () => void
  onPreview?: (postId: string) => void
  onDelete?: (postId: string) => void
  onPlatformChange?: (postId: string, platform: Platform) => void
  onRetry?: (postId: string) => void
  isRetrying?: boolean
}

export const PostCard = React.memo(function PostCard({
  post,
  isEditing = false,
  onLike,
  onRepost,
  onComment,
  onShare,
  onEdit,
  onSave,
  onCancel,
  onPreview,
  onDelete,
  onPlatformChange,
  onRetry,
  isRetrying = false,
}: PostCardProps) {
  const [isLiked, setIsLiked] = React.useState(post.isLiked ?? false)
  const [likeCount, setLikeCount] = React.useState(post.likes ?? 0)
  const [isReposted, setIsReposted] = React.useState(post.isReposted ?? false)
  const [repostCount, setRepostCount] = React.useState(post.reposts ?? 0)
  const [platform, setPlatform] = React.useState<Platform>(
    post.platform || "linkx",
  )
  const [editedContent, setEditedContent] = React.useState(post.content)
  const [editedScheduledAt, setEditedScheduledAt] = React.useState<Date | null>(
    post.scheduledAt
      ? typeof post.scheduledAt === "string"
        ? new Date(post.scheduledAt)
        : post.scheduledAt
      : null,
  )
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)

  React.useEffect(() => {
    setEditedContent(post.content)
    setPlatform(post.platform || "linkx")
    if (post.scheduledAt) {
      setEditedScheduledAt(
        typeof post.scheduledAt === "string"
          ? new Date(post.scheduledAt)
          : post.scheduledAt,
      )
    }
  }, [post.content, post.platform, post.scheduledAt])

  const initials = getInitials(post.author.name)

  const relativeTime = React.useMemo(() => {
    return formatRelativeTime(post.createdAt)
  }, [post.createdAt])

  const fullDateTime = React.useMemo(() => {
    return formatFullDateTime(post.createdAt)
  }, [post.createdAt])

  const scheduledDateTime = React.useMemo(() => {
    if (!post.scheduledAt) return ""
    return formatFullDateTime(post.scheduledAt)
  }, [post.scheduledAt])

  const handleSave = React.useCallback(() => {
    onSave?.(post.id, {
      content: editedContent.trim(),
      platform,
      scheduledAt: editedScheduledAt,
    })
  }, [editedContent, editedScheduledAt, onSave, platform, post.id])

  const handleCancel = React.useCallback(() => {
    setEditedContent(post.content)
    setPlatform(post.platform || "linkx")
    if (post.scheduledAt) {
      setEditedScheduledAt(
        typeof post.scheduledAt === "string"
          ? new Date(post.scheduledAt)
          : post.scheduledAt,
      )
    }
    onCancel?.()
  }, [onCancel, post.content, post.platform, post.scheduledAt])

  const handleLike = React.useCallback(() => {
    setIsLiked((prev) => !prev)
    setLikeCount((prev) => (isLiked ? prev - 1 : prev + 1))
    onLike?.(post.id)
  }, [isLiked, onLike, post.id])

  const handleRepost = React.useCallback(() => {
    setIsReposted((prev) => !prev)
    setRepostCount((prev) => (isReposted ? prev - 1 : prev + 1))
    onRepost?.(post.id)
  }, [isReposted, onRepost, post.id])

  const handlePlatformChange = React.useCallback(
    (newPlatform: Platform) => {
      setPlatform(newPlatform)
      onPlatformChange?.(post.id, newPlatform)
    },
    [onPlatformChange, post.id],
  )

  const isScheduled = Boolean(
    post.scheduledAt ||
      post.type === "scheduled" ||
      post.status === "scheduled",
  )

  const isFailed = Boolean(post.status === "failed")

  const isPosted = Boolean(
    post.type === "posted" || post.status === "published",
  )

  return (
    <article
      className={`group border-b transition-colors ${
        isEditing ? "border-primary bg-muted/20" : "hover:bg-accent/40"
      }`}
      aria-label={`Post by ${post.author.name}`}
    >
      <div className="p-3 sm:p-4">
        <div className="flex gap-2.5 sm:gap-3">
          {/* Avatar */}
          <div className="flex-shrink-0">
            <Avatar className="h-10 w-10 cursor-pointer transition-transform hover:scale-105">
              {post.author.avatarUrl ? (
                <AvatarImage
                  src={post.author.avatarUrl}
                  alt={post.author.name}
                />
              ) : null}
              <AvatarFallback className="text-xs font-semibold">
                {initials}
              </AvatarFallback>
            </Avatar>
          </div>

          {/* Post Body Column */}
          <div className="min-w-0 flex-1">
            {/* Header: Author + Username + Date / Scheduled Time + Menu */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-1.5 flex-wrap sm:flex-nowrap">
                <button
                  type="button"
                  className="truncate text-sm font-semibold hover:underline focus:outline-none"
                  aria-label={`View ${post.author.name}'s profile`}
                >
                  {post.author.name}
                </button>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground min-w-0">
                  <span className="shrink-0">@{post.author.username}</span>
                  <span className="shrink-0" aria-hidden="true">
                    ·
                  </span>
                  {/* If scheduled, display the scheduled time right where the date is */}
                  {isScheduled && post.scheduledAt ? (
                    <span
                      title={`Scheduled for ${scheduledDateTime}`}
                      className="shrink-0 text-xs font-medium text-primary flex items-center gap-1 hover:underline cursor-default"
                    >
                      <Clock className="h-3 w-3 shrink-0" />
                      {scheduledDateTime}
                    </span>
                  ) : (
                    <time
                      dateTime={
                        typeof post.createdAt === "string"
                          ? post.createdAt
                          : post.createdAt.toISOString()
                      }
                      title={fullDateTime}
                      className="shrink-0 text-xs hover:underline"
                    >
                      {relativeTime}
                    </time>
                  )}
                </div>
              </div>

              {isEditing ? (
                <div className="flex items-center gap-1.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleCancel}
                    className="h-8 px-3 text-xs"
                  >
                    <X className="mr-1.5 h-3.5 w-3.5" />
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleSave}
                    className="h-8 px-3 text-xs"
                    disabled={editedContent.trim().length === 0}
                  >
                    <Check className="mr-1.5 h-3.5 w-3.5" />
                    Save
                  </Button>
                </div>
              ) : (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-foreground"
                      aria-label="More options"
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {onPreview && (
                      <DropdownMenuItem onClick={() => onPreview(post.id)}>
                        <Eye className="mr-2 h-4 w-4" />
                        Preview
                      </DropdownMenuItem>
                    )}
                    {onEdit && (
                      <DropdownMenuItem onClick={() => onEdit(post.id)}>
                        <Edit className="mr-2 h-4 w-4" />
                        Edit
                      </DropdownMenuItem>
                    )}
                    {onDelete && (
                      <DropdownMenuItem
                        onClick={() => onDelete(post.id)}
                        className="text-destructive focus:text-destructive"
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>

            {/* Editing Schedule Picker */}
            {isEditing && isScheduled && (
              <div className="my-2 flex items-center gap-2 p-2 rounded-xl bg-muted/40 border">
                <span className="text-xs font-medium text-muted-foreground">
                  Schedule:
                </span>
                <PostSchedulePicker
                  initialValue={editedScheduledAt || undefined}
                  onChangeDateTime={(d) => setEditedScheduledAt(d || null)}
                />
              </div>
            )}

            {/* Textarea or Content Text */}
            {isEditing ? (
              <div className="mt-1.5">
                <Textarea
                  ref={textareaRef}
                  value={editedContent}
                  onChange={(e) => setEditedContent(e.target.value)}
                  placeholder="What's happening?"
                  className="min-h-24 resize-none border py-2.5 px-3 text-sm leading-relaxed focus-visible:ring-1 focus-visible:ring-primary"
                  rows={4}
                />
              </div>
            ) : (
              <div className="mt-1">
                <p className="break-words text-sm leading-normal whitespace-pre-wrap text-foreground">
                  {post.content}
                </p>
              </div>
            )}

            {/* Media Attachment */}
            {post.imageUrl && !isEditing && (
              <div className="mt-2.5 overflow-hidden rounded-2xl">
                <img
                  src={post.imageUrl}
                  alt=""
                  className="w-full object-cover"
                  loading="lazy"
                />
              </div>
            )}

            {/* Failed Error Notice: Clean red text with warning icon + same-line retry */}
            {isFailed && (
              <div className="mt-2 flex items-center justify-between gap-2 text-xs text-destructive">
                <div className="flex items-center gap-1.5 min-w-0 flex-1">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
                  <span className="truncate font-medium">
                    {post.errorReason || "Publish failed"}
                  </span>
                </div>

                {onRetry && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => onRetry(post.id)}
                    disabled={isRetrying}
                    className="h-6.5 px-2.5 text-[11px] font-bold border-destructive/40 bg-background text-destructive hover:bg-destructive/15 rounded-full cursor-pointer shadow-2xs transition-all active:scale-95 shrink-0"
                  >
                    {isRetrying ? (
                      <>
                        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                        Retrying…
                      </>
                    ) : (
                      <>
                        <RotateCcw className="mr-1 h-3 w-3" />
                        Retry
                      </>
                    )}
                  </Button>
                )}
              </div>
            )}

            {/* Action Footer */}
            <div className="mt-2">
              <PostActionFooter
                isEditing={isEditing}
                platform={platform}
                onPlatformChange={isPosted ? undefined : handlePlatformChange}
                isLiked={isLiked}
                likeCount={likeCount}
                onLike={handleLike}
                isReposted={isReposted}
                repostCount={repostCount}
                onRepost={handleRepost}
                commentsCount={post.comments ?? 0}
                onComment={() => onComment?.(post.id)}
                onShare={() => onShare?.(post.id)}
                isPosted={isPosted}
              />
            </div>
          </div>
        </div>
      </div>
    </article>
  )
})

// Backwards-compatible aliases
export const Posted = PostCard
export const ScheduledPost = PostCard
export const DraftPost = PostCard
export const FailedPost = PostCard

export type PostedData = PostCardData
export type ScheduledPostData = PostCardData
export type DraftPostData = PostCardData
export type FailedPostData = PostCardData

export type PostedProps = PostCardProps
export type ScheduledPostProps = PostCardProps
export type DraftPostProps = PostCardProps
export type FailedPostProps = PostCardProps

export default PostCard
