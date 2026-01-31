import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useCallback, useState } from "react"

import { PostsService } from "@/client"
import type { Platform } from "@/components/Common/PlatformSelector"
import useCustomToast from "@/hooks/useCustomToast"
import { handleError } from "@/utils"

export function usePostForm() {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const [content, setContent] = useState("")
  const [scheduledAt, setScheduledAt] = useState<Date | undefined>()
  const [channel, setChannel] = useState<Platform>("linkedin")
  const [actionType, setActionType] = useState<"draft" | "schedule" | "post">(
    "post",
  )

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
      showSuccessToast(
        statusMessages[variables.status as keyof typeof statusMessages] ||
          "Post created successfully",
      )
      // Reset form
      setContent("")
      setScheduledAt(undefined)
      setChannel("linkedin")
      setActionType("post")
      // Invalidate queries to refetch posts
      queryClient.invalidateQueries({ queryKey: ["posts"] })
    },
    onError: handleError.bind(showErrorToast),
  })

  const handleSubmit = useCallback(
    (action: "draft" | "schedule" | "post") => {
      if (content.trim().length === 0) return

      // Validate schedule action
      if (action === "schedule" && !scheduledAt) {
        showErrorToast("Please select a date and time to schedule the post")
        return
      }

      // Only LinkedIn is enabled; coerce "x" / "all" to "linkedin" for API
      const platformForApi =
        channel === "x" || channel === "all" ? "linkedin" : channel
      const postData: {
        content: string
        platform: string
        scheduled_at?: string
        status: string
      } = {
        content: content.trim(),
        platform: platformForApi,
        status:
          action === "draft"
            ? "draft"
            : action === "schedule"
              ? "scheduled"
              : "published",
      }

      if (action === "schedule" && scheduledAt) {
        postData.scheduled_at = scheduledAt.toISOString()
      }

      createPostMutation.mutate(postData)
    },
    [content, scheduledAt, channel, createPostMutation, showErrorToast],
  )

  const handleContentChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      setContent(event.target.value)
    },
    [],
  )

  return {
    content,
    setContent,
    scheduledAt,
    setScheduledAt,
    channel,
    setChannel,
    actionType,
    setActionType,
    handleSubmit,
    handleContentChange,
    createPostMutation,
  }
}
