"use client"

import { ImageIcon, Smile, ChevronDown, FileText, Calendar, Send } from "lucide-react"
import * as React from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import { PlatformSelector, type Platform } from "@/components/Common/PlatformSelector"
import { PostsService } from "@/client"
import useCustomToast from "@/hooks/useCustomToast"
import { handleError } from "@/utils"

import { formatDateTime, PostSchedulePicker } from "./PostSchedulePicker"

interface PostInputBoxProps {
  username: string
  avatarUrl?: string
  onSubmit?: () => void
  onCancel?: () => void
}

export function PostInputBox({
  username,
  avatarUrl,
  onSubmit,
  onCancel,
}: PostInputBoxProps) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const [content, setContent] = React.useState("")
  const [scheduledAt, setScheduledAt] = React.useState<Date | undefined>()
  const [channel, setChannel] = React.useState<Platform>("all")
  const [actionType, setActionType] = React.useState<"draft" | "schedule" | "post">("post")

  const createPostMutation = useMutation({
    mutationFn: async (data: {
      content: string
      platform: string
      scheduled_at?: string
      status: string
    }) => {
      return await PostsService.createPost({ requestBody: data })
    },
    onSuccess: (_, variables) => {
      const statusMessages = {
        draft: "Draft saved successfully",
        scheduled: "Post scheduled successfully",
        published: "Post published successfully",
      }
      showSuccessToast(statusMessages[variables.status as keyof typeof statusMessages] || "Post created successfully")
      // Reset form
      setContent("")
      setScheduledAt(undefined)
      setChannel("all")
      setActionType("post")
      // Invalidate queries to refetch posts
      queryClient.invalidateQueries({ queryKey: ["posts"] })
      // Call onSubmit callback if provided
      onSubmit?.()
    },
    onError: handleError.bind(showErrorToast),
  })

  const handleSubmit = (action: "draft" | "schedule" | "post") => {
    if (content.trim().length === 0) return

    // Validate schedule action
    if (action === "schedule" && !scheduledAt) {
      showErrorToast("Please select a date and time to schedule the post")
      return
    }

    const postData: {
      content: string
      platform: string
      scheduled_at?: string
      status: string
    } = {
      content: content.trim(),
      platform: channel,
      status: action === "draft" ? "draft" : action === "schedule" ? "scheduled" : "published",
    }

    if (action === "schedule" && scheduledAt) {
      postData.scheduled_at = scheduledAt.toISOString()
    }

    createPostMutation.mutate(postData)
  }

  const getButtonLabel = () => {
    if (createPostMutation.isPending) {
      if (actionType === "draft") return "Saving..."
      if (actionType === "schedule") return "Scheduling..."
      return "Posting..."
    }
    if (actionType === "draft") return "Save as Draft"
    if (actionType === "schedule") return "Schedule"
    return "Post"
  }

  const getButtonIcon = () => {
    if (createPostMutation.isPending) return null
    if (actionType === "draft") return <FileText className="h-4 w-4" />
    if (actionType === "schedule") return <Calendar className="h-4 w-4" />
    return <Send className="h-4 w-4" />
  }

  const initials =
    username
      .split(" ")
      .map((part) => part[0])
      .join("")
      .toUpperCase() || "U"

  return (
    <div className="w-full space-y-3 sm:space-y-4">
      {/* Header: Avatar + Username + Channel Selector */}
      <div className="flex items-center justify-between gap-2 sm:gap-3">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <Avatar className="h-10 w-10 shrink-0 sm:h-10 sm:w-10">
            {avatarUrl ? <AvatarImage src={avatarUrl} alt={username} /> : null}
            <AvatarFallback className="text-sm sm:text-base">
              {initials}
            </AvatarFallback>
          </Avatar>
          <span className="truncate text-base font-semibold sm:text-base">
            {username}
          </span>
        </div>

        {/* Channel Selector */}
        <PlatformSelector
          value={channel}
          onChange={setChannel}
          size="md"
          className="shrink-0"
        />
      </div>

      {/* Textarea - Mobile optimized */}
      <Textarea
        value={content}
        onChange={(event) => setContent(event.target.value)}
        placeholder="What's happening?"
        className="min-h-24 resize-none border py-3 px-3 text-lg leading-relaxed focus-visible:ring-0 sm:min-h-20 sm:py-2 sm:text-base"
      />

      {/* Actions: Date Picker + Media Buttons + Post Button */}
      <div className="flex flex-col gap-2 sm:gap-1">
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
          {/* Date Picker - Full width on mobile */}
          <div className="w-full min-w-0 sm:min-w-[8rem] sm:flex-1">
            <PostSchedulePicker onChangeDateTime={setScheduledAt} />
          </div>

          {/* Media Buttons + Post Button */}
          <div className="flex items-center justify-between gap-2 sm:justify-end sm:gap-1.5">
            <div className="flex items-center gap-1 sm:gap-1.5">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-9 w-9 rounded-full shrink-0 active:scale-95 sm:h-8 sm:w-8"
                aria-label="Add image"
              >
                <ImageIcon className="h-5 w-5 sm:h-4 sm:w-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-9 w-9 rounded-full shrink-0 active:scale-95 sm:h-8 sm:w-8"
                aria-label="Add emoji"
              >
                <Smile className="h-5 w-5 sm:h-4 sm:w-4" />
              </Button>
            </div>
            <div className="flex items-center gap-2">
              {onCancel && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={onCancel}
                  className="h-9 shrink-0 px-4 text-base sm:h-8"
                  disabled={createPostMutation.isPending}
                >
                  Cancel
                </Button>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    size="sm"
                    className="h-9 shrink-0 bg-primary px-4 text-base font-medium text-primary-foreground transition-all hover:bg-primary/90 active:scale-95 disabled:opacity-50 sm:h-8"
                    disabled={content.trim().length === 0 || createPostMutation.isPending}
                  >
                    <span className="flex items-center gap-2">
                      {getButtonIcon()}
                      {getButtonLabel()}
                      <ChevronDown className="h-3 w-3 opacity-70" />
                    </span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem
                    onClick={() => {
                      setActionType("draft")
                      handleSubmit("draft")
                    }}
                    disabled={content.trim().length === 0 || createPostMutation.isPending}
                    className="cursor-pointer"
                  >
                    <FileText className="mr-2 h-4 w-4" />
                    <span>Save as Draft</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => {
                      setActionType("schedule")
                      handleSubmit("schedule")
                    }}
                    disabled={content.trim().length === 0 || createPostMutation.isPending}
                    className="cursor-pointer"
                  >
                    <Calendar className="mr-2 h-4 w-4" />
                    <span>Schedule</span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => {
                      setActionType("post")
                      handleSubmit("post")
                    }}
                    disabled={content.trim().length === 0 || createPostMutation.isPending}
                    className="cursor-pointer"
                  >
                    <Send className="mr-2 h-4 w-4" />
                    <span>Post Now</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>

        {/* Schedule Info */}
        {scheduledAt && (
          <p className="text-sm leading-relaxed text-muted-foreground sm:text-sm">
            Post will be published on{" "}
            <span className="text-xs font-medium text-foreground sm:text-sm">
              {formatDateTime(scheduledAt)}
            </span>
          </p>
        )}
      </div>
    </div>
  )
}
