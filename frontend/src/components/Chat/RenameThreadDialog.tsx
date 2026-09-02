import * as React from "react"

import type { ChatThreadPublic } from "@/client"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

export function RenameThreadDialog({
  thread,
  isOpen,
  isPending,
  onClose,
  onConfirm,
}: {
  thread: ChatThreadPublic | null
  isOpen: boolean
  isPending: boolean
  onClose: () => void
  onConfirm: (title: string) => void
}) {
  const [titleInput, setTitleInput] = React.useState("")

  React.useEffect(() => {
    if (thread) {
      setTitleInput(thread.title)
    }
  }, [thread])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!titleInput.trim() || isPending) return
    onConfirm(titleInput.trim())
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Rename Chat</DialogTitle>
            <DialogDescription>
              Enter a new title for this conversation.
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            <input
              type="text"
              autoFocus
              value={titleInput}
              onChange={(e) => setTitleInput(e.target.value)}
              placeholder="Chat title"
              disabled={isPending}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm transition-colors placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          <DialogFooter className="gap-2.5 sm:gap-2.5">
            <DialogClose asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isPending}
                onClick={onClose}
                className="cursor-pointer"
              >
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="submit"
              size="sm"
              disabled={isPending || !titleInput.trim()}
              className="font-semibold cursor-pointer"
            >
              {isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
