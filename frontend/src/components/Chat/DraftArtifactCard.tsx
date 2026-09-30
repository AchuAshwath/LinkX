import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import * as React from "react"
import { PostsService } from "@/client"
import type { DraftArtifact } from "@/components/Chat/types"
import type { Platform } from "@/components/Common/PlatformSelector"
import { DraftPost, type DraftPostData } from "@/components/Post/DraftPost"
import { PostPreviewDialog } from "@/components/Post/Previews"
import type { PreviewPostData } from "@/components/Post/Previews/LinkedInPostPreview"
import useAuth from "@/hooks/useAuth"
import useCustomToast from "@/hooks/useCustomToast"
import { cn } from "@/lib/utils"

export interface DraftArtifactCardProps {
  artifact: DraftArtifact
  author?: { name: string; username: string; avatarUrl?: string | null }
  onSchedule?: (artifact: DraftArtifact) => void
  onSendToComposer?: (artifact: DraftArtifact) => void
  onEdit?: (artifact: DraftArtifact) => void
  onPublish?: (artifact: DraftArtifact) => void
  onDelete?: (artifact: DraftArtifact) => void
  onPreview?: (artifact: DraftArtifact) => void
  className?: string
}

function resolveInitialPlatform(platform?: string): Platform {
  if (!platform || platform === "all") return "linkx"
  return platform as Platform
}

function resolvePostAuthor(
  author?: { name: string; username: string; avatarUrl?: string | null },
  user?: { full_name?: string | null; email?: string | null } | null,
) {
  if (author) return author
  const emailPrefix = user?.email ? user.email.split("@")[0] : ""
  const name = user?.full_name || emailPrefix || "Ashwath N"
  const username = emailPrefix || "admin"
  return { name, username }
}

function createDraftPostData({
  artifact,
  author,
  platform,
}: {
  artifact: DraftArtifact
  author: { name: string; username: string; avatarUrl?: string | null }
  platform: Platform
}): DraftPostData {
  return {
    id: artifact.id || artifact.postId || "draft-artifact",
    author,
    content: artifact.content,
    createdAt: new Date().toISOString(),
    platform,
    status: "draft",
    type: "draft",
  }
}

function createPreviewPostData(post: DraftPostData): PreviewPostData {
  return {
    id: post.id,
    author: {
      name: post.author.name,
      username: post.author.username,
      avatarUrl: post.author.avatarUrl ?? undefined,
    },
    content: post.content,
    imageUrl: post.imageUrl ?? undefined,
    createdAt: post.createdAt,
    likes: post.likes,
    reposts: post.reposts,
    comments: post.comments,
  }
}

function usePublishPostMutation() {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  return useMutation({
    mutationFn: async (postId: string) =>
      PostsService.publishExistingPost({ postId }),
    onSuccess: () => {
      showSuccessToast("Post published successfully!")
      queryClient.invalidateQueries({ queryKey: ["posts"] })
    },
    onError: () => {
      showErrorToast("Failed to publish post")
    },
  })
}

function isValidPostId(id: unknown): id is string {
  if (typeof id !== "string") return false
  if (id.length === 0) return false
  return id !== "draft-artifact"
}

function resolveValidPostId(artifact: DraftArtifact): string | undefined {
  if (isValidPostId(artifact.postId)) return artifact.postId
  if (isValidPostId(artifact.id)) return artifact.id
  return undefined
}

function useLivePost(artifact: DraftArtifact) {
  const validPostId = resolveValidPostId(artifact)
  return useQuery({
    queryKey: ["posts", validPostId],
    queryFn: () => PostsService.readPost({ postId: validPostId! }),
    enabled: Boolean(validPostId),
  })
}

function useDraftPlatform(artifactPlatform?: string, livePlatform?: string) {
  const [platform, setPlatform] = React.useState<Platform>(() =>
    resolveInitialPlatform(artifactPlatform),
  )

  React.useEffect(() => {
    const next = livePlatform || artifactPlatform
    if (next) {
      setPlatform(resolveInitialPlatform(next))
    }
  }, [livePlatform, artifactPlatform])

  return [platform, setPlatform] as const
}

