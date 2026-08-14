import { Heart, MessageCircle, Repeat2, Share } from "lucide-react"
import {
  type Platform,
  PlatformSelector,
} from "@/components/Common/PlatformSelector"
import { Button } from "@/components/ui/button"

export interface PostActionFooterProps {
  isEditing?: boolean
  platform: Platform
  onPlatformChange: (platform: Platform) => void
  isLiked?: boolean
  likeCount?: number
  onLike?: () => void
  isReposted?: boolean
  repostCount?: number
  onRepost?: () => void
  commentsCount?: number
  onComment?: () => void
  onShare?: () => void
}

export function PostActionFooter({
  isEditing = false,
  platform,
  onPlatformChange,
  isLiked = false,
  likeCount = 0,
  onLike,
  isReposted = false,
  repostCount = 0,
  onRepost,
  commentsCount = 0,
  onComment,
  onShare,
}: PostActionFooterProps) {
  if (isEditing) {
    return (
      <div className="flex items-center justify-end pt-2">
        <PlatformSelector
          value={platform}
          onChange={onPlatformChange}
          size="sm"
        />
      </div>
    )
  }

  return (
    <div className="flex items-center justify-between gap-1 sm:gap-4">
      <div className="flex items-center gap-1 sm:gap-4">
        <Button
          variant="ghost"
          size="sm"
          className="group/btn h-9 flex-1 justify-start gap-2 text-muted-foreground transition-colors hover:bg-blue-500/10 hover:text-blue-500 active:scale-95 sm:h-8 sm:flex-initial"
          onClick={onLike}
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
          onClick={onRepost}
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
          onClick={onComment}
          aria-label="Comments"
        >
          <MessageCircle className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
          <span className="text-base">{commentsCount}</span>
        </Button>

        <Button
          variant="ghost"
          size="sm"
          className="group/btn h-9 w-9 shrink-0 text-muted-foreground transition-colors hover:bg-blue-500/10 hover:text-blue-500 active:scale-95 sm:h-8 sm:w-8"
          onClick={onShare}
          aria-label="Share post"
        >
          <Share className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
        </Button>
      </div>

      <PlatformSelector
        value={platform}
        onChange={onPlatformChange}
        size="sm"
      />
    </div>
  )
}
