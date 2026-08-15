import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { Loader2 } from "lucide-react"
import * as React from "react"
import { PostsService, TrendingService } from "@/client"
import type { Platform } from "@/components/Common/PlatformSelector"
import type { PostedData } from "@/components/Post/Posted"
import { Posted } from "@/components/Post/Posted"
import {
  PostPreviewDialog,
  type PreviewPostData,
} from "@/components/Post/Previews"
import type { ScheduledPostData } from "@/components/Post/ScheduledPost"
import { ScheduledPost } from "@/components/Post/ScheduledPost"
import { PostInputBox } from "@/components/PostInput/PostInputBox"
import { TrendingTopics } from "@/components/Timeline"
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
import { LoadingButton } from "@/components/ui/loading-button"
import useAuth from "@/hooks/useAuth"
import useCustomToast from "@/hooks/useCustomToast"
import { transformToPostedPost, transformToScheduledPost } from "@/utils"

type TimelinePost =
  | (PostedData & { type: "posted" })
  | (ScheduledPostData & { type: "scheduled" })

export const Route = createFileRoute("/_layout/home")({
  component: TimelinePage,
  head: () => ({
    meta: [
      {
        title: "Timeline",
      },
    ],
  }),
})

function convertToPreviewData(post: TimelinePost): PreviewPostData {
  if (post.type === "posted") {
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
    scheduledAt: post.scheduledAt ?? undefined,
  }
}