interface DraftActionHandlers {
  artifact: DraftArtifact
  onPublish?: (artifact: DraftArtifact) => void
  onEdit?: (artifact: DraftArtifact) => void
  onSendToComposer?: (artifact: DraftArtifact) => void
  onPreview?: (artifact: DraftArtifact) => void
  setPreviewOpen: (open: boolean) => void
}

function resolveActionPostId(
  postId: unknown,
  artifact: DraftArtifact,
): string | undefined {
  if (isValidPostId(postId)) return postId
  return resolveValidPostId(artifact)
}

function usePublishAction(
  artifact: DraftArtifact,
  onPublish?: (artifact: DraftArtifact) => void,
  publishMutation?: ReturnType<typeof usePublishPostMutation>,
) {
  const { showErrorToast } = useCustomToast()
  return React.useCallback(
    (postId?: string) => {
      if (onPublish) {
        onPublish(artifact)
        return
      }
      const targetId = resolveActionPostId(postId, artifact)
      if (targetId) {
        publishMutation?.mutate(targetId)
        return
      }
      showErrorToast(
        "Cannot publish: Draft has not been saved to database yet.",
      )
    },
    [artifact, onPublish, publishMutation, showErrorToast],
  )
}

function useEditAction(
  artifact: DraftArtifact,
  onEdit?: (artifact: DraftArtifact) => void,
  onSendToComposer?: (artifact: DraftArtifact) => void,
) {
  const { showErrorToast } = useCustomToast()
  return React.useCallback(
    (postId?: string) => {
      const targetId = resolveActionPostId(postId, artifact)
      if (!targetId) {
        showErrorToast("Cannot edit: Draft has not been saved to database yet.")
        return
      }
      onEdit?.(artifact)
      onSendToComposer?.(artifact)
    },
    [artifact, onEdit, onSendToComposer, showErrorToast],
  )
}

function useDraftCardActions({
  artifact,
  onPublish,
  onEdit,
  onSendToComposer,
  onPreview,
  setPreviewOpen,
}: DraftActionHandlers) {
  const publishMutation = usePublishPostMutation()
  const handlePublish = usePublishAction(artifact, onPublish, publishMutation)
  const handleEdit = useEditAction(artifact, onEdit, onSendToComposer)

  const handlePreview = React.useCallback(() => {
    setPreviewOpen(true)
    onPreview?.(artifact)
  }, [artifact, onPreview, setPreviewOpen])

  return {
    handlePublish,
    handleEdit,
    handlePreview,
    isPublishing: publishMutation.isPending,
  }
}

export function DraftArtifactCard({
  artifact,
  author,
  onSchedule: _onSchedule,
  onSendToComposer,
  onEdit,
  onPublish,
  onDelete,
  onPreview,
  className,
}: DraftArtifactCardProps) {
  const { user } = useAuth()
  const [previewOpen, setPreviewOpen] = React.useState(false)
  const { data: livePost } = useLivePost(artifact)
  const [currentPlatform, setCurrentPlatform] = useDraftPlatform(
    artifact.platform,
    livePost?.platform,
  )

  const actions = useDraftCardActions({
    artifact,
    onPublish,
    onEdit,
    onSendToComposer,
    onPreview,
    setPreviewOpen,
  })

  const postAuthor = React.useMemo(
    () => resolvePostAuthor(author, user),
    [author, user],
  )

  const postData = React.useMemo(
    () =>
      createDraftPostData({
        artifact: {
          ...artifact,
          content: livePost?.content ?? artifact.content,
        },
        author: postAuthor,
        platform: currentPlatform,
      }),
    [artifact, livePost?.content, postAuthor, currentPlatform],
  )

  const previewData = React.useMemo(
    () => createPreviewPostData(postData),
    [postData],
  )

  return (
    <div className={cn("w-full", className)}>
      <DraftPost
        post={postData}
        onPlatformChange={(_, p) => setCurrentPlatform(p)}
        onPublish={actions.handlePublish}
        onPreview={actions.handlePreview}
        onEdit={actions.handleEdit}
        onDelete={onDelete ? () => onDelete(artifact) : undefined}
        isPublishing={actions.isPublishing}
      />
      <PostPreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        post={previewData}
        platform={currentPlatform}
      />
    </div>
  )
}
