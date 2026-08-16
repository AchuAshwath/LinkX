import {
  AlertCircle,
  Check,
  Clock,
  Edit,
  Eye,
  Loader2,
  MoreHorizontal,
  RotateCcw,
  Send,
  Trash2,
  X,
} from "lucide-react"
import * as React from "react"
import type { Platform } from "@/components/Common/PlatformSelector"
import { PostActionFooter } from "@/components/Post/PostActionFooter"
import { EditPostDialog } from "@/components/PostInput/EditPostDialog"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Textarea } from "@/components/ui/textarea"
import {
  formatFullDateTime,
  formatRelativeTime,
  getInitials,
  resolveMediaUrl,
} from "@/utils"

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
  onPublish?: (postId: string) => void
  isPublishing?: boolean
}

function parseScheduledDate(scheduledAt?: Date | string | null): Date | null {
  if (!scheduledAt) return null
  return typeof scheduledAt === "string" ? new Date(scheduledAt) : scheduledAt
}

function PostCardAuthorMeta({
  author,
  createdAt,
  scheduledAt,
  isScheduled,
  scheduledDateTime,
}: {
  author: PostAuthorData
  createdAt: Date | string
  scheduledAt?: Date | string | null
  isScheduled: boolean
  scheduledDateTime: string
}) {
  const relativeTime = React.useMemo(
    () => formatRelativeTime(createdAt),
    [createdAt],
  )
  const fullDateTime = React.useMemo(
    () => formatFullDateTime(createdAt),
    [createdAt],
  )

  return (
    <div className="flex min-w-0 items-center gap-1.5 flex-wrap sm:flex-nowrap">
      <button
        type="button"
        className="truncate text-sm font-semibold hover:underline focus:outline-none"
        aria-label={`View ${author.name}'s profile`}
      >
        {author.name}
      </button>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground min-w-0">
        <span className="shrink-0">@{author.username}</span>
        <span className="shrink-0" aria-hidden="true">
          ·
        </span>
        {isScheduled && scheduledAt ? (
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
              typeof createdAt === "string"
                ? createdAt
                : createdAt.toISOString()
            }
            title={fullDateTime}
            className="shrink-0 text-xs hover:underline"
          >
            {relativeTime}
          </time>
        )}
      </div>
    </div>
  )
}