function TimelinePage() {
  const queryClient = useQueryClient()
  const { user } = useAuth()

  const [draftContent, setDraftContent] = React.useState<string>("")
  const [editingPostId, setEditingPostId] = React.useState<string | null>(null)

  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false)
  const [postToDelete, setPostToDelete] = React.useState<{
    id: string
    type: "draft" | "scheduled" | "posted"
  } | null>(null)

  const [previewDialogOpen, setPreviewDialogOpen] = React.useState(false)
  const [previewPost, setPreviewPost] = React.useState<PreviewPostData | null>(
    null,
  )

  const { showSuccessToast, showErrorToast } = useCustomToast()

  const { data: scheduledData, isLoading: isLoadingScheduled } = useQuery({
    queryKey: ["posts", "scheduled"],
    queryFn: async () =>
      PostsService.readPosts({
        status: "scheduled",
        skip: 0,
        limit: 100,
      }),
  })

  const { data: publishedData, isLoading: isLoadingPublished } = useQuery({
    queryKey: ["posts", "published"],
    queryFn: async () =>
      PostsService.readPosts({
        status: "published",
        skip: 0,
        limit: 100,
      }),
  })

  const { data: trendingData } = useQuery({
    queryKey: ["trending"],
    queryFn: async () => TrendingService.getTrending(),
  })
  const trendingTopics = trendingData?.data ?? []
  const latestScrapedAt = trendingTopics[0]?.scraped_at ?? null

  const posts: TimelinePost[] = React.useMemo(() => {
    const scheduled: TimelinePost[] = (scheduledData?.data || [])
      .filter((p) => p.status === "scheduled" && p.scheduled_at)
      .map((p) => ({
        ...transformToScheduledPost({
          id: p.id,
          author: p.author as {
            name: string
            username: string
            avatarUrl?: string | null
          } | null,
          content: p.content,
          image_url: p.image_url ?? null,
          created_at: p.created_at ?? new Date().toISOString(),
          scheduled_at: p.scheduled_at ?? null,
          platform: p.platform ?? "linkx",
        }),
        type: "scheduled" as const,
      }))

    const posted: TimelinePost[] = (publishedData?.data || [])
      .filter((p) => p.status === "published")
      .map((p) => ({
        ...transformToPostedPost({
          id: p.id,
          author: p.author as {
            name: string
            username: string
            avatarUrl?: string | null
          } | null,
          content: p.content,
          image_url: p.image_url ?? null,
          created_at: p.created_at ?? new Date().toISOString(),
          likes: p.likes ?? 0,
          reposts: p.reposts ?? 0,
          comments: p.comments ?? 0,
          platform: p.platform ?? "linkx",
        }),
        type: "posted" as const,
      }))

    return [...scheduled, ...posted]
  }, [scheduledData, publishedData])

  const deleteMutation = useMutation({
    mutationFn: async (postId: string) =>
      PostsService.deleteExistingPost({ postId }),
    onSuccess: () => {
      if (postToDelete) {
        showSuccessToast("Post deleted successfully")
        setDeleteDialogOpen(false)
        setPostToDelete(null)
        queryClient.invalidateQueries({ queryKey: ["posts"] })
      }
    },
    onError: (error) => {
      console.error("Failed to delete post", error)
      showErrorToast("Failed to delete post")
    },
  })

  const updateMutation = useMutation({
    mutationFn: async ({
      postId,
      data,
    }: {
      postId: string
      data: {
        persona_id?: string
        content?: string
        image_url?: string
        platform?: string
        scheduled_at?: string
        status?: string
      }
    }) =>
      PostsService.updateExistingPost({
        postId,
        requestBody: data,
      }),
    onSuccess: () => {
      showSuccessToast("Post updated successfully")
      setEditingPostId(null)
      queryClient.invalidateQueries({ queryKey: ["posts"] })
    },
    onError: (error) => {
      console.error("Failed to update post", error)
      showErrorToast("Failed to update post")
    },
  })

  const handleDelete = (
    postId: string,
    type: "draft" | "scheduled" | "posted",
  ) => {
    setPostToDelete({ id: postId, type })
    setDeleteDialogOpen(true)
  }

  const confirmDelete = () => {
    if (postToDelete) {
      deleteMutation.mutate(postToDelete.id)
    }
  }

  const handleSaveScheduled = (
    postId: string,
    data: { content: string; platform: Platform; scheduledAt?: Date | null },
  ) => {
    updateMutation.mutate({
      postId,
      data: {
        content: data.content,
        platform: data.platform,
        scheduled_at: data.scheduledAt
          ? data.scheduledAt.toISOString()
          : undefined,
      },
    })
  }

  const handlePlatformChange = (postId: string, platform: Platform) => {
    updateMutation.mutate({
      postId,
      data: { platform },
    })
  }

  const handlePreview = (postId: string) => {
    const post = posts.find((p) => p.id === postId)
    if (post) {
      setPreviewPost(convertToPreviewData(post))
      setPreviewDialogOpen(true)
    }
  }

  const handleTopicDraft = (topicTitle: string) => {
    setDraftContent(topicTitle)
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  const sortedPosts = React.useMemo(() => {
    const toTime = (d: Date | string) =>
      (typeof d === "string" ? new Date(d) : d).getTime()

    return [...posts].sort((a, b) => {
      const aTime =
        a.type === "scheduled" && a.scheduledAt
          ? toTime(a.scheduledAt)
          : toTime(a.createdAt)
      const bTime =
        b.type === "scheduled" && b.scheduledAt
          ? toTime(b.scheduledAt)
          : toTime(b.createdAt)
      return bTime - aTime
    })
  }, [posts])

  return (
    <div className="flex w-full">
      {/* Feed Column - Center */}
      <div className="flex-1 min-w-0 max-w-2xl border-r-0 md:border-r border-border">
        {/* Sticky top composer */}
        <div className="border-b p-3.5 sm:p-4">
          <PostInputBox
            username={user?.full_name || user?.email || "User"}
            avatarUrl={undefined}
            initialContent={draftContent}
            onSubmit={() => {
              setDraftContent("")
              queryClient.invalidateQueries({ queryKey: ["posts"] })
            }}
          />
        </div>

        {/* Feed Posts */}
        {isLoadingScheduled || isLoadingPublished ? (
          <div className="flex flex-col items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <p className="mt-4 text-sm text-muted-foreground">
              Loading timeline...
            </p>
          </div>
        ) : sortedPosts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
            <p className="text-sm text-muted-foreground">
              No posts in your timeline yet. Create a draft or schedule your
              first post!
            </p>
          </div>
        ) : (
          <div className="w-full pb-20">
            {sortedPosts.map((post) => {
              if (post.type === "scheduled") {
                return (
                  <ScheduledPost
                    key={post.id}
                    post={post}
                    isEditing={editingPostId === post.id}
                    onEdit={(id) => setEditingPostId(id)}
                    onDelete={(id) => handleDelete(id, "scheduled")}
                    onSave={handleSaveScheduled}
                    onCancel={() => setEditingPostId(null)}
                    onPlatformChange={handlePlatformChange}
                    onPreview={(id) => handlePreview(id)}
                  />
                )
              }

              return (
                <Posted
                  key={post.id}
                  post={post}
                  onPreview={(id) => handlePreview(id)}
                  onDelete={(id) => handleDelete(id, "posted")}
                />
              )
            })}
          </div>
        )}
      </div>

      {/* Right Column - Unified Trending Topics Card */}
      <div className="hidden w-80 md:block">
        <div className="sticky top-0 self-start p-4">
          <TrendingTopics
            topics={trendingTopics}
            lastScrapedAt={latestScrapedAt}
            onTopicDraft={handleTopicDraft}
          />
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Post</DialogTitle>
            <DialogDescription>
              This will remove the post record from your LinkX database.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4">
            <DialogClose asChild>
              <Button variant="outline" disabled={deleteMutation.isPending}>
                Cancel
              </Button>
            </DialogClose>
            <LoadingButton
              variant="destructive"
              onClick={confirmDelete}
              loading={deleteMutation.isPending}
            >
              Delete
            </LoadingButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preview Dialog */}
      {previewPost && (
        <PostPreviewDialog
          open={previewDialogOpen}
          onOpenChange={setPreviewDialogOpen}
          post={previewPost}
          platform={
            posts.find((p) => p.id === previewPost.id)?.platform || "linkedin"
          }
        />
      )}
    </div>
  )
}

export default TimelinePage
