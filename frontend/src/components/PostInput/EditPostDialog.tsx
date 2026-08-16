import { X } from "lucide-react"
import type { Platform } from "@/components/Common/PlatformSelector"
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog"
import useAuth from "@/hooks/useAuth"
import { PostInputBox } from "./PostInputBox"

interface EditPostDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  postId: string
  initialContent?: string
  initialImageUrl?: string | null
  initialPlatform?: Platform
  initialScheduledAt?: Date | null
}

export function EditPostDialog({
  open,
  onOpenChange,
  postId,
  initialContent,
  initialImageUrl,
  initialPlatform,
  initialScheduledAt,
}: EditPostDialogProps) {
  const { user } = useAuth()
  const username = user?.full_name || user?.email?.split("@")[0] || "User"

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
          initialContent={initialContent}
          initialImageUrl={initialImageUrl ?? undefined}
          initialPlatform={initialPlatform}
          autoFocus
          editMode={{
            postId,
            initialScheduledAt,
            onSaved: () => onOpenChange(false),
          }}
        />
      </DialogContent>
    </Dialog>
  )
}