function PostCardHeaderActions({
  isEditing,
  canSave,
  onCancel,
  onSave,
  onPreview,
  onEdit,
  onDelete,
  onPublish,
  isPublishing,
}: {
  isEditing: boolean
  canSave: boolean
  onCancel: () => void
  onSave: () => void
  onPreview?: () => void
  onEdit?: () => void
  onDelete?: () => void
  onPublish?: () => void
  isPublishing?: boolean
}) {
  if (isEditing) {
    return (
      <div className="flex items-center gap-1.5">
        <Button
          variant="ghost"
          size="sm"
          onClick={onCancel}
          className="h-8 px-3 text-xs"
        >
          <X className="mr-1.5 h-3.5 w-3.5" />
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={onSave}
          className="h-8 px-3 text-xs"
          disabled={!canSave}
        >
          <Check className="mr-1.5 h-3.5 w-3.5" />
          Save
        </Button>
      </div>
    )
  }

  return (
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
      <DropdownMenuContent align="end" className="rounded-xl">
        {onPublish && (
          <DropdownMenuItem
            onClick={onPublish}
            disabled={isPublishing}
            className="text-primary focus:text-primary font-medium cursor-pointer"
          >
            {isPublishing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin text-primary" />
            ) : (
              <Send className="mr-2 h-4 w-4 text-primary" />
            )}
            Publish
          </DropdownMenuItem>
        )}
        {onPreview && (
          <DropdownMenuItem onClick={onPreview} className="cursor-pointer">
            <Eye className="mr-2 h-4 w-4" />
            Preview
          </DropdownMenuItem>
        )}
        {onEdit && (
          <DropdownMenuItem onClick={onEdit} className="cursor-pointer">
            <Edit className="mr-2 h-4 w-4" />
            Edit
          </DropdownMenuItem>
        )}
        {onDelete && (
          <DropdownMenuItem
            onClick={onDelete}
            className="text-destructive focus:text-destructive cursor-pointer"
          >
            <Trash2 className="mr-2 h-4 w-4 text-destructive" />
            Delete
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

interface PostCardHeaderProps {
  author: PostAuthorData
  createdAt: Date | string
  scheduledAt?: Date | string | null
  isScheduled: boolean
  scheduledDateTime: string
  isEditing: boolean
  canSave: boolean
  onCancel: () => void
  onSave: () => void
  onPreview?: () => void
  onEdit?: () => void
  onDelete?: () => void
  onPublish?: () => void
  isPublishing?: boolean
}

function PostCardHeader(props: PostCardHeaderProps) {
  return (
    <div className="flex items-center justify-between gap-2">
      <PostCardAuthorMeta
        author={props.author}
        createdAt={props.createdAt}
        scheduledAt={props.scheduledAt}
        isScheduled={props.isScheduled}
        scheduledDateTime={props.scheduledDateTime}
      />
      <PostCardHeaderActions
        isEditing={props.isEditing}
        canSave={props.canSave}
        onCancel={props.onCancel}
        onSave={props.onSave}
        onPreview={props.onPreview}
        onEdit={props.onEdit}
        onDelete={props.onDelete}
        onPublish={props.onPublish}
        isPublishing={props.isPublishing}
      />
    </div>
  )
}

function FailureNotice({
  errorReason,
  onRetry,
  isRetrying,
}: {
  errorReason?: string | null
  onRetry?: () => void
  isRetrying: boolean
}) {
  return (
    <div className="mt-2 flex items-center justify-between gap-2 text-xs text-destructive">
      <div className="flex items-center gap-1.5 min-w-0 flex-1">
        <AlertCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
        <span className="truncate font-medium">
          {errorReason || "Publish failed"}
        </span>
      </div>

      {onRetry && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onRetry}
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
  )
}

function PostCardBodyContent({
  isEditing,
  content,
  editedContent,
  onContentChange,
  imageUrl,
}: {
  isEditing: boolean
  content: string
  editedContent: string
  onContentChange: (val: string) => void
  imageUrl?: string | null
}) {
  if (isEditing) {
    return (
      <div className="mt-1.5">
        <Textarea
          value={editedContent}
          onChange={(e) => onContentChange(e.target.value)}
          placeholder="What's happening?"
          className="min-h-24 resize-none border py-2.5 px-3 text-sm leading-relaxed focus-visible:ring-1 focus-visible:ring-primary"
          rows={4}
        />
      </div>
    )
  }

  return (
    <>
      <div className="mt-1">
        <p className="break-words text-sm leading-normal whitespace-pre-wrap text-foreground">
          {content}
        </p>
      </div>

      {imageUrl && (
        <div className="mt-2.5 overflow-hidden">
          <img
            src={resolveMediaUrl(imageUrl) ?? imageUrl}
            alt=""
            className="w-full object-cover"
            loading="lazy"
          />
        </div>
      )}
    </>
  )
}

function PostCardAvatar({ author }: { author: PostAuthorData }) {
  const initials = getInitials(author.name)
  return (
    <div className="flex-shrink-0">
      <Avatar className="h-10 w-10 cursor-pointer transition-transform hover:scale-105">
        {author.avatarUrl ? (
          <AvatarImage src={author.avatarUrl} alt={author.name} />
        ) : null}
        <AvatarFallback className="text-xs font-semibold">
          {initials}
        </AvatarFallback>
      </Avatar>
    </div>
  )
}

interface EditorOptions {
  post: PostCardData
  onSave?: (
    id: string,
    data: { content: string; platform: Platform; scheduledAt?: Date | null },
  ) => void
  onCancel?: () => void
  onPlatformChange?: (id: string, platform: Platform) => void
}

function usePostCardEditor({
  post,
  onSave,
  onCancel,
  onPlatformChange,
}: EditorOptions) {
  const [platform, setPlatform] = React.useState<Platform>(
    post.platform || "linkx",
  )
  const [editedContent, setEditedContent] = React.useState(post.content)
  const [editedScheduledAt, setEditedScheduledAt] = React.useState<Date | null>(
    parseScheduledDate(post.scheduledAt),
  )

  React.useEffect(() => {
    setEditedContent(post.content)
    setPlatform(post.platform || "linkx")
    setEditedScheduledAt(parseScheduledDate(post.scheduledAt))
  }, [post.content, post.platform, post.scheduledAt])

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
    setEditedScheduledAt(parseScheduledDate(post.scheduledAt))
    onCancel?.()
  }, [onCancel, post.content, post.platform, post.scheduledAt])

  const handlePlatformChange = React.useCallback(
    (newPlatform: Platform) => {
      setPlatform(newPlatform)
      onPlatformChange?.(post.id, newPlatform)
    },
    [onPlatformChange, post.id],
  )

  return {
    platform,
    editedContent,
    setEditedContent,
    editedScheduledAt,
    setEditedScheduledAt,
    handleSave,
    handleCancel,
    handlePlatformChange,
  }
}

function usePostCardEngagement(
  post: PostCardData,
  onLike?: (id: string) => void,
  onRepost?: (id: string) => void,
) {
  const [isLiked, setIsLiked] = React.useState(post.isLiked ?? false)
  const [likeCount, setLikeCount] = React.useState(post.likes ?? 0)
  const [isReposted, setIsReposted] = React.useState(post.isReposted ?? false)
  const [repostCount, setRepostCount] = React.useState(post.reposts ?? 0)

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

  return {
    isLiked,
    likeCount,
    isReposted,
    repostCount,
    handleLike,
    handleRepost,
  }
}

interface PostCardActionsProps {
  isEditing: boolean
  platform: Platform
  onPlatformChange?: (platform: Platform) => void
  engagement: ReturnType<typeof usePostCardEngagement>
  commentsCount: number
  onComment?: () => void
  onShare?: () => void
  isPosted: boolean
}

function PostCardActionsRow({
  isEditing,
  platform,
  onPlatformChange,
  engagement,
  commentsCount,
  onComment,
  onShare,
  isPosted,
}: PostCardActionsProps) {
  return (
    <div className="mt-2">
      <PostActionFooter
        isEditing={isEditing}
        platform={platform}
        onPlatformChange={onPlatformChange}
        isLiked={engagement.isLiked}
        likeCount={engagement.likeCount}
        onLike={engagement.handleLike}
        isReposted={engagement.isReposted}
        repostCount={engagement.repostCount}
        onRepost={engagement.handleRepost}
        commentsCount={commentsCount}
        onComment={onComment}
        onShare={onShare}
        isPosted={isPosted}
      />
    </div>
  )
}

function getPostCardFlags(post: PostCardData) {
  const isScheduled = Boolean(
    post.scheduledAt ||
      post.type === "scheduled" ||
      post.status === "scheduled",
  )
  const isFailed = post.status === "failed"
  const isPosted = post.type === "posted" || post.status === "published"
  const scheduledDateTime = post.scheduledAt
    ? formatFullDateTime(post.scheduledAt)
    : ""

  return { isScheduled, isFailed, isPosted, scheduledDateTime }
}

interface PostCardLayoutProps extends PostCardProps {
  editor: ReturnType<typeof usePostCardEditor>
  engagement: ReturnType<typeof usePostCardEngagement>
}

function PostCardFailureNotice({
  isFailed,
  errorReason,
  onRetry,
  isRetrying,
}: {
  isFailed: boolean
  errorReason?: string | null
  onRetry?: () => void
  isRetrying: boolean
}) {
  if (!isFailed) return null
  return (
    <FailureNotice
      errorReason={errorReason}
      onRetry={onRetry}
      isRetrying={isRetrying}
    />
  )
}

function PostCardHeaderWrapper({
  post,
  flags,
  isEditing,
  editor,
  onPreview,
  onEdit,
  onDelete,
  onPublish,
  isPublishing,
}: {
  post: PostCardData
  flags: ReturnType<typeof getPostCardFlags>
  isEditing: boolean
  editor: ReturnType<typeof usePostCardEditor>
  onPreview?: (id: string) => void
  onEdit?: (id: string) => void
  onDelete?: (id: string) => void
  onPublish?: (id: string) => void
  isPublishing?: boolean
}) {
  return (
    <PostCardHeader
      author={post.author}
      createdAt={post.createdAt}
      scheduledAt={post.scheduledAt}
      isScheduled={flags.isScheduled}
      scheduledDateTime={flags.scheduledDateTime}
      isEditing={isEditing}
      canSave={editor.editedContent.trim().length > 0}
      onCancel={editor.handleCancel}
      onSave={editor.handleSave}
      onPreview={onPreview ? () => onPreview(post.id) : undefined}
      onEdit={onEdit ? () => onEdit(post.id) : undefined}
      onDelete={onDelete ? () => onDelete(post.id) : undefined}
      onPublish={onPublish ? () => onPublish(post.id) : undefined}
      isPublishing={isPublishing}
    />
  )
}

function PostCardMainColumn(props: PostCardLayoutProps) {
  const flags = getPostCardFlags(props.post)

  return (
    <div className="min-w-0 flex-1">
      <PostCardHeaderWrapper
        post={props.post}
        flags={flags}
        isEditing={false}
        editor={props.editor}
        onPreview={props.onPreview}
        onEdit={props.onEdit}
        onDelete={props.onDelete}
        onPublish={props.onPublish}
        isPublishing={props.isPublishing}
      />

      <PostCardBodyContent
        isEditing={false}
        content={props.post.content}
        editedContent={props.editor.editedContent}
        onContentChange={props.editor.setEditedContent}
        imageUrl={props.post.imageUrl}
      />

      <PostCardFailureNotice
        isFailed={flags.isFailed}
        errorReason={props.post.errorReason}
        onRetry={
          props.onRetry ? () => props.onRetry!(props.post.id) : undefined
        }
        isRetrying={Boolean(props.isRetrying)}
      />

      <PostCardActionsRow
        isEditing={false}
        platform={props.editor.platform}
        onPlatformChange={
          flags.isPosted ? undefined : props.editor.handlePlatformChange
        }
        engagement={props.engagement}
        commentsCount={props.post.comments ?? 0}
        onComment={() => props.onComment?.(props.post.id)}
        onShare={() => props.onShare?.(props.post.id)}
        isPosted={flags.isPosted}
      />
    </div>
  )
}

function PostCardLayout(props: PostCardLayoutProps) {
  return (
    <article
      className={`group border-b transition-colors hover:bg-accent/40`}
      aria-label={`Post by ${props.post.author.name}`}
    >
      <div className="p-3 sm:p-4">
        <div className="flex gap-2.5 sm:gap-3">
          <PostCardAvatar author={props.post.author} />
          <PostCardMainColumn {...props} />
        </div>
      </div>
    </article>
  )
}

export const PostCard = React.memo(function PostCard(props: PostCardProps) {
  const [editDialogOpen, setEditDialogOpen] = React.useState(false)

  const editor = usePostCardEditor({
    post: props.post,
    onSave: props.onSave,
    onCancel: props.onCancel,
    onPlatformChange: props.onPlatformChange,
  })
  const engagement = usePostCardEngagement(
    props.post,
    props.onLike,
    props.onRepost,
  )

  // Wire onEdit to open the dialog instead of inline edit
  const handleEdit = React.useCallback(() => {
    setEditDialogOpen(true)
    props.onEdit?.(props.post.id)
  }, [props])

  return (
    <>
      <PostCardLayout
        {...props}
        editor={editor}
        engagement={engagement}
        isEditing={false}
        onEdit={handleEdit}
      />
      <EditPostDialog
        open={editDialogOpen}
        onOpenChange={(open) => {
          setEditDialogOpen(open)
          if (!open) props.onCancel?.()
        }}
        postId={props.post.id}
        initialContent={props.post.content}
        initialImageUrl={props.post.imageUrl}
        initialPlatform={props.post.platform}
        initialScheduledAt={
          props.post.scheduledAt
            ? new Date(props.post.scheduledAt as string)
            : null
        }
      />
    </>
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
