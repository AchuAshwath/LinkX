import { createFileRoute } from "@tanstack/react-router"

import { PostInputBox } from "@/components/PostInput"

export const Route = createFileRoute("/_layout/canvas")({
  component: CanvasPage,
  head: () => ({
    meta: [
      {
        title: "Canvas",
      },
    ],
  }),
})

function CanvasPage() {
  return (
    <div className="min-h-[60vh] rounded-lg border border-dashed bg-background/40 p-6">
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold">Canvas</h1>
          <p className="text-sm text-muted-foreground">
            Blank canvas for experimenting with components
          </p>
        </div>
        <PostInputBox username="Jane Doe" />
      </div>
    </div>
  )
}

export default CanvasPage
