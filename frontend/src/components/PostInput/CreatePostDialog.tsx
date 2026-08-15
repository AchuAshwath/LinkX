"use client"

import { X } from "lucide-react"
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog"
import useAuth from "@/hooks/useAuth"
import { PostInputBox } from "./PostInputBox"

interface CreatePostDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onPostCreated?: () => void
}

export function CreatePostDialog({
  open,
  onOpenChange,
  onPostCreated,
}: CreatePostDialogProps) {
  const { user } = useAuth()
  const username = user?.full_name || user?.email?.split("@")[0] || "User"
  const avatarUrl = undefined // TODO: Add avatar_url to user model if needed

  const handlePostCreated = () => {
    onPostCreated?.()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-2xl p-5 sm:p-6 overflow-visible border border-border/80 shadow-xl"
      >
        <DialogClose className="absolute -top-3 -right-3 sm:-top-3.5 sm:-right-3.5 h-7 w-7 rounded-full bg-background border border-border/80 shadow-xs hover:shadow-sm flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-all cursor-pointer z-50 focus:outline-none focus:ring-1 focus:ring-ring">
          <X className="h-3.5 w-3.5" />
          <span className="sr-only">Close</span>
        </DialogClose>
        <PostInputBox
          username={username}
          avatarUrl={avatarUrl}
          onSubmit={handlePostCreated}
          onCancel={() => onOpenChange(false)}
          autoFocus
        />
      </DialogContent>
    </Dialog>
  )
}
