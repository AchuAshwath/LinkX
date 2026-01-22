import { Calendar, Check, Eye, MoreHorizontal, Pencil, Trash2, X } from "lucide-react"
import * as React from "react"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Textarea } from "@/components/ui/textarea"
import { PlatformSelector, type Platform } from "@/components/Common/PlatformSelector"
import { PostSchedulePicker } from "@/components/PostInput/PostSchedulePicker"
import { formatFullDateTime, formatRelativeTime, formatRelativeTimeWithFuture, getInitials } from "@/utils"

export interface ScheduledPostData {
  id: string
  author: {
    name: string
    username: string
    avatarUrl?: string
  }
  content: string
  imageUrl?: string
  createdAt: Date | string
  scheduledAt: Date | string
  relativeDate?: string // e.g., "In 4 days", "In 2h"
  platform: Platform
}

export interface ScheduledPostProps {
  post: ScheduledPostData
  isEditing?: boolean
  onEdit?: (postId: string) => void
  onDelete?: (postId: string) => void
  onSave?: (postId: string) => void
  onCancel?: () => void
  onPlatformChange?: (postId: string, platform: Platform) => void
  onPreview?: (postId: string) => void
  onMore?: (postId: string) => void
}

export function ScheduledPost({
  post,
  isEditing = false,
  onEdit,
  onDelete,
  onSave,
  onCancel,
  onPlatformChange,
  onPreview,
  onMore,
}: ScheduledPostProps) {
  const [platform, setPlatform] = React.useState<Platform>(
    post.platform || "all"
  )
  const [editedContent, setEditedContent] = React.useState(post.content)
  const [editedScheduledAt, setEditedScheduledAt] = React.useState<Date>(
    typeof post.scheduledAt === "string"
      ? new Date(post.scheduledAt)
      : post.scheduledAt,
  )
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)

  // Reset edited content when post changes or edit mode is toggled
  React.useEffect(() => {
    setEditedContent(post.content)
    setPlatform(post.platform || "all")
    setEditedScheduledAt(
      typeof post.scheduledAt === "string"
        ? new Date(post.scheduledAt)
        : post.scheduledAt,
    )
  }, [post.content, post.platform, post.scheduledAt, isEditing])

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

  const scheduledDateTime = formatFullDateTime(post.scheduledAt)
  const relativeTime = formatRelativeTimeWithFuture(post.scheduledAt)
  const initials = getInitials(post.author.name)

  const handlePlatformChange = (newPlatform: Platform) => {
    setPlatform(newPlatform)
    onPlatformChange?.(post.id, newPlatform)
  }

  const handleSave = () => {
    // TODO: Update post with editedContent, editedScheduledAt, and platform
    onSave?.(post.id)
  }

  const handleCancel = () => {
    setEditedContent(post.content)
    setPlatform(post.platform || "all")
    setEditedScheduledAt(
      typeof post.scheduledAt === "string"
        ? new Date(post.scheduledAt)
        : post.scheduledAt,
    )
    onCancel?.()
  }

  return (
    <article
      className={`group border-b transition-colors ${
        isEditing
          ? "border-primary bg-muted/30"
          : "hover:bg-accent/50"
      }`}
      aria-label={`Scheduled post by ${post.author.name}`}
    >
      {/* Scheduled Badge */}
      <div className="px-4 py-2 border-b bg-muted/30">
        {isEditing ? (
          <div className="flex items-center gap-2">
            <Calendar className="h-3 w-3 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Schedule for:</span>
            <PostSchedulePicker
              initialValue={editedScheduledAt}
              onChangeDateTime={(date) => {
                if (date) setEditedScheduledAt(date)
              }}
            />
          </div>
        ) : (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Calendar className="h-3 w-3" />
            <span>
              Scheduled for{" "}
              <span className="font-medium text-foreground">
                {scheduledDateTime}
              </span>
            </span>
          </div>
        )}
      </div>

      <div className="p-3 sm:p-4">
        <div className="flex gap-2 sm:gap-3">
          {/* Avatar - Left side */}
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

          {/* Content - Right side */}
          <div className="min-w-0 flex-1 space-y-3 sm:space-y-4">
            {/* Header: Username + More Menu / Save/Cancel */}
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

            {/* Platform Selector */}
            <div className="flex items-center justify-end pt-2">
              <PlatformSelector
                value={platform}
                onChange={handlePlatformChange}
                size="sm"
              />
            </div>
          </div>
        </div>
      </div>
    </article>
  )
}
