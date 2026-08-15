import {
  Check,
  Clock,
  Edit,
  Eye,
  MoreHorizontal,
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
}

interface ScheduledBannerProps {
  isEditing: boolean
  editedScheduledAt: Date | null
  onDateChange: (date: Date | undefined) => void
  scheduledDateTime: string
}

function ScheduledBanner({
  isEditing,
  editedScheduledAt,
  onDateChange,
  scheduledDateTime,
}: ScheduledBannerProps) {
  return (
    <div className="flex items-center justify-between border-b bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
      <div className="flex items-center gap-1.5">
        <Clock className="h-3.5 w-3.5 text-primary" />
        <span>Scheduled for:</span>
        {isEditing ? (
          <PostSchedulePicker
            initialValue={editedScheduledAt || undefined}
            onChangeDateTime={onDateChange}
          />
        ) : (
          <span className="font-medium text-foreground">
            {scheduledDateTime}
          </span>
        )}
      </div>
    </div>
  )
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

  return (
    <article
      className={`group border-b transition-colors ${
        isEditing ? "border-primary bg-muted/30" : "hover:bg-accent/50"
      }`}
      aria-label={`Post by ${post.author.name}`}
    >
      {isScheduled && (
        <ScheduledBanner
          isEditing={isEditing}
          editedScheduledAt={editedScheduledAt}
          onDateChange={(d) => setEditedScheduledAt(d || null)}
          scheduledDateTime={scheduledDateTime}
        />
      )}

      <div className="p-3 sm:p-4">
        <div className="flex gap-2 sm:gap-3">
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

          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-1.5">
                <button
                  type="button"
                  className="truncate text-sm font-semibold hover:underline focus:outline-none"
                  aria-label={`View ${post.author.name}'s profile`}
                >
                  {post.author.name}
                </button>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="shrink-0">@{post.author.username}</span>
                  <span className="shrink-0" aria-hidden="true">
                    ·
                  </span>
                  <time
                    dateTime={
                      typeof post.createdAt === "string"
                        ? post.createdAt
                        : post.createdAt.toISOString()
                    }
                    title={fullDateTime}
                    className="shrink-0 text-xs hover:underline"
                  >
                    {post.relativeDate || relativeTime}
                  </time>
                </div>
              </div>

              {isEditing ? (
                <div className="flex items-center gap-2">
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

            {isEditing ? (
              <div className="mt-2">
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

            <div className="mt-2.5">
              <PostActionFooter
                isEditing={isEditing}
                platform={platform}
                onPlatformChange={handlePlatformChange}
                isLiked={isLiked}
                likeCount={likeCount}
                onLike={handleLike}
                isReposted={isReposted}
                repostCount={repostCount}
                onRepost={handleRepost}
                commentsCount={post.comments ?? 0}
                onComment={() => onComment?.(post.id)}
                onShare={() => onShare?.(post.id)}
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

export type PostedData = PostCardData
export type ScheduledPostData = PostCardData
export type DraftPostData = PostCardData

export type PostedProps = PostCardProps
export type ScheduledPostProps = PostCardProps
export type DraftPostProps = PostCardProps

export default PostCard
