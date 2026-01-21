"use client"

import { ImageIcon, Smile } from "lucide-react"
import * as React from "react"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { PlatformSelector, type Platform } from "@/components/Common/PlatformSelector"

import { formatDateTime, PostSchedulePicker } from "./PostSchedulePicker"

interface PostInputBoxProps {
  username: string
  avatarUrl?: string
}

export function PostInputBox({ username, avatarUrl }: PostInputBoxProps) {
  const [content, setContent] = React.useState("")
  const [scheduledAt, setScheduledAt] = React.useState<Date | undefined>()
  const [channel, setChannel] = React.useState<Platform>("all")

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
            <Button
              type="button"
              size="sm"
              className="h-9 shrink-0 bg-primary px-4 text-base font-medium text-primary-foreground transition-all hover:bg-primary/90 active:scale-95 disabled:opacity-50 sm:h-8"
              disabled={content.trim().length === 0}
            >
              Post
            </Button>
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
