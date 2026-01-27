import {
  Bookmark,
  Heart,
  MessageCircle,
  MoreHorizontal,
  Repeat2,
  Share,
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

interface XPostPreviewProps {
  post: PreviewPostData
}

export function XPostPreview({ post }: XPostPreviewProps) {
  const relativeTime = formatRelativeTime(post.createdAt)
  const initials = getInitials(post.author.name)
  const hasEngagement =
    post.likes !== undefined ||
    post.comments !== undefined ||
    post.reposts !== undefined

  const likes = post.likes ?? 0
  const comments = post.comments ?? 0
  const reposts = post.reposts ?? 0

  return (
    <div className="mx-auto w-full max-w-[600px] overflow-hidden rounded-2xl border border-black/10 bg-white shadow-sm dark:border-white/10 dark:bg-black">
      <div className="p-4 sm:p-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <Avatar className="h-11 w-11 shrink-0 sm:h-12 sm:w-12">
              {post.author.avatarUrl ? (
                <AvatarImage
                  src={post.author.avatarUrl}
                  alt={post.author.name}
                />
              ) : null}
              <AvatarFallback className="text-sm bg-gray-200 dark:bg-gray-800 text-gray-900 dark:text-gray-100">
                {initials}
              </AvatarFallback>
            </Avatar>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <h3 className="truncate text-sm font-semibold text-foreground sm:text-base">
                  {post.author.name}
                </h3>
                <span className="truncate text-xs text-muted-foreground sm:text-sm">
                  @{post.author.username}
                </span>
                <span
                  className="text-xs text-muted-foreground"
                  aria-hidden="true"
                >
                  ·
                </span>
                <span className="text-xs text-muted-foreground sm:text-sm">
                  {relativeTime}
                </span>
              </div>

              {/* Text */}
              <div className="mt-2 text-sm leading-relaxed text-foreground sm:text-base whitespace-pre-wrap break-words">
                {post.content}
              </div>

              {/* Media */}
              {post.imageUrl && (
                <div className="mt-3 overflow-hidden rounded-2xl border border-black/10 dark:border-white/10 max-h-[520px]">
                  <img
                    src={post.imageUrl}
                    alt=""
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                </div>
              )}

              {/* Metrics line */}
              {hasEngagement && (
                <div className="mt-3 flex items-center gap-4 border-t border-black/10 pt-3 text-xs text-muted-foreground dark:border-white/10 sm:text-sm">
                  <span>
                    <span className="font-semibold text-foreground">
                      {comments.toLocaleString()}
                    </span>{" "}
                    Replies
                  </span>
                  <span>
                    <span className="font-semibold text-foreground">
                      {reposts.toLocaleString()}
                    </span>{" "}
                    Reposts
                  </span>
                  <span>
                    <span className="font-semibold text-foreground">
                      {likes.toLocaleString()}
                    </span>{" "}
                    Likes
                  </span>
                </div>
              )}

              {/* Actions */}
              <div className="mt-3 flex items-center justify-between border-t border-black/10 pt-2 dark:border-white/10">
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-full px-2 py-2 text-xs text-muted-foreground transition-colors hover:bg-black/5 hover:text-sky-600 dark:hover:bg-white/10 dark:hover:text-sky-400 sm:text-sm"
                >
                  <MessageCircle className="h-4 w-4" />
                  <span className="hidden sm:inline">{comments || ""}</span>
                </button>
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-full px-2 py-2 text-xs text-muted-foreground transition-colors hover:bg-black/5 hover:text-emerald-600 dark:hover:bg-white/10 dark:hover:text-emerald-400 sm:text-sm"
                >
                  <Repeat2 className="h-4 w-4" />
                  <span className="hidden sm:inline">{reposts || ""}</span>
                </button>
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-full px-2 py-2 text-xs text-muted-foreground transition-colors hover:bg-black/5 hover:text-rose-600 dark:hover:bg-white/10 dark:hover:text-rose-400 sm:text-sm"
                >
                  <Heart className="h-4 w-4" />
                  <span className="hidden sm:inline">{likes || ""}</span>
                </button>
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-full px-2 py-2 text-xs text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10 sm:text-sm"
                  aria-label="Bookmark"
                >
                  <Bookmark className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-full px-2 py-2 text-xs text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10 sm:text-sm"
                  aria-label="Share"
                >
                  <Share className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>

          <button
            type="button"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-black/5 dark:hover:bg-white/10"
            aria-label="More"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
