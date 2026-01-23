import {
  Globe,
  Heart,
  MessageCircle,
  MoreHorizontal,
  Repeat2,
  Send,
  Sparkles,
  ThumbsUp,
} from "lucide-react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { formatRelativeTime, getInitials } from "@/utils"

export interface PreviewPostData {
  id: string
  author: {
    name: string
    username: string
    avatarUrl?: string
  }
  content: string
  imageUrl?: string
  createdAt: Date | string
  likes?: number
  reposts?: number
  comments?: number
  scheduledAt?: Date | string
}

interface LinkedInPostPreviewProps {
  post: PreviewPostData
}

export function LinkedInPostPreview({ post }: LinkedInPostPreviewProps) {
  const relativeTime = formatRelativeTime(post.createdAt)
  const initials = getInitials(post.author.name)
  const hasEngagement =
    post.likes !== undefined || post.comments !== undefined || post.reposts !== undefined

  const maxChars = 240
  const shouldTruncate = post.content.length > maxChars
  const displayContent = shouldTruncate
    ? `${post.content.slice(0, maxChars).trimEnd()}…`
    : post.content

  const likes = post.likes ?? 0
  const comments = post.comments ?? 0
  const reposts = post.reposts ?? 0

  return (
    <div className="mx-auto w-full max-w-[555px]">
      {/* LinkedIn-like shell (no platform/logo header) */}
      <div className="w-full overflow-hidden rounded-lg border border-[#e0e0e0] bg-white shadow-sm dark:border-[#3a3f45] dark:bg-[#1b1f23]">
        <div className="p-3 sm:p-4">
          {/* Header */}
          <div className="flex items-start gap-3">
            <Avatar className="h-12 w-12 shrink-0 ring-1 ring-black/5 dark:ring-white/10">
              {post.author.avatarUrl ? (
                <AvatarImage src={post.author.avatarUrl} alt={post.author.name} />
              ) : null}
              <AvatarFallback className="text-sm bg-[#0A66C2] text-white">
                {initials}
              </AvatarFallback>
            </Avatar>

            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate text-[15px] font-semibold leading-tight text-[#191919] dark:text-[#e7e9ea]">
                      {post.author.name}
                    </h3>
                    <span className="text-xs text-[#666666] dark:text-[#9aa0a6]">
                      {post.author.username}
                    </span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-[#666666] dark:text-[#9aa0a6]">
                    <span>{relativeTime}</span>
                    <span aria-hidden="true">•</span>
                    <span>Edited</span>
                    <span aria-hidden="true">•</span>
                    <Globe className="h-3 w-3" aria-label="Visible to anyone" />
                  </div>
                </div>
                <button
                  type="button"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full text-[#666666] hover:bg-[#f3f2ef] dark:text-[#9aa0a6] dark:hover:bg-white/5"
                  aria-label="More"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>

          {/* Text */}
          <div className="mt-3 text-[15px] leading-[1.45] text-[#191919] dark:text-[#e7e9ea] whitespace-pre-wrap break-words">
            {displayContent}
            {shouldTruncate && (
              <span className="ml-1 font-medium text-[#666666] hover:underline dark:text-[#9aa0a6]">
                …more
              </span>
            )}
          </div>

          {/* Media / embedded image */}
          {post.imageUrl && (
            <div className="mt-3 overflow-hidden rounded-md border border-[#e0e0e0] bg-[#fafafa] dark:border-[#3a3f45] dark:bg-[#111418] max-h-[420px]">
              <img
                src={post.imageUrl}
                alt=""
                className="w-full h-full object-cover"
                loading="lazy"
              />
            </div>
          )}

          {/* Reactions + counts row */}
          {hasEngagement && (
            <div className="mt-3 flex items-center justify-between gap-3 border-t border-[#e0e0e0] pt-2 text-xs text-[#666666] dark:border-[#3a3f45] dark:text-[#9aa0a6]">
              <div className="flex items-center gap-2">
                <div className="flex -space-x-1">
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#0A66C2] text-white ring-2 ring-white dark:ring-[#1b1f23]">
                    <ThumbsUp className="h-3 w-3" />
                  </span>
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#E31B23] text-white ring-2 ring-white dark:ring-[#1b1f23]">
                    <Heart className="h-3 w-3" />
                  </span>
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#F5C75A] text-black ring-2 ring-white dark:ring-[#1b1f23]">
                    <Sparkles className="h-3 w-3" />
                  </span>
                </div>
                <span>{likes.toLocaleString()}</span>
              </div>

              <div className="flex items-center gap-3">
                <span>
                  {comments.toLocaleString()}{" "}
                  {comments === 1 ? "comment" : "comments"}
                </span>
                <span>
                  {reposts.toLocaleString()}{" "}
                  {reposts === 1 ? "repost" : "reposts"}
                </span>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="mt-2 grid grid-cols-4 gap-1 border-t border-[#e0e0e0] pt-1.5 dark:border-[#3a3f45]">
            <button
              type="button"
              className="flex items-center justify-center gap-2 rounded-md px-2 py-2 text-xs font-semibold text-[#666666] transition-colors hover:bg-[#f3f2ef] hover:text-[#0A66C2] dark:text-[#9aa0a6] dark:hover:bg-white/5"
            >
              <ThumbsUp className="h-4 w-4" />
              <span className="hidden sm:inline">Like</span>
            </button>
            <button
              type="button"
              className="flex items-center justify-center gap-2 rounded-md px-2 py-2 text-xs font-semibold text-[#666666] transition-colors hover:bg-[#f3f2ef] hover:text-[#0A66C2] dark:text-[#9aa0a6] dark:hover:bg-white/5"
            >
              <MessageCircle className="h-4 w-4" />
              <span className="hidden sm:inline">Comment</span>
            </button>
            <button
              type="button"
              className="flex items-center justify-center gap-2 rounded-md px-2 py-2 text-xs font-semibold text-[#666666] transition-colors hover:bg-[#f3f2ef] hover:text-[#0A66C2] dark:text-[#9aa0a6] dark:hover:bg-white/5"
            >
              <Repeat2 className="h-4 w-4" />
              <span className="hidden sm:inline">Repost</span>
            </button>
            <button
              type="button"
              className="flex items-center justify-center gap-2 rounded-md px-2 py-2 text-xs font-semibold text-[#666666] transition-colors hover:bg-[#f3f2ef] hover:text-[#0A66C2] dark:text-[#9aa0a6] dark:hover:bg-white/5"
            >
              <Send className="h-4 w-4" />
              <span className="hidden sm:inline">Send</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
