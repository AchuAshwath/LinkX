"use client"

import { Dialog, DialogContent } from "@/components/ui/dialog"
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
      <DialogContent className="sm:max-w-2xl">
        <div className="py-4">
          <PostInputBox
            username={username}
            avatarUrl={avatarUrl}
            onSubmit={handlePostCreated}
            onCancel={() => onOpenChange(false)}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}
