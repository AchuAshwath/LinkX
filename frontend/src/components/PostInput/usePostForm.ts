import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useCallback, useState } from "react"

import { PostsService } from "@/client"
import type { Platform } from "@/components/Common/PlatformSelector"
import useCustomToast from "@/hooks/useCustomToast"
import { handleError } from "@/utils"

export interface UsePostFormOptions {
  initialContent?: string
  initialImageUrl?: string | null
  initialPlatform?: Platform
}

const VALID_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
])
const MAX_MEDIA_BYTES = 5 * 1024 * 1024 // 5 MB

function validateMediaFile(
  file: File,
  showErrorToast: (msg: string) => void,
): boolean {
  if (!VALID_IMAGE_TYPES.has(file.type)) {
    showErrorToast(
      "Invalid file type. Please upload a JPEG, PNG, GIF, or WebP image.",
    )
    return false
  }
  if (file.size > MAX_MEDIA_BYTES) {
    showErrorToast("Image size exceeds the 5 MB limit.")
    return false
  }
  return true
}

interface PostPayloadOptions {
  action: "draft" | "schedule" | "post"
  content: string
  channel: Platform
  scheduledAt?: Date
  imageUrl: string | null
}

function buildPostPayload({
  action,
  content,
  channel,
  scheduledAt,
  imageUrl,
}: PostPayloadOptions) {
  const status =
    action === "draft"
      ? "draft"
      : action === "schedule"
        ? "scheduled"
        : "published"

  const finalScheduledAt =
    action === "schedule"
      ? scheduledAt || new Date(Date.now() + 4 * 3600 * 1000)
      : undefined

  return {
    content: content.trim(),
    platform: channel,
    status,
    image_url: imageUrl || undefined,
    scheduled_at:
      action === "schedule" && finalScheduledAt
        ? finalScheduledAt.toISOString()
        : undefined,
  }
}

function getSuccessMessage(status: string): string {
  const messages: Record<string, string> = {
    draft: "Draft saved successfully",
    scheduled: "Post scheduled successfully",
    published: "Post published successfully",
  }
  return messages[status] || "Post created successfully"
}

interface UseCreatePostMutationOptions {
  showSuccessToast: (msg: string) => void
  showErrorToast: (msg: string) => void
  onSuccessReset: () => void
}

function useCreatePostMutation({
  showSuccessToast,
  showErrorToast,
  onSuccessReset,
}: UseCreatePostMutationOptions) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (data: {
      content: string
      platform: string
      scheduled_at?: string
      status: string
      image_url?: string | null
    }) => {
      return await PostsService.createNewPost({ requestBody: data })
    },
    onSuccess: (_, variables) => {
      showSuccessToast(getSuccessMessage(variables.status))
      onSuccessReset()
      queryClient.invalidateQueries({ queryKey: ["posts"] })
    },
    onError: handleError.bind(showErrorToast),
  })
}

function useComposerMedia(
  showErrorToast: (msg: string) => void,
  initialImageUrl?: string | null,
) {
  const [mediaFile, setMediaFile] = useState<File | null>(null)
  const [imageUrl, setImageUrl] = useState<string | null>(
    initialImageUrl || null,
  )
  const [isUploadingMedia, setIsUploadingMedia] = useState(false)

  const removeMedia = useCallback(() => {
    setMediaFile(null)
    setImageUrl(null)
    setIsUploadingMedia(false)
  }, [])

  const uploadMedia = useCallback(
    async (file: File): Promise<string | null> => {
      if (!validateMediaFile(file, showErrorToast)) return null

      setMediaFile(file)
      setIsUploadingMedia(true)
      const localPreviewUrl = URL.createObjectURL(file)
      setImageUrl(localPreviewUrl)

      try {
        const res = await PostsService.uploadMedia({ formData: { file } })
        const uploadedUrl = res.url || localPreviewUrl
        setImageUrl(uploadedUrl)
        return uploadedUrl
      } catch (err) {
        handleError.call(showErrorToast, err as any)
        return localPreviewUrl
      } finally {
        setIsUploadingMedia(false)
      }
    },
    [showErrorToast],
  )

  return {
    mediaFile,
    imageUrl,
    setImageUrl,
    isUploadingMedia,
    uploadMedia,
    removeMedia,
  }
}

export function usePostForm(options?: UsePostFormOptions) {
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const [content, setContent] = useState(options?.initialContent || "")
  const [scheduledAt, setScheduledAt] = useState<Date | undefined>()
  const [channel, setChannel] = useState<Platform>(
    options?.initialPlatform || "linkx",
  )
  const [actionType, setActionType] = useState<"draft" | "schedule" | "post">(
    "post",
  )

  const {
    mediaFile,
    imageUrl,
    setImageUrl,
    isUploadingMedia,
    uploadMedia,
    removeMedia,
  } = useComposerMedia(showErrorToast, options?.initialImageUrl)

  const resetForm = useCallback(() => {
    setContent("")
    setScheduledAt(undefined)
    setChannel("linkx")
    setActionType("post")
    removeMedia()
  }, [removeMedia])

  const createPostMutation = useCreatePostMutation({
    showSuccessToast,
    showErrorToast,
    onSuccessReset: resetForm,
  })

  const handleSubmit = useCallback(
    (action: "draft" | "schedule" | "post") => {
      if (content.trim().length === 0) return
      const postData = buildPostPayload({
        action,
        content,
        channel,
        scheduledAt,
        imageUrl,
      })
      createPostMutation.mutate(postData)
    },
    [channel, content, createPostMutation, imageUrl, scheduledAt],
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
    mediaFile,
    imageUrl,
    setImageUrl,
    isUploadingMedia,
    uploadMedia,
    removeMedia,
    handleSubmit,
    handleContentChange,
    createPostMutation,
  }
}
