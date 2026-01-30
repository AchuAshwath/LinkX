import {
  Check,
  Eye,
  Heart,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Repeat2,
  Share,
  Trash2,
  X,
} from "lucide-react"
import * as React from "react"
import {
  type Platform,
  PlatformSelector,
} from "@/components/Common/PlatformSelector"
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

export interface PostedData {
  id: string
  author: {
    name: string
    username: string
    avatarUrl?: string
  }
  content: string
  imageUrl?: string
  createdAt: Date | string
  relativeDate?: string // e.g., "2h ago", "1 day ago"
  likes: number
  reposts: number
  comments: number
  isLiked?: boolean
  isReposted?: boolean
  platform?: Platform
}

export interface PostedProps {
  post: PostedData
  isEditing?: boolean
  onLike?: (postId: string) => void
  onRepost?: (postId: string) => void
  onComment?: (postId: string) => void
  onShare?: (postId: string) => void
  onEdit?: (postId: string) => void
  onSave?: (postId: string) => void
  onCancel?: () => void
  onPreview?: (postId: string) => void
  onDelete?: (postId: string) => void
  onPlatformChange?: (postId: string, platform: Platform) => void
}

export function Posted({
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
}: PostedProps) {
  const [isLiked, setIsLiked] = React.useState(post.isLiked ?? false)
  const [likeCount, setLikeCount] = React.useState(post.likes)
  const [isReposted, setIsReposted] = React.useState(post.isReposted ?? false)
  const [repostCount, setRepostCount] = React.useState(post.reposts)
  const [platform, setPlatform] = React.useState<Platform>(
    post.platform || "linkedin",
  )
  const [editedContent, setEditedContent] = React.useState(post.content)
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)

  // Reset edited content when post changes or edit mode is toggled
  React.useEffect(() => {
    setEditedContent(post.content)
    setPlatform(post.platform || "linkedin")
  }, [post.content, post.platform])

  // Focus textarea when entering edit mode
  React.useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus()
      // Move cursor to end
      textareaRef.current.setSelectionRange(
        textareaRef.current.value.length,
        textareaRef.current.value.length,
      )
    }
  }, [isEditing])

  const handlePlatformChange = (newPlatform: Platform) => {
    setPlatform(newPlatform)
    onPlatformChange?.(post.id, newPlatform)
  }

  const handleSave = () => {
    // TODO: Update post with editedContent and platform
    onSave?.(post.id)
  }

  const handleCancel = () => {
    setEditedContent(post.content)
    setPlatform(post.platform || "linkedin")
    onCancel?.()
  }

  const handleLike = () => {
    setIsLiked(!isLiked)
    setLikeCount((prev) => (isLiked ? prev - 1 : prev + 1))
    onLike?.(post.id)
  }

  const handleRepost = () => {
    setIsReposted(!isReposted)
    setRepostCount((prev) => (isReposted ? prev - 1 : prev + 1))
    onRepost?.(post.id)
  }

  const fullDateTime = formatFullDateTime(post.createdAt)
  const relativeTime = formatRelativeTime(post.createdAt)
  const initials = getInitials(post.author.name)

  return (
    <article
      className={`group border-b transition-colors ${
        isEditing ? "border-primary bg-muted/30" : "hover:bg-accent/50"
      }`}
      aria-label={`Post by ${post.author.name}`}
    >
      <div className="p-3 sm:p-4">
        <div className="flex gap-2 sm:gap-3">
          {/* Avatar - Left side, full height */}
          <div className="flex-shrink-0">
            <Avatar className="h-10 w-10 cursor-pointer transition-transform hover:scale-105 sm:h-10 sm:w-10">
              {post.author.avatarUrl ? (
                <AvatarImage
                  src={post.author.avatarUrl}
                  alt={post.author.name}
                />
              ) : null}
              <AvatarFallback className="text-sm sm:text-base">
                {initials}
              </AvatarFallback>
            </Avatar>
          </div>

          {/* Content - Right side, flows in line */}
          <div className="min-w-0 flex-1 space-y-3 sm:space-y-4">
            {/* Header: Username + More Menu */}
            <div className="flex items-start justify-between gap-2 sm:gap-3">
              <div className="flex min-w-0 flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-1.5">
                <button
                  className="truncate text-base font-semibold hover:underline focus:outline-none focus:underline sm:text-base"
                  aria-label={`View ${post.author.name}'s profile`}
                >
                  {post.author.name}
                </button>
                <div className="flex items-center gap-1.5 text-sm text-muted-foreground sm:text-base">
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
                    className="shrink-0 text-xs sm:text-sm"
                    title={fullDateTime}
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
                      size="sm"
                      className="h-8 w-8 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100 sm:h-6 sm:w-6"
                      aria-label="More options"
                    >
                      <MoreHorizontal className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => onPreview?.(post.id)}>
                      <Eye className="mr-2 h-4 w-4" />
                      Preview
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onEdit?.(post.id)}>
                      <Pencil className="mr-2 h-4 w-4" />
                      Edit
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => onDelete?.(post.id)}
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>

            {/* Post Content - Editable in edit mode */}
            {isEditing ? (
              <Textarea
                ref={textareaRef}
                value={editedContent}
                onChange={(e) => setEditedContent(e.target.value)}
                placeholder="What's happening?"
                className="min-h-24 resize-none border py-3 px-3 text-base leading-relaxed focus-visible:ring-2 focus-visible:ring-primary"
                rows={4}
              />
            ) : (
              <div>
                <p className="break-words text-base leading-relaxed">
                  {post.content}
                </p>
              </div>
            )}

            {/* Image */}
            {post.imageUrl && !isEditing && (
              <div className="overflow-hidden rounded-2xl">
                <img
                  src={post.imageUrl}
                  alt=""
                  className="w-full object-cover"
                  loading="lazy"
                />
              </div>
            )}

            {/* Actions and Platform Selector */}
            {isEditing ? (
              <div className="flex items-center justify-end pt-2">
                <PlatformSelector
                  value={platform}
                  onChange={handlePlatformChange}
                  size="sm"
                />
              </div>
            ) : (
              <div className="flex items-center justify-between gap-1 sm:gap-4">
                <div className="flex items-center gap-1 sm:gap-4">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="group/btn h-9 flex-1 justify-start gap-2 text-muted-foreground transition-colors hover:bg-blue-500/10 hover:text-blue-500 active:scale-95 sm:h-8 sm:flex-initial"
                    onClick={handleLike}
                    aria-label={`${isLiked ? "Unlike" : "Like"} post`}
                    aria-pressed={isLiked}
                  >
                    <Heart
                      className={`h-4 w-4 transition-colors sm:h-3.5 sm:w-3.5 ${
                        isLiked ? "fill-red-500 text-red-500" : ""
                      }`}
                    />
                    <span className="text-base">{likeCount}</span>
                  </Button>

                  <Button
                    variant="ghost"
                    size="sm"
                    className="group/btn h-9 flex-1 justify-start gap-2 text-muted-foreground transition-colors hover:bg-green-500/10 hover:text-green-500 active:scale-95 sm:h-8 sm:flex-initial"
                    onClick={handleRepost}
                    aria-label={`${isReposted ? "Undo repost" : "Repost"}`}
                    aria-pressed={isReposted}
                  >
                    <Repeat2
                      className={`h-4 w-4 transition-colors sm:h-3.5 sm:w-3.5 ${
                        isReposted ? "text-green-500" : ""
                      }`}
                    />
                    <span className="text-base">{repostCount}</span>
                  </Button>

                  <Button
                    variant="ghost"
                    size="sm"
                    className="group/btn h-9 flex-1 justify-start gap-2 text-muted-foreground transition-colors hover:bg-blue-500/10 hover:text-blue-500 active:scale-95 sm:h-8 sm:flex-initial"
                    onClick={() => onComment?.(post.id)}
                    aria-label="Comment on post"
                  >
                    <MessageCircle className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
                    <span className="text-base">{post.comments}</span>
                  </Button>

                  <Button
                    variant="ghost"
                    size="sm"
                    className="group/btn h-9 w-9 shrink-0 text-muted-foreground transition-colors hover:bg-blue-500/10 hover:text-blue-500 active:scale-95 sm:h-8 sm:w-8"
                    onClick={() => onShare?.(post.id)}
                    aria-label="Share post"
                  >
                    <Share className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
                  </Button>
                </div>

                {/* Platform Selector */}
                <PlatformSelector
                  value={platform}
                  onChange={handlePlatformChange}
                  size="sm"
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </article>
  )
}
