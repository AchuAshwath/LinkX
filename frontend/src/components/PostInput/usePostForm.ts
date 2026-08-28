import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useCallback, useState } from "react"

import { PostsService } from "@/client"
import type { Platform } from "@/components/Common/PlatformSelector"
import useCustomToast from "@/hooks/useCustomToast"
import { draftingStore } from "@/hooks/useDraftingStore"
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

function useComposerCoreState(options?: UsePostFormOptions) {
  const [content, setContent] = useState(options?.initialContent || "")
  const [scheduledAt, setScheduledAt] = useState<Date | undefined>()
  const [channel, setChannel] = useState<Platform>(
    options?.initialPlatform || "linkx",
  )
  const [actionType, setActionType] = useState<"draft" | "schedule" | "post">(
    "post",
  )
  const [isAiMode, setIsAiMode] = useState<boolean>(false)

  const toggleAiMode = useCallback(() => {
    setIsAiMode((prev) => !prev)
  }, [])

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
    isAiMode,
    setIsAiMode,
    toggleAiMode,
    handleContentChange,
  }
}

function useAiDraftMutation(
  showSuccessToast: (msg: string) => void,
  showErrorToast: (msg: string) => void,
) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (data: {
      draftId: string
      prompt: string
      platform: Platform
    }) => {
      return await PostsService.generateAiDraft({
        requestBody: {
          prompt: data.prompt,
          platform: data.platform,
        },
      })
    },
    onSuccess: (_, variables) => {
      draftingStore.removeDraft(variables.draftId)
      showSuccessToast("Draft created and saved to your drafts!")
      queryClient.invalidateQueries({ queryKey: ["posts"] })
    },
    onError: (err, variables) => {
      draftingStore.removeDraft(variables.draftId)
      handleError.call(showErrorToast, err as any)
    },
  })
}

export function usePostForm(options?: UsePostFormOptions) {
  const { showSuccessToast, showErrorToast, showInfoToast } = useCustomToast()
  const core = useComposerCoreState(options)
  const media = useComposerMedia(showErrorToast, options?.initialImageUrl)

  const resetForm = useCallback(() => {
    core.setContent("")
    core.setScheduledAt(undefined)
    core.setChannel("linkx")
    core.setActionType("post")
    core.setIsAiMode(false)
    media.removeMedia()
  }, [core, media])

  const createPostMutation = useCreatePostMutation({
    showSuccessToast,
    showErrorToast,
    onSuccessReset: resetForm,
  })

  const aiDraftMutation = useAiDraftMutation(showSuccessToast, showErrorToast)

  const handleAiDraft = useCallback(() => {
    const prompt = core.content.trim()
    if (!prompt) return

    const draftId = `draft-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

    // Add to in-flight drafting list immediately
    draftingStore.addDraft({
      id: draftId,
      prompt,
      platform: core.channel,
      startedAt: new Date(),
    })

    // Immediately free the input box for the user's next post
    core.setContent("")
    core.setIsAiMode(false)

    // Show initial notification toast
    showInfoToast("Drafting post in background with AI...", "Drafting...")

    // Trigger background generation
    aiDraftMutation.mutate({
      draftId,
      prompt,
      platform: core.channel,
    })
  }, [core, showInfoToast, aiDraftMutation])

  const handleSubmit = useCallback(
    (action: "draft" | "schedule" | "post") => {
      if (core.content.trim().length === 0) return
      const postData = buildPostPayload({
        action,
        content: core.content,
        channel: core.channel,
        scheduledAt: core.scheduledAt,
        imageUrl: media.imageUrl,
      })
      createPostMutation.mutate(postData)
    },
    [
      core.channel,
      core.content,
      core.scheduledAt,
      createPostMutation,
      media.imageUrl,
    ],
  )

  return {
    ...core,
    ...media,
    handleSubmit,
    createPostMutation,
    handleAiDraft,
    isGeneratingAiDraft: false,
  }
}
