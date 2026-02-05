import { createFileRoute } from "@tanstack/react-router"
import * as React from "react"

import { PromptDraftStudio } from "@/components/chat/PromptDraftStudio"

export const Route = createFileRoute("/_layout/draft")({
  component: DraftPage,
  head: () => ({
    meta: [
      {
        title: "Prompt Studio - LinkX",
      },
    ],
  }),
})

function DraftPage() {
  return (
    <PromptDraftStudio />
  )
}

export default DraftPage
