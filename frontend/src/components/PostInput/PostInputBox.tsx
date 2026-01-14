"use client"

import * as React from "react"
import { Asterisk, ImageIcon, Smile } from "lucide-react"
import { FaLinkedinIn } from "react-icons/fa"
import { FaXTwitter } from "react-icons/fa6"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

import { PostSchedulePicker, formatDateTime } from "./PostSchedulePicker"

interface PostInputBoxProps {
  username: string
  avatarUrl?: string
}

export function PostInputBox({ username, avatarUrl }: PostInputBoxProps) {
  const [content, setContent] = React.useState("")
  const [scheduledAt, setScheduledAt] = React.useState<Date | undefined>()
  const [channel, setChannel] = React.useState<"all" | "linkedin" | "x">("all")

  const initials =
    username
      .split(" ")
      .map((part) => part[0])
      .join("")
      .toUpperCase() || "U"

  return (
    <div className="mx-auto w-full max-w-xl space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Avatar>
            {avatarUrl ? <AvatarImage src={avatarUrl} alt={username} /> : null}
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
          <span className="text-sm font-medium">{username}</span>
        </div>

        <div className="flex items-center gap-1 rounded-full border bg-card px-1 py-0.5 text-xs">
          <button
            type="button"
            onClick={() => setChannel("linkedin")}
            className={`flex size-6 items-center justify-center rounded-full ${
              channel === "linkedin"
                ? "bg-muted text-[#0A66C2]"
                : "hover:bg-muted text-[#0A66C2]"
            }`}
          >
            <FaLinkedinIn className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setChannel("all")}
            className={`flex size-6 items-center justify-center rounded-full ${
              channel === "all"
                ? "bg-muted text-foreground"
                : "hover:bg-muted text-muted-foreground"
            }`}
          >
            <Asterisk className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setChannel("x")}
            className={`flex size-6 items-center justify-center rounded-full ${
              channel === "x"
                ? "bg-muted text-foreground"
                : "hover:bg-muted text-muted-foreground"
            }`}
          >
            <FaXTwitter className="size-3.5" />
          </button>
        </div>
      </div>

      <Textarea
        value={content}
        onChange={(event) => setContent(event.target.value)}
        placeholder="Write your post..."
        className="min-h-24 resize-none"
      />

      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-[8rem] flex-1">
            <PostSchedulePicker onChangeDateTime={setScheduledAt} />
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="p-0 rounded-full shrink-0"
            >
              <ImageIcon className="size-5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="p-0 rounded-full shrink-0"
            >
              <Smile className="size-5" />
            </Button>
            <Button
              type="button"
              className="shrink-0"
              disabled={content.trim().length === 0}
            >
              Post
            </Button>
          </div>
        </div>
        {scheduledAt && (
          <p className="text-xs text-muted-foreground">
            Post will be published on{" "}
            <span className="font-medium">
              {formatDateTime(scheduledAt)}
            </span>
          </p>
        )}
      </div>
    </div>
  )
}

